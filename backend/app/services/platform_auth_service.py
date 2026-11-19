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
from app.core.errors import ConflictError, UnauthorizedError, ValidationAppError
from app.core.logging import logger
from app.core.security import hash_password, verify_password
from app.models.identity import PlatformAdmin, PlatformAdminRecoveryCode, PlatformSession

settings = get_settings()

STAGE_PASSWORD_OK = "password_ok"
STAGE_MFA_VERIFIED = "mfa_verified"
RECOVERY_CODE_COUNT = 10
# A session's last_seen_at is only rewritten when it is at least this old, so
# a busy page doesn't turn every request into a write.
TOUCH_INTERVAL_SECONDS = 30

_RECOVERY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
_dummy_hash: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


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
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
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


def load_session(
    db: Session, raw_token: str | None, *, stages: tuple[str, ...]
) -> tuple[PlatformSession, PlatformAdmin]:
    """Resolves a cookie token to a live (session, admin) pair or raises 401.
    A single generic message for every failure mode -- the caller learns
    nothing about *why* a token is not accepted."""
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
    if session_row.stage == STAGE_MFA_VERIFIED:
        last_seen = _aware(session_row.last_seen_at) or _aware(session_row.created_at)
        idle = timedelta(minutes=settings.platform_session_idle_timeout_minutes)
        if last_seen is None or last_seen + idle <= now:
            raise unauthorized
    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.id == session_row.admin_id)
    ).scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise unauthorized
    locked_until = _aware(admin.locked_until)
    if locked_until is not None and locked_until > now:
        raise unauthorized
    return session_row, admin


def touch_session(db: Session, session_row: PlatformSession) -> None:
    now = _now()
    last_seen = _aware(session_row.last_seen_at)
    if last_seen is None or (now - last_seen).total_seconds() >= TOUCH_INTERVAL_SECONDS:
        session_row.last_seen_at = now
        db.commit()


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
            raise UnauthorizedError("Account temporarily locked due to repeated failed logins")

    if admin is None:
        _dummy_password_check(password)
        logger.warning("security_event=platform_admin_login_failed email=%s", email)
        raise UnauthorizedError("Invalid platform admin credentials")

    if not verify_password(password, admin.password_hash):
        admin.failed_login_count += 1
        if admin.failed_login_count >= settings.platform_admin_max_failed_logins:
            admin.locked_until = now + timedelta(minutes=settings.platform_admin_lockout_minutes)
            logger.warning("security_event=platform_admin_locked_out email=%s", email)
        db.commit()
        logger.warning("security_event=platform_admin_login_failed email=%s", email)
        raise UnauthorizedError("Invalid platform admin credentials")

    # Only reveal deactivation to someone who knows the password.
    if not admin.is_active:
        logger.warning(
            "security_event=platform_admin_login_blocked reason=inactive email=%s", email
        )
        raise UnauthorizedError("This platform admin account has been deactivated")

    if admin.failed_login_count or admin.locked_until:
        admin.failed_login_count = 0
        admin.locked_until = None
    raw, _ = _create_session(db, admin, STAGE_PASSWORD_OK, request)
    db.commit()
    logger.info("security_event=platform_admin_password_ok email=%s", email)
    return raw, admin


# --- MFA --------------------------------------------------------------------


def mfa_enrolled(admin: PlatformAdmin) -> bool:
    return admin.mfa_enabled_at is not None and admin.mfa_secret_encrypted is not None


def _secret_of(admin: PlatformAdmin) -> str:
    assert admin.mfa_secret_encrypted is not None
    try:
        return decrypt_secret(admin.mfa_secret_encrypted)
    except CredentialEncryptionError:
        logger.error("security_event=platform_admin_mfa_secret_unreadable email=%s", admin.email)
        raise UnauthorizedError(
            "Verification is unavailable; contact the platform operator"
        ) from None


def _register_mfa_failure(db: Session, admin: PlatformAdmin) -> NoReturn:
    admin.mfa_failed_count += 1
    logger.warning("security_event=platform_admin_mfa_failed email=%s", admin.email)
    if admin.mfa_failed_count >= settings.platform_mfa_max_failed_attempts:
        admin.mfa_failed_count = 0
        admin.locked_until = _now() + timedelta(minutes=settings.platform_admin_lockout_minutes)
        revoke_all_sessions(db, admin.id)
        logger.warning("security_event=platform_admin_mfa_locked_out email=%s", admin.email)
        db.commit()
        raise UnauthorizedError("Too many incorrect codes; the account is temporarily locked")
    db.commit()
    raise UnauthorizedError("Invalid verification code")


def start_enrolment(db: Session, admin: PlatformAdmin) -> tuple[str, str]:
    """Generates (or regenerates) a PENDING secret. It grants nothing until
    the first code is confirmed. Refused once MFA is enabled."""
    if mfa_enrolled(admin):
        raise ConflictError("MFA is already enabled for this account")
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
    db: Session, session_row: PlatformSession, code: str, request: Request
) -> tuple[str, list[str]]:
    """Confirms the first code, enables MFA, issues recovery codes (returned
    ONCE) and promotes the sign-in to a fully authenticated session."""
    admin = _lock_admin(db, session_row.admin_id)
    if mfa_enrolled(admin):
        raise ConflictError("MFA is already enabled for this account")
    if admin.mfa_secret_encrypted is None:
        raise ValidationAppError("Start enrolment first")
    step = totp.verify_totp(_secret_of(admin), code)
    if step is None:
        _register_mfa_failure(db, admin)
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
    db.commit()
    logger.warning("security_event=platform_admin_mfa_enrolled email=%s", admin.email)
    return raw, codes


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
            _register_mfa_failure(db, admin)
        match.used_at = _now()
        logger.warning("security_event=platform_admin_recovery_code_used email=%s", admin.email)
    else:
        step = totp.verify_totp(
            _secret_of(admin), code or "", last_used_step=admin.mfa_last_used_step
        )
        if step is None:
            _register_mfa_failure(db, admin)
        admin.mfa_last_used_step = step

    admin.mfa_failed_count = 0
    revoke_session(db, session_row)
    raw, _ = _create_session(db, admin, STAGE_MFA_VERIFIED, request)
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


# --- operator tooling (CLI + admin-resets-admin) ------------------------------


def reset_mfa(db: Session, admin: PlatformAdmin) -> None:
    """Clears MFA (secret, recovery codes, replay marker, counters) and
    revokes every session, so the admin must re-enrol on next sign-in."""
    admin.mfa_secret_encrypted = None
    admin.mfa_enabled_at = None
    admin.mfa_last_used_step = None
    admin.mfa_failed_count = 0
    db.execute(
        delete(PlatformAdminRecoveryCode).where(PlatformAdminRecoveryCode.admin_id == admin.id)
    )
    revoke_all_sessions(db, admin.id)
    db.commit()
    logger.warning("security_event=platform_admin_mfa_reset email=%s", admin.email)


def preenrol_with_secret(db: Session, admin: PlatformAdmin, secret_b32: str) -> None:
    """DEV/TEST ONLY (guarded by the callers): enable MFA with a known secret
    so automated tests can sign in without a human scanning a QR code."""
    if not totp.is_valid_secret(secret_b32):
        raise ValidationAppError("Not a valid base32 TOTP secret (>= 16 characters)")
    admin.mfa_secret_encrypted = encrypt_secret(secret_b32.strip().replace(" ", "").upper())
    admin.mfa_enabled_at = _now()
    admin.mfa_last_used_step = None
    admin.mfa_failed_count = 0
    db.execute(
        delete(PlatformAdminRecoveryCode).where(PlatformAdminRecoveryCode.admin_id == admin.id)
    )
    revoke_all_sessions(db, admin.id)
    db.commit()
