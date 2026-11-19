"""ADR-074: Platform Admin sign-in (password -> TOTP -> session)."""

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import UnauthorizedError, ValidationAppError
from app.core.platform_auth import enforce_same_origin, platform_session_token
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.models.identity import PlatformAdmin, PlatformSession
from app.schemas.platform_auth import (
    PlatformEnrolFinishOut,
    PlatformEnrolStartOut,
    PlatformEnrolVerifyRequest,
    PlatformLoginRequest,
    PlatformMfaVerifyRequest,
    PlatformSessionOut,
)
from app.services import platform_auth_service as svc

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
    return svc.load_session(db, platform_session_token(request), stages=(svc.STAGE_PASSWORD_OK,))


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
@limiter.limit("10/minute")
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
        ).model_dump()
    )


@router.post("/mfa/enroll/start")
@limiter.limit("10/minute")
def enrol_start(
    request: Request,
    db: Session = Depends(get_db),
    session: tuple[PlatformSession, PlatformAdmin] = Depends(pre_mfa_session),
) -> dict:
    _, admin = session
    secret, uri = svc.start_enrolment(db, admin)
    return envelope(
        PlatformEnrolStartOut(
            secret=secret,
            otpauth_uri=uri,
            issuer=settings.platform_mfa_issuer,
            account=admin.email,
        ).model_dump()
    )


@router.post("/mfa/enroll/verify")
@limiter.limit("10/minute")
def enrol_verify(
    req: PlatformEnrolVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    session: tuple[PlatformSession, PlatformAdmin] = Depends(pre_mfa_session),
) -> dict:
    session_row, admin = session
    raw, codes = svc.finish_enrolment(db, session_row, req.code, request)
    _set_cookie(response, raw, svc.STAGE_MFA_VERIFIED)
    return envelope(
        PlatformEnrolFinishOut(
            email=admin.email, stage=svc.STAGE_MFA_VERIFIED, recovery_codes=codes
        ).model_dump()
    )


@router.post("/mfa/verify")
@limiter.limit("10/minute")
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


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    enforce_same_origin(request)
    try:
        session_row, _ = svc.load_session(
            db,
            platform_session_token(request),
            stages=(svc.STAGE_PASSWORD_OK, svc.STAGE_MFA_VERIFIED),
        )
    except UnauthorizedError:
        session_row = None
    if session_row is not None:
        svc.revoke_session(db, session_row)
        db.commit()
    _clear_cookie(response)
    return envelope({"signed_out": True})
