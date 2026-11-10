from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.auth import _enforce_ip_allowlist
from app.core.config import get_settings
from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.logging import logger
from app.core.mfa import generate_otp_code, send_mfa_code
from app.core.security import hash_password, verify_password
from app.models.identity import MfaChallenge, User
from app.models.identity import Session as SessionModel
from app.models.tenant import Tenant

settings = get_settings()

MFA_CODE_TTL_MINUTES = 5
MAX_MFA_ATTEMPTS = 3

_GENERIC_LOGIN_ERROR = "Invalid tenant, email, or password"

_TENANT_STATUS_MESSAGES = {
    "pending": "This organization's account is still pending approval.",
    "suspended": "This organization's account has been suspended. Contact your administrator.",
}


def _require_approved_tenant(db: Session, tenant_id: UUID) -> None:
    """Checked only after credentials already matched (ADR-017's generic
    invalid-credentials error must come first, so a non-approved tenant's
    status is never learnable without a valid password)."""
    status = db.execute(select(Tenant.status).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if status is not None and status != "approved":
        message = _TENANT_STATUS_MESSAGES.get(status, "This organization's account is not active.")
        raise ForbiddenError(message)


def start_login(
    db: Session, tenant_id: UUID, email: str, password: str, request: Request | None = None
) -> tuple[SessionModel, str | None]:
    """Verifies credentials and opens an MFA-pending session (FR-AUTH-002/003).

    Returns (session_row, plaintext_code). The plaintext code is only
    non-None in 'simulated' delivery mode (ADR-011); callers must not log or
    return it in 'real' mode.
    """
    set_tenant_context(db, str(tenant_id))

    user = db.execute(
        select(User).where(
            User.tenant_id == tenant_id, User.email == email, User.is_active.is_(True)
        )
    ).scalar_one_or_none()

    if user is None or not verify_password(password, user.password_hash):
        logger.warning(
            "security_event=login_failed tenant_id=%s email=%s", tenant_id, email
        )
        raise UnauthorizedError(_GENERIC_LOGIN_ERROR)

    _require_approved_tenant(db, tenant_id)
    # Tier 4 / ADR-054: PV-11.3 -- blocked before any session/MFA challenge
    # is even created, not only on subsequent authenticated requests.
    if request is not None:
        _enforce_ip_allowlist(db, tenant_id, request)

    now = datetime.now(UTC)
    session_row = SessionModel(
        tenant_id=tenant_id,
        user_id=user.id,
        expires_at=now + timedelta(minutes=MFA_CODE_TTL_MINUTES),
        mfa_verified=False,
    )
    db.add(session_row)
    db.flush()

    code = generate_otp_code()
    challenge = MfaChallenge(
        tenant_id=tenant_id,
        user_id=user.id,
        code_hash=hash_password(code),
        delivery_mode=settings.mfa_delivery_mode,
        expires_at=now + timedelta(minutes=MFA_CODE_TTL_MINUTES),
    )
    db.add(challenge)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="auth.login_attempted",
        entity_type="user",
        entity_id=user.id,
    )
    db.commit()

    send_mfa_code(user.email, code)

    returned_code = code if settings.mfa_delivery_mode == "simulated" else None
    return session_row, returned_code


def verify_mfa(db: Session, session_id: UUID, code: str) -> SessionModel:
    session_row = db.execute(
        select(SessionModel).where(SessionModel.id == session_id)
    ).scalar_one_or_none()
    if session_row is None or session_row.revoked_at is not None:
        raise UnauthorizedError("Session not found")
    if session_row.expires_at < datetime.now(UTC):
        raise UnauthorizedError("Session expired, please log in again")
    if session_row.mfa_verified:
        return session_row

    set_tenant_context(db, str(session_row.tenant_id))

    # GAP-17: row-locked so two concurrent verify requests for the same
    # challenge can't both read attempt_count before either commits its
    # increment, which could let a couple of extra guesses through the
    # stated 3-attempt cap.
    challenge = (
        db.execute(
            select(MfaChallenge)
            .where(MfaChallenge.user_id == session_row.user_id, MfaChallenge.verified_at.is_(None))
            .order_by(MfaChallenge.created_at.desc())
            .with_for_update()
        )
        .scalars()
        .first()
    )

    if challenge is None or challenge.expires_at < datetime.now(UTC):
        raise UnauthorizedError("Verification code expired")

    if challenge.attempt_count >= MAX_MFA_ATTEMPTS:
        session_row.revoked_at = datetime.now(UTC)
        db.commit()
        logger.warning(
            "security_event=mfa_locked_out user_id=%s", session_row.user_id
        )
        raise UnauthorizedError("Too many attempts; please log in again")

    if not verify_password(code, challenge.code_hash):
        challenge.attempt_count += 1
        if challenge.attempt_count >= MAX_MFA_ATTEMPTS:
            session_row.revoked_at = datetime.now(UTC)
            logger.warning(
                "security_event=mfa_locked_out user_id=%s", session_row.user_id
            )
        db.commit()
        raise UnauthorizedError("Incorrect verification code")

    challenge.verified_at = datetime.now(UTC)

    # Deployment-hardening pass: rotate the session identifier on MFA
    # completion rather than flipping `mfa_verified` on the same row. The
    # pre-MFA cookie value is sent over the wire (and briefly held in the
    # browser) before full authentication is established; minting a fresh
    # session row here means that earlier, lower-trust identifier can never
    # be replayed to reach an authenticated state -- standard
    # session-fixation mitigation (rotate the ID after a privilege change),
    # not just an in-place flag flip.
    now = datetime.now(UTC)
    new_session = SessionModel(
        tenant_id=session_row.tenant_id,
        user_id=session_row.user_id,
        expires_at=now + timedelta(hours=settings.session_absolute_ttl_hours),
        last_seen_at=now,
        mfa_verified=True,
    )
    db.add(new_session)
    session_row.revoked_at = now

    record_audit_event(
        db,
        tenant_id=new_session.tenant_id,
        user_id=new_session.user_id,
        action="auth.mfa_verified",
        entity_type="user",
        entity_id=new_session.user_id,
    )
    db.commit()
    return new_session


def logout(db: Session, session_id: UUID) -> None:
    session_row = db.execute(
        select(SessionModel).where(SessionModel.id == session_id)
    ).scalar_one_or_none()
    if session_row is None:
        return
    session_row.revoked_at = datetime.now(UTC)
    record_audit_event(
        db,
        tenant_id=session_row.tenant_id,
        user_id=session_row.user_id,
        action="auth.logout",
        entity_type="user",
        entity_id=session_row.user_id,
    )
    db.commit()
