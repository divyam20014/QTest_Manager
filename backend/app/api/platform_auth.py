"""ADR-074: Platform Admin sign-in (password -> TOTP -> session)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import UnauthorizedError, ValidationAppError
from app.core.platform_auth import enforce_same_origin, platform_session_token
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.models.identity import PlatformAdmin, PlatformSession
from app.schemas.platform_auth import (
    PlatformEnrolFinishOut,
    PlatformEnrolStartOut,
    PlatformEnrolStartRequest,
    PlatformEnrolVerifyRequest,
    PlatformLoginRequest,
    PlatformMfaVerifyRequest,
    PlatformPasswordChangeRequest,
    PlatformPasswordResetRequest,
    PlatformSessionListItem,
    PlatformSessionOut,
    PlatformStepUpOut,
    PlatformStepUpRequest,
)
from app.services import platform_auth_service as svc
from app.services.platform_audit_service import record_platform_event

settings = get_settings()
router = APIRouter(prefix="/platform/auth", tags=["platform-auth"])

COOKIE_PATH = "/api/v1/platform"


def pre_mfa_session(
    request: Request, db: Session = Depends(get_db)
) -> tuple[PlatformSession, PlatformAdmin]:
    """A live password-verified, MFA-pending session. A dependency (not code
    in the handler) so an unauthenticated caller gets 401 before request-body
    validation can answer 422, same as every other platform route."""
    enforce_same_origin(request)
    return svc.load_session(
        db, platform_session_token(request), stages=(svc.STAGE_PASSWORD_OK,), request=request
    )


def full_session(
    request: Request, db: Session = Depends(get_db)
) -> tuple[PlatformSession, PlatformAdmin]:
    """A live, fully authenticated (mfa_verified) session; unlike
    require_platform_admin it also hands the handler the session row so the
    caller can keep it while revoking the others."""
    enforce_same_origin(request)
    session_row, admin = svc.load_session(
        db, platform_session_token(request), stages=(svc.STAGE_MFA_VERIFIED,), request=request
    )
    svc.touch_session(db, session_row)
    return session_row, admin


def _set_cookie(response: Response, raw_token: str, stage: str) -> None:
    response.set_cookie(
        key=settings.platform_session_cookie_name,
        value=raw_token,
        httponly=True,
        # Strict: the console is a same-site SPA, and nothing legitimate
        # navigates to a platform API URL from another site.
        samesite="strict",
        secure=settings.environment != "development",
        path=COOKIE_PATH,
        max_age=svc.cookie_max_age_seconds(stage),
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.platform_session_cookie_name, path=COOKIE_PATH)


@router.post("/login")
@limiter.limit(scaled(10))
def login(
    req: PlatformLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    enforce_same_origin(request)
    raw, admin = svc.login(db, req.email, req.password, request)
    _set_cookie(response, raw, svc.STAGE_PASSWORD_OK)
    return envelope(
        PlatformSessionOut(
            email=admin.email,
            stage=svc.STAGE_PASSWORD_OK,
            mfa_enrolled=svc.mfa_enrolled(admin),
        ).model_dump()
    )


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)) -> dict:
    session_row, admin = svc.load_session(
        db,
        platform_session_token(request),
        stages=(svc.STAGE_PASSWORD_OK, svc.STAGE_MFA_VERIFIED),
        request=request,
    )
    if session_row.stage == svc.STAGE_MFA_VERIFIED:
        svc.touch_session(db, session_row)
    return envelope(
        PlatformSessionOut(
            email=admin.email,
            stage=session_row.stage,
            mfa_enrolled=svc.mfa_enrolled(admin),
            recovery_codes_remaining=(
                svc.remaining_recovery_codes(db, admin.id)
                if session_row.stage == svc.STAGE_MFA_VERIFIED and svc.mfa_enrolled(admin)
                else None
            ),
            step_up_expires_at=(
                svc.step_up_expires_at(session_row)
                if session_row.stage == svc.STAGE_MFA_VERIFIED
                else None
            ),
        ).model_dump(mode="json")
    )


@router.post("/mfa/enroll/start")
@limiter.limit(scaled(10))
def enrol_start(
    req: PlatformEnrolStartRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: tuple[PlatformSession, PlatformAdmin] = Depends(pre_mfa_session),
) -> dict:
    _, admin = session
    secret, uri = svc.start_enrolment(db, admin, req.enrolment_code)
    return envelope(
        PlatformEnrolStartOut(
            secret=secret,
            otpauth_uri=uri,
            issuer=settings.platform_mfa_issuer,
            account=admin.email,
        ).model_dump()
    )


@router.post("/mfa/enroll/verify")
@limiter.limit(scaled(10))
def enrol_verify(
    req: PlatformEnrolVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: tuple[PlatformSession, PlatformAdmin] = Depends(pre_mfa_session),
) -> dict:
    session_row, admin = session
    raw, codes = svc.finish_enrolment(db, session_row, req.code, req.enrolment_code, request)
    _set_cookie(response, raw, svc.STAGE_MFA_VERIFIED)
    return envelope(
        PlatformEnrolFinishOut(
            email=admin.email, stage=svc.STAGE_MFA_VERIFIED, recovery_codes=codes
        ).model_dump()
    )


@router.post("/mfa/verify")
@limiter.limit(scaled(10))
def mfa_verify(
    req: PlatformMfaVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: tuple[PlatformSession, PlatformAdmin] = Depends(pre_mfa_session),
) -> dict:
    session_row, admin = session
    if bool(req.code) == bool(req.recovery_code):
        raise ValidationAppError("Provide either a verification code or a recovery code")
    raw = svc.verify_mfa(db, session_row, request, code=req.code, recovery_code=req.recovery_code)
    _set_cookie(response, raw, svc.STAGE_MFA_VERIFIED)
    return envelope(
        PlatformSessionOut(
            email=admin.email,
            stage=svc.STAGE_MFA_VERIFIED,
            mfa_enrolled=True,
            recovery_codes_remaining=svc.remaining_recovery_codes(db, admin.id),
        ).model_dump()
    )


@router.post("/password/change")
@limiter.limit(scaled(5))
def change_password(
    req: PlatformPasswordChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: tuple[PlatformSession, PlatformAdmin] = Depends(full_session),
) -> dict:
    """ADR-081: current password + fresh authenticator/recovery code. Revokes the
    admin's OTHER sessions; this one stays signed in."""
    session_row, _ = session
    if bool(req.code) == bool(req.recovery_code):
        raise ValidationAppError("Provide either a verification code or a recovery code")
    svc.change_password(
        db,
        session_row,
        current_password=req.current_password,
        new_password=req.new_password,
        code=req.code,
        recovery_code=req.recovery_code,
    )
    return envelope({"password_changed": True})


@router.post("/password/reset")
@limiter.limit(scaled(10))
def reset_password(
    req: PlatformPasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """ADR-081: complete an admin-initiated reset with the one-time reset code.
    Unauthenticated by design (the target's sessions were revoked); sign in
    normally afterwards."""
    enforce_same_origin(request)
    if req.code and req.recovery_code:
        raise ValidationAppError("Provide either a verification code or a recovery code")
    svc.reset_password_with_code(
        db,
        req.email,
        req.reset_code,
        req.new_password,
        code=req.code,
        recovery_code=req.recovery_code,
    )
    return envelope({"password_reset": True})


@router.post("/step-up")
@limiter.limit(scaled(10))
def step_up(
    req: PlatformStepUpRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: tuple[PlatformSession, PlatformAdmin] = Depends(full_session),
) -> dict:
    """ADR-083: prove possession of the authenticator (current TOTP or a recovery
    code) so sensitive actions are allowed for the next few minutes."""
    session_row, _ = session
    if bool(req.code) == bool(req.recovery_code):
        raise ValidationAppError("Provide either a verification code or a recovery code")
    expires = svc.step_up(db, session_row, code=req.code, recovery_code=req.recovery_code)
    return envelope(PlatformStepUpOut(step_up_expires_at=expires).model_dump(mode="json"))


@router.get("/sessions")
def list_sessions(
    session: tuple[PlatformSession, PlatformAdmin] = Depends(full_session),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-083: the caller's own live sessions. Never includes token hashes."""
    session_row, admin = session
    items = [
        PlatformSessionListItem(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            ip_address=row.ip_address,
            user_agent=row.user_agent,
            current=row.id == session_row.id,
        ).model_dump(mode="json")
        for row in svc.list_own_sessions(db, admin.id)
    ]
    return envelope(items)


@router.delete("/sessions/{session_id}")
def revoke_session(
    session_id: UUID,
    response: Response,
    session: tuple[PlatformSession, PlatformAdmin] = Depends(full_session),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-083: sign one of your own sessions out. Another admin's session id is
    a 404. Revoking the current session also clears this browser's cookie."""
    session_row, admin = session
    revoked = svc.revoke_own_session(db, admin, session_id)
    if revoked.id == session_row.id:
        _clear_cookie(response)
    return envelope({"revoked": True, "current": revoked.id == session_row.id})


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    enforce_same_origin(request)
    try:
        session_row, session_admin = svc.load_session(
            db,
            platform_session_token(request),
            stages=(svc.STAGE_PASSWORD_OK, svc.STAGE_MFA_VERIFIED),
            request=request,
        )
    except UnauthorizedError:
        session_row = None
    if session_row is not None:
        svc.revoke_session(db, session_row)
        record_platform_event(
            db,
            "logout",
            actor_admin_id=session_admin.id,
            actor_email=session_admin.email,
        )
        db.commit()
    _clear_cookie(response)
    return envelope({"signed_out": True})
