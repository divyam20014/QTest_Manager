from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    clear_session_cookie,
    get_current_context,
    parse_session_cookie,
    set_session_cookie,
)
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.models.identity import User
from app.schemas.auth import LoginRequest, MeResponse, MfaVerifyRequest
from app.schemas.platform import TenantCreateRequest, TenantCreateResponse, TenantOut
from app.services import auth_service, platform_service, sample_data_service

router = APIRouter(prefix="/auth", tags=["auth"])


# Pass 2 / ADR-064: self-service tenant signup (item 1 of the
# onboarding/billing pass). Previously, tenant creation was
# platform-admin-only (ADR-008) -- this adds a genuine self-service path
# alongside it, not a replacement. A new, unauthenticated, state-changing
# public endpoint is a real attack surface: rate-limited tighter than
# login (it creates real resources, not just a login attempt), and the
# resulting admin still goes through the ordinary login+MFA flow -- MFA
# is a fundamental security control here, not onboarding friction to
# bypass for a smoother signup funnel.
@router.post("/signup")
@limiter.limit("5/hour")
def signup(req: TenantCreateRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant, admin = platform_service.create_tenant_with_admin(db, req, platform_admin_id=None)
    sample_data_service.seed_sample_project(db, tenant.id, admin.id)
    db.commit()
    return envelope(
        TenantCreateResponse(
            tenant=TenantOut.model_validate(tenant), admin_user_id=admin.id
        ).model_dump(mode="json")
    )


@router.post("/login")
@limiter.limit("10/minute")
def login(
    req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    session_row, debug_code = auth_service.start_login(
        db, req.tenant_id, req.email, req.password, request
    )
    set_session_cookie(response, session_row.id)
    payload: dict = {"mfa_required": True}
    if debug_code is not None:
        payload["debug_code"] = debug_code
    return envelope(payload)


@router.post("/mfa/verify")
@limiter.limit("10/minute")
def verify_mfa(
    req: MfaVerifyRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    session_id = parse_session_cookie(request)
    session_row = auth_service.verify_mfa(db, session_id, req.code)
    set_session_cookie(response, session_row.id)
    return envelope({"verified": True})


@router.post("/logout")
def logout(
    response: Response,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    auth_service.logout(db, ctx.session_id)
    clear_session_cookie(response)
    return envelope({"logged_out": True})


@router.get("/me")
def me(ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)) -> dict:
    user = db.execute(select(User).where(User.id == ctx.user_id)).scalar_one()
    return envelope(
        MeResponse(
            user_id=ctx.user_id,
            tenant_id=ctx.tenant_id,
            email=user.email,
            name=user.name,
            role=ctx.display_role,
            permissions=sorted(ctx.permissions),
        ).model_dump()
    )
