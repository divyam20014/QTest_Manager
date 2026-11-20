"""ADR-074: Platform Admin sign-in with a server-side session and TOTP MFA.

Flow:  login (password) -> 'password_ok' session (grants NO API access)
       -> enrol (first time) or verify (TOTP / recovery code)
       -> 'mfa_verified' session (a NEW token; the pre-MFA one is revoked).

Nothing here logs a password, a TOTP code, a recovery code, a session token
or an MFA secret -- security events carry only the admin's email/id.
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import NoReturn
from uuid import UUID

from fastapi import Request
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core import totp
from app.core.auth import client_ip
from app.core.config import get_settings
from app.core.crypto import CredentialEncryptionError, decrypt_secret, encrypt_secret
from app.core.errors import (
    ConflictError,
    NotFoundError,
    SessionIdleError,
    StepUpRequiredError,
    UnauthorizedError,
    ValidationAppError,
)
from app.core.logging import logger
from app.core.security import hash_password, verify_password
from app.models.identity import PlatformAdmin, PlatformAdminRecoveryCode, PlatformSession
from app.services.platform_audit_service import FAILURE, client_ip_var, record_platform_event

settings = get_settings()

STAGE_PASSWORD_OK = "password_ok"
STAGE_MFA_VERIFIED = "mfa_verified"
RECOVERY_CODE_COUNT = 10
# A session's last_seen_at is only rewritten when it is at least this old, so
# a busy page doesn't turn every request into a write (ADR-083).
TOUCH_INTERVAL_SECONDS = 60
USER_AGENT_DISPLAY_MAX = 120

_RECOVERY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
# No I, O, 0 or 1: the code is read aloud / retyped from another channel.
_ENROLMENT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_dummy_hash: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def hash_user_agent(user_agent: str | None) -> str:
    return hashlib.sha256((user_agent or "").encode()).hexdigest()


def normalize_recovery_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(normalize_recovery_code(code).encode()).hexdigest()


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """16 base32 characters (80 bits) formatted XXXX-XXXX-XXXX-XXXX."""
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(16))
        codes.append("-".join(raw[i : i + 4] for i in range(0, 16, 4)))
    return codes


def generate_enrolment_code() -> str:
    """20 characters from a 32-symbol unambiguous alphabet (100 bits) formatted
    XXXXX-XXXXX-XXXXX-XXXXX."""
    raw = "".join(secrets.choice(_ENROLMENT_ALPHABET) for _ in range(20))
    return "-".join(raw[i : i + 5] for i in range(0, 20, 5))


def hash_enrolment_code(code: str) -> str:
    return hashlib.sha256(normalize_recovery_code(code).encode()).hexdigest()


def issue_enrolment_code(db: Session, admin: PlatformAdmin) -> str:
    """Replaces any previous code with a fresh one and returns the PLAINTEXT
    (shown once to the issuing admin; only its hash is stored). The caller
    owns the commit. No-op refusal for an already-enrolled admin."""
    if mfa_enrolled(admin):
        raise ConflictError("MFA is already enabled for this account")
    code = generate_enrolment_code()
    admin.enrolment_code_hash = hash_enrolment_code(code)
    admin.enrolment_code_expires_at = _now() + timedelta(
        hours=settings.platform_enrolment_code_ttl_hours
    )
    return code


def clear_enrolment_code(admin: PlatformAdmin) -> None:
    admin.enrolment_code_hash = None
    admin.enrolment_code_expires_at = None


def _dummy_password_check(password: str) -> None:
    """Spend the same argon2 time for an unknown email as for a known one."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password("platform-admin-timing-equaliser")
    verify_password(password, _dummy_hash)


# --- sessions ---------------------------------------------------------------


def _create_session(
    db: Session, admin: PlatformAdmin, stage: str, request: Request
) -> tuple[str, PlatformSession]:
    raw = secrets.token_urlsafe(32)
    now = _now()
    if stage == STAGE_MFA_VERIFIED:
        ttl = timedelta(hours=settings.platform_session_absolute_ttl_hours)
    else:
        ttl = timedelta(minutes=settings.platform_pre_mfa_ttl_minutes)
    row = PlatformSession(
        admin_id=admin.id,
        token_hash=hash_token(raw),
        stage=stage,
        expires_at=now + ttl,
        last_seen_at=now,
        mfa_verified_at=now if stage == STAGE_MFA_VERIFIED else None,
        ip_address=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:USER_AGENT_DISPLAY_MAX] or None,
        ua_hash=hash_user_agent(request.headers.get("user-agent")),
        # A TOTP / recovery code was verified moments ago to reach this stage, so
        # the session starts with a fresh step-up (and a replayed code could not
        # be re-used for an immediate second one anyway).
        step_up_at=now if stage == STAGE_MFA_VERIFIED else None,
    )
    db.add(row)
    db.flush()
    return raw, row


def revoke_session(db: Session, session_row: PlatformSession) -> None:
    if session_row.revoked_at is None:
        session_row.revoked_at = _now()


def revoke_all_sessions(db: Session, admin_id: UUID) -> None:
    db.execute(
        update(PlatformSession)
        .where(PlatformSession.admin_id == admin_id, PlatformSession.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def cookie_max_age_seconds(stage: str) -> int:
    if stage == STAGE_MFA_VERIFIED:
        return settings.platform_session_absolute_ttl_hours * 3600
    return settings.platform_pre_mfa_ttl_minutes * 60


def _reject_and_revoke(
    db: Session,
    session_row: PlatformSession,
    admin: PlatformAdmin | None,
    event: str,
    error: Exception,
    reason: str | None = None,
) -> NoReturn:
    """Revokes the session, audits the failure (no secrets) and raises. The
    commit happens here so the revocation and the audit row survive the 401."""
    revoke_session(db, session_row)
    record_platform_event(
        db,
        event,
        outcome=FAILURE,
        actor_admin_id=session_row.admin_id,
        actor_email=admin.email if admin is not None else None,
        details={"reason": reason} if reason else None,
        commit=True,
    )
    logger.warning("security_event=platform_%s admin_id=%s", event, session_row.admin_id)
    raise error


def load_session(
    db: Session,
    raw_token: str | None,
    *,
    stages: tuple[str, ...],
    request: Request | None = None,
) -> tuple[PlatformSession, PlatformAdmin]:
    """Resolves a cookie token to a live (session, admin) pair or raises 401.
    A single generic message for every failure mode -- the caller learns
    nothing about *why* a token is not accepted -- except an idle expiry, which
    only the holder of the (now dead) cookie can trigger. ADR-083: with a
    `request`, a User-Agent change (and, when enabled, an IP change) revokes
    the session and is audited as `session_binding_failed`."""
    unauthorized = UnauthorizedError("Platform admin sign-in required")
    if not raw_token:
        raise unauthorized
    session_row = db.execute(
        select(PlatformSession).where(PlatformSession.token_hash == hash_token(raw_token))
    ).scalar_one_or_none()
    if session_row is None or session_row.revoked_at is not None:
        raise unauthorized
    now = _now()
    if _aware(session_row.expires_at) <= now:  # type: ignore[operator]
        raise unauthorized
    if session_row.stage not in stages:
        raise unauthorized
    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.id == session_row.admin_id)
    ).scalar_one_or_none()
    if session_row.stage == STAGE_MFA_VERIFIED:
        last_seen = _aware(session_row.last_seen_at) or _aware(session_row.created_at)
        idle = timedelta(minutes=settings.platform_session_idle_minutes)
        if last_seen is None or last_seen + idle <= now:
            _reject_and_revoke(
                db,
                session_row,
                admin,
                "session_idle_expired",
                SessionIdleError(settings.platform_session_idle_minutes),
            )
    if admin is None or not admin.is_active:
        raise unauthorized
    locked_until = _aware(admin.locked_until)
    if locked_until is not None and locked_until > now:
        raise unauthorized
    if request is not None:
        if session_row.ua_hash is not None and session_row.ua_hash != hash_user_agent(
            request.headers.get("user-agent")
        ):
            _reject_and_revoke(
                db, session_row, admin, "session_binding_failed", unauthorized, "user_agent"
            )
        if settings.platform_session_bind_ip:
            current_ip = client_ip_var.get() or client_ip(request)
            if session_row.ip_address is not None and session_row.ip_address != current_ip:
                _reject_and_revoke(
                    db, session_row, admin, "session_binding_failed", unauthorized, "ip"
                )
    return session_row, admin


def touch_session(db: Session, session_row: PlatformSession) -> None:
    now = _now()
    last_seen = _aware(session_row.last_seen_at)
    if last_seen is None or (now - last_seen).total_seconds() >= TOUCH_INTERVAL_SECONDS:
        session_row.last_seen_at = now
        db.commit()


# --- step-up and session management (ADR-083) -----------------------------------


def step_up_expires_at(session_row: PlatformSession) -> datetime | None:
    """When the session's last step-up lapses, or None when it has none/stale."""
    verified = _aware(session_row.step_up_at)
    if verified is None:
        return None
    expires = verified + timedelta(minutes=settings.platform_step_up_minutes)
    return expires if expires > _now() else None


def require_step_up(session_row: PlatformSession) -> None:
    """Raises 403 `step_up_required` unless a TOTP / recovery code was verified
    on this session within the step-up window."""
    if step_up_expires_at(session_row) is None:
        raise StepUpRequiredError()


def step_up(
    db: Session, session_row: PlatformSession, *, code: str | None, recovery_code: str | None
) -> datetime:
    """Verifies a current TOTP (replay-protected) or recovery code and stamps the
    session. A wrong code goes through the shared MFA lockout."""
    admin = _lock_admin(db, session_row.admin_id)
    _refuse_if_locked(admin)
    if not mfa_enrolled(admin):
        raise UnauthorizedError("MFA enrolment is required")
    _consume_second_factor(
        db,
        admin,
        code=code,
        recovery_code=recovery_code,
        failure_event="platform_admin_step_up_failed",
    )
    session_row.step_up_at = _now()
    record_platform_event(
        db,
        "step_up_ok",
        actor_admin_id=admin.id,
        actor_email=admin.email,
        details={"method": "recovery_code" if recovery_code else "totp"},
    )
    db.commit()
    expires = step_up_expires_at(session_row)
    assert expires is not None
    return expires


def list_own_sessions(db: Session, admin_id: UUID) -> list[PlatformSession]:
    return list(
        db.execute(
            select(PlatformSession)
            .where(
                PlatformSession.admin_id == admin_id,
                PlatformSession.stage == STAGE_MFA_VERIFIED,
                PlatformSession.revoked_at.is_(None),
                PlatformSession.expires_at > _now(),
            )
            .order_by(PlatformSession.created_at.desc())
        )
        .scalars()
        .all()
    )


def revoke_own_session(db: Session, admin: PlatformAdmin, session_id: UUID) -> PlatformSession:
    """Revokes one of the CALLER's sessions. Someone else's id (or an unknown /
    already-revoked one) is a plain 404, so ids cannot be probed."""
    row = db.execute(
        select(PlatformSession).where(
            PlatformSession.id == session_id,
            PlatformSession.admin_id == admin.id,
            PlatformSession.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("Session not found")
    revoke_session(db, row)
    record_platform_event(db, "session_revoked", actor_admin_id=admin.id, actor_email=admin.email)
    db.commit()
    return row


# --- password step ----------------------------------------------------------


def login(db: Session, email: str, password: str, request: Request) -> tuple[str, PlatformAdmin]:
    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == email)
    ).scalar_one_or_none()
    now = _now()

    if admin is not None:
        locked_until = _aware(admin.locked_until)
        if locked_until is not None and locked_until > now:
            logger.warning(
                "security_event=platform_admin_login_blocked reason=locked email=%s", email
            )
            record_platform_event(
                db,
                "login_blocked",
                outcome=FAILURE,
                actor_admin_id=admin.id,
                actor_email=email,
                details={"reason": "locked"},
                commit=True,
            )
            raise UnauthorizedError("Account temporarily locked due to repeated failed logins")

    if admin is None:
        _dummy_password_check(password)
        logger.warning("security_event=platform_admin_login_failed email=%s", email)
        record_platform_event(
            db,
            "login_failed",
            outcome=FAILURE,
            actor_email=email,
            details={"reason": "unknown_account"},
            commit=True,
        )
        raise UnauthorizedError("Invalid platform admin credentials")

    if not verify_password(password, admin.password_hash):
        admin.failed_login_count += 1
        record_platform_event(
            db,
            "login_failed",
            outcome=FAILURE,
            actor_admin_id=admin.id,
            actor_email=email,
            details={"reason": "bad_password"},
        )
        if admin.failed_login_count >= settings.platform_admin_max_failed_logins:
            admin.locked_until = now + timedelta(minutes=settings.platform_admin_lockout_minutes)
            logger.warning("security_event=platform_admin_locked_out email=%s", email)
            record_platform_event(
                db,
                "lockout",
                outcome=FAILURE,
                actor_admin_id=admin.id,
                actor_email=email,
                details={"reason": "password"},
            )
        db.commit()
        logger.warning("security_event=platform_admin_login_failed email=%s", email)
        raise UnauthorizedError("Invalid platform admin credentials")

    # Only reveal deactivation to someone who knows the password.
    if not admin.is_active:
        logger.warning(
            "security_event=platform_admin_login_blocked reason=inactive email=%s", email
        )
        record_platform_event(
            db,
            "login_blocked",
            outcome=FAILURE,
            actor_admin_id=admin.id,
            actor_email=email,
            details={"reason": "inactive"},
            commit=True,
        )
        raise UnauthorizedError("This platform admin account has been deactivated")

    # ADR-081: after an admin-issued reset the old password is dead; the only
    # way in is the reset-code flow (also covers an expired, unused code).
    if admin.password_reset_code_hash is not None:
        logger.warning(
            "security_event=platform_admin_login_blocked reason=password_reset_pending email=%s",
            email,
        )
        record_platform_event(
            db,
            "login_blocked",
            outcome=FAILURE,
            actor_admin_id=admin.id,
            actor_email=email,
            details={"reason": "password_reset_pending"},
            commit=True,
        )
        raise UnauthorizedError(
            'A password reset is pending for this account; use "Have a reset code?"'
        )

    if admin.failed_login_count or admin.locked_until:
        admin.failed_login_count = 0
        admin.locked_until = None
    raw, _ = _create_session(db, admin, STAGE_PASSWORD_OK, request)
    record_platform_event(
        db, "login_password_ok", actor_admin_id=admin.id, actor_email=email, ip=client_ip(request)
    )
    db.commit()
    logger.info("security_event=platform_admin_password_ok email=%s", email)
    return raw, admin


# --- MFA --------------------------------------------------------------------


def mfa_enrolled(admin: PlatformAdmin) -> bool:
    return admin.mfa_enabled_at is not None and admin.mfa_secret_encrypted is not None


def _secret_of(admin: PlatformAdmin, db: Session) -> str:
    assert admin.mfa_secret_encrypted is not None
    try:
        return decrypt_secret(admin.mfa_secret_encrypted)
    except CredentialEncryptionError:
        logger.error("security_event=platform_admin_mfa_secret_unreadable email=%s", admin.email)
        record_platform_event(
            db,
            "mfa_secret_unreadable",
            outcome=FAILURE,
            actor_admin_id=admin.id,
            actor_email=admin.email,
            commit=True,
        )
        raise UnauthorizedError(
            "Verification is unavailable; contact the platform operator"
        ) from None


def _register_mfa_failure(
    db: Session,
    admin: PlatformAdmin,
    *,
    event: str = "platform_admin_mfa_failed",
    message: str = "Invalid verification code",
) -> NoReturn:
    admin.mfa_failed_count += 1
    logger.warning("security_event=%s email=%s", event, admin.email)
    record_platform_event(
        db,
        event.removeprefix("platform_admin_"),
        outcome=FAILURE,
        actor_admin_id=admin.id,
        actor_email=admin.email,
    )
    if admin.mfa_failed_count >= settings.platform_mfa_max_failed_attempts:
        admin.mfa_failed_count = 0
        admin.locked_until = _now() + timedelta(minutes=settings.platform_admin_lockout_minutes)
        revoke_all_sessions(db, admin.id)
        logger.warning("security_event=platform_admin_mfa_locked_out email=%s", admin.email)
        record_platform_event(
            db,
            "lockout",
            outcome=FAILURE,
            actor_admin_id=admin.id,
            actor_email=admin.email,
            details={"reason": "mfa"},
        )
        db.commit()
        raise UnauthorizedError("Too many incorrect codes; the account is temporarily locked")
    db.commit()
    raise UnauthorizedError(message)


ENROLMENT_CODE_ERROR = "Invalid or expired enrolment code"
_NO_CODE_HASH = hashlib.sha256(b"no-enrolment-code").hexdigest()


def _require_enrolment_code(db: Session, admin: PlatformAdmin, code: str) -> None:
    """ADR-080: a valid, unexpired enrolment code is required before any
    secret is issued or enrolment completes. A failure counts towards the same
    lockout as a wrong MFA code and never says which part was wrong. A success
    does NOT consume the code (only a completed enrolment does), so a wrong
    guess by someone else cannot burn it."""
    stored = admin.enrolment_code_hash
    expires = _aware(admin.enrolment_code_expires_at)
    # Always one constant-time comparison, even when no code is set.
    same = hmac.compare_digest(stored or _NO_CODE_HASH, hash_enrolment_code(code))
    if not (stored is not None and same and expires is not None and expires > _now()):
        _register_mfa_failure(
            db, admin, event="platform_admin_enrolment_code_failed", message=ENROLMENT_CODE_ERROR
        )


def start_enrolment(db: Session, admin: PlatformAdmin, enrolment_code: str) -> tuple[str, str]:
    """Generates (or regenerates) a PENDING secret. It grants nothing until
    the first code is confirmed. Refused once MFA is enabled, and refused
    without a valid enrolment code (ADR-080)."""
    admin = _lock_admin(db, admin.id)
    if mfa_enrolled(admin):
        raise ConflictError("MFA is already enabled for this account")
    _require_enrolment_code(db, admin, enrolment_code)
    secret = totp.generate_secret()
    admin.mfa_secret_encrypted = encrypt_secret(secret)
    admin.mfa_enabled_at = None
    admin.mfa_last_used_step = None
    db.commit()
    return secret, totp.provisioning_uri(secret, admin.email, settings.platform_mfa_issuer)


def _lock_admin(db: Session, admin_id: UUID) -> PlatformAdmin:
    # populate_existing: if this Session already loaded the admin (e.g. while
    # resolving the session), a request that waited on the row lock must still
    # see the winner's committed mfa_last_used_step / failure counters, not its
    # stale copy -- otherwise two simultaneous requests can both accept one code.
    return db.execute(
        select(PlatformAdmin)
        .where(PlatformAdmin.id == admin_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def finish_enrolment(
    db: Session, session_row: PlatformSession, code: str, enrolment_code: str, request: Request
) -> tuple[str, list[str]]:
    """Confirms the first code, enables MFA, issues recovery codes (returned
    ONCE) and promotes the sign-in to a fully authenticated session. The
    enrolment code is checked again and consumed here (ADR-080)."""
    admin = _lock_admin(db, session_row.admin_id)
    if mfa_enrolled(admin):
        raise ConflictError("MFA is already enabled for this account")
    _require_enrolment_code(db, admin, enrolment_code)
    if admin.mfa_secret_encrypted is None:
        raise ValidationAppError("Start enrolment first")
    step = totp.verify_totp(_secret_of(admin, db), code)
    if step is None:
        _register_mfa_failure(db, admin)
    clear_enrolment_code(admin)
    admin.mfa_enabled_at = _now()
    admin.mfa_last_used_step = step
    admin.mfa_failed_count = 0
    db.execute(
        delete(PlatformAdminRecoveryCode).where(PlatformAdminRecoveryCode.admin_id == admin.id)
    )
    codes = generate_recovery_codes()
    for plain in codes:
        db.add(PlatformAdminRecoveryCode(admin_id=admin.id, code_hash=hash_recovery_code(plain)))
    revoke_session(db, session_row)
    raw, _ = _create_session(db, admin, STAGE_MFA_VERIFIED, request)
    record_platform_event(db, "mfa_enrolled", actor_admin_id=admin.id, actor_email=admin.email)
    db.commit()
    logger.warning("security_event=platform_admin_mfa_enrolled email=%s", admin.email)
    return raw, codes


def _consume_second_factor(
    db: Session,
    admin: PlatformAdmin,
    *,
    code: str | None,
    recovery_code: str | None,
    failure_event: str = "platform_admin_mfa_failed",
) -> None:
    """Verifies a TOTP code (replay-protected) or consumes a single-use
    recovery code for an ENROLLED, row-locked admin. A failure goes through the
    shared MFA lockout and raises; success resets the MFA failure counter. The
    caller owns the commit."""
    if recovery_code:
        unused = (
            db.execute(
                select(PlatformAdminRecoveryCode).where(
                    PlatformAdminRecoveryCode.admin_id == admin.id,
                    PlatformAdminRecoveryCode.used_at.is_(None),
                )
            )
            .scalars()
            .all()
        )
        wanted = hash_recovery_code(recovery_code)
        match = None
        for candidate in unused:  # no early exit: constant work per attempt
            if hmac.compare_digest(candidate.code_hash, wanted):
                match = candidate
        if match is None:
            _register_mfa_failure(db, admin, event=failure_event)
        match.used_at = _now()
        record_platform_event(
            db, "recovery_code_used", actor_admin_id=admin.id, actor_email=admin.email
        )
        logger.warning("security_event=platform_admin_recovery_code_used email=%s", admin.email)
    else:
        step = totp.verify_totp(
            _secret_of(admin, db), code or "", last_used_step=admin.mfa_last_used_step
        )
        if step is None:
            _register_mfa_failure(db, admin, event=failure_event)
        admin.mfa_last_used_step = step
    admin.mfa_failed_count = 0


def verify_mfa(
    db: Session,
    session_row: PlatformSession,
    request: Request,
    *,
    code: str | None,
    recovery_code: str | None,
) -> str:
    """TOTP code or single-use recovery code -> fully authenticated session."""
    admin = _lock_admin(db, session_row.admin_id)
    if not mfa_enrolled(admin):
        raise UnauthorizedError("MFA enrolment is required before signing in")

    _consume_second_factor(db, admin, code=code, recovery_code=recovery_code)
    revoke_session(db, session_row)
    raw, _ = _create_session(db, admin, STAGE_MFA_VERIFIED, request)
    record_platform_event(
        db,
        "mfa_success",
        actor_admin_id=admin.id,
        actor_email=admin.email,
        details={"method": "recovery_code" if recovery_code else "totp"},
    )
    db.commit()
    logger.info("security_event=platform_admin_signed_in email=%s", admin.email)
    return raw


def remaining_recovery_codes(db: Session, admin_id: UUID) -> int:
    return len(
        db.execute(
            select(PlatformAdminRecoveryCode.id).where(
                PlatformAdminRecoveryCode.admin_id == admin_id,
                PlatformAdminRecoveryCode.used_at.is_(None),
            )
        ).all()
    )


# --- password change / admin-initiated reset (ADR-081) -------------------------


def _register_password_failure(
    db: Session, admin: PlatformAdmin, *, event: str, message: str
) -> NoReturn:
    """A wrong current password or reset code counts toward the SAME
    5-strikes/15-minute lockout as a wrong sign-in password."""
    admin.failed_login_count += 1
    logger.warning("security_event=%s email=%s", event, admin.email)
    record_platform_event(
        db,
        event.removeprefix("platform_admin_"),
        outcome=FAILURE,
        actor_admin_id=admin.id,
        actor_email=admin.email,
    )
    if admin.failed_login_count >= settings.platform_admin_max_failed_logins:
        admin.locked_until = _now() + timedelta(minutes=settings.platform_admin_lockout_minutes)
        revoke_all_sessions(db, admin.id)
        logger.warning("security_event=platform_admin_locked_out email=%s", admin.email)
        record_platform_event(
            db,
            "lockout",
            outcome=FAILURE,
            actor_admin_id=admin.id,
            actor_email=admin.email,
            details={"reason": "password"},
        )
    db.commit()
    raise UnauthorizedError(message)


def _refuse_if_locked(admin: PlatformAdmin) -> None:
    locked_until = _aware(admin.locked_until)
    if locked_until is not None and locked_until > _now():
        raise UnauthorizedError("Account temporarily locked due to repeated failed attempts")


def issue_password_reset_code(db: Session, admin: PlatformAdmin) -> str:
    """Replaces any previous reset code, revokes every session of the admin and
    returns the PLAINTEXT (shown once to the issuing admin; only its hash is
    stored). While the code is pending the old password no longer signs in.
    The caller owns the commit."""
    code = generate_enrolment_code()
    admin.password_reset_code_hash = hash_enrolment_code(code)
    admin.password_reset_code_expires_at = _now() + timedelta(
        hours=settings.platform_password_reset_code_ttl_hours
    )
    revoke_all_sessions(db, admin.id)
    return code


def clear_password_reset_code(admin: PlatformAdmin) -> None:
    admin.password_reset_code_hash = None
    admin.password_reset_code_expires_at = None


def change_password(
    db: Session,
    session_row: PlatformSession,
    *,
    current_password: str,
    new_password: str,
    code: str | None,
    recovery_code: str | None,
) -> None:
    """Self-service change for a fully signed-in admin: current password AND a
    fresh authenticator (TOTP, replay-protected) or recovery code. Every OTHER
    session of the admin is revoked; the calling session stays."""
    admin = _lock_admin(db, session_row.admin_id)
    _refuse_if_locked(admin)
    if not mfa_enrolled(admin):
        raise UnauthorizedError("MFA enrolment is required")
    if not verify_password(current_password, admin.password_hash):
        _register_password_failure(
            db,
            admin,
            event="platform_admin_password_change_failed",
            message="Current password or verification code is incorrect",
        )
    if verify_password(new_password, admin.password_hash):
        raise ValidationAppError("New password must differ from the current password")
    _consume_second_factor(db, admin, code=code, recovery_code=recovery_code)
    admin.password_hash = hash_password(new_password)
    admin.failed_login_count = 0
    db.execute(
        update(PlatformSession)
        .where(
            PlatformSession.admin_id == admin.id,
            PlatformSession.id != session_row.id,
            PlatformSession.revoked_at.is_(None),
        )
        .values(revoked_at=_now())
    )
    record_platform_event(db, "password_changed", actor_admin_id=admin.id, actor_email=admin.email)
    db.commit()
    logger.warning("security_event=platform_admin_password_changed email=%s", admin.email)


PASSWORD_RESET_CODE_ERROR = "Invalid or expired reset code"


def reset_password_with_code(
    db: Session,
    email: str,
    reset_code: str,
    new_password: str,
    *,
    code: str | None,
    recovery_code: str | None,
) -> None:
    """Reset flow for an admin whose password was reset by another admin. Needs
    the one-time reset code, plus the authenticator code when enrolled. Any
    failure is a generic 401 that counts toward the lockout and never burns the
    code; success sets the password, consumes the code and clears all sessions."""
    found = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == email)
    ).scalar_one_or_none()
    if found is None or not found.is_active:
        _dummy_password_check(reset_code)
        logger.warning("security_event=platform_admin_password_reset_failed email=%s", email)
        record_platform_event(
            db,
            "password_reset_failed",
            outcome=FAILURE,
            actor_email=email,
            details={"reason": "unknown_or_inactive_account"},
            commit=True,
        )
        raise UnauthorizedError(PASSWORD_RESET_CODE_ERROR)
    admin = _lock_admin(db, found.id)
    _refuse_if_locked(admin)

    stored = admin.password_reset_code_hash
    expires = _aware(admin.password_reset_code_expires_at)
    same = hmac.compare_digest(stored or _NO_CODE_HASH, hash_enrolment_code(reset_code))
    if not (stored is not None and same and expires is not None and expires > _now()):
        _register_password_failure(
            db,
            admin,
            event="platform_admin_password_reset_failed",
            message=PASSWORD_RESET_CODE_ERROR,
        )
    if mfa_enrolled(admin):
        _consume_second_factor(db, admin, code=code, recovery_code=recovery_code)

    admin.password_hash = hash_password(new_password)
    clear_password_reset_code(admin)
    admin.failed_login_count = 0
    admin.locked_until = None
    revoke_all_sessions(db, admin.id)
    record_platform_event(
        db, "password_reset_completed", actor_admin_id=admin.id, actor_email=admin.email
    )
    db.commit()
    logger.warning("security_event=platform_admin_password_reset_completed email=%s", admin.email)


# --- operator tooling (CLI + admin-resets-admin) ------------------------------


def reset_mfa(db: Session, admin: PlatformAdmin, actor_admin_id: UUID | None = None) -> str:
    """Clears MFA (secret, recovery codes, replay marker, counters) and
    revokes every session, so the admin must re-enrol on next sign-in with a
    FRESH enrolment code, returned here in plaintext once (ADR-080)."""
    admin.mfa_secret_encrypted = None
    admin.mfa_enabled_at = None
    admin.mfa_last_used_step = None
    admin.mfa_failed_count = 0
    db.execute(
        delete(PlatformAdminRecoveryCode).where(PlatformAdminRecoveryCode.admin_id == admin.id)
    )
    revoke_all_sessions(db, admin.id)
    enrolment_code = issue_enrolment_code(db, admin)
    record_platform_event(
        db,
        "mfa_reset",
        actor_admin_id=actor_admin_id or admin.id,
        target_admin_id=admin.id,
        details={"source": "admin" if actor_admin_id else "cli", "target_email": admin.email},
    )
    db.commit()
    logger.warning("security_event=platform_admin_mfa_reset email=%s", admin.email)
    return enrolment_code


def preenrol_with_secret(db: Session, admin: PlatformAdmin, secret_b32: str) -> None:
    """DEV/TEST ONLY (guarded by the callers): enable MFA with a known secret
    so automated tests can sign in without a human scanning a QR code."""
    if not totp.is_valid_secret(secret_b32):
        raise ValidationAppError("Not a valid base32 TOTP secret (>= 16 characters)")
    admin.mfa_secret_encrypted = encrypt_secret(secret_b32.strip().replace(" ", "").upper())
    admin.mfa_enabled_at = _now()
    admin.mfa_last_used_step = None
    admin.mfa_failed_count = 0
    clear_enrolment_code(admin)
    db.execute(
        delete(PlatformAdminRecoveryCode).where(PlatformAdminRecoveryCode.admin_id == admin.id)
    )
    revoke_all_sessions(db, admin.id)
    db.commit()
