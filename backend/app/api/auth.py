from uuid import UUID

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
from app.core.db import get_db, get_identify_db
from app.core.logging import logger
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.models.identity import User
from app.schemas.auth import (
    IdentifyRequest,
    IdentifyResponse,
    LoginRequest,
    MeResponse,
    MfaVerifyRequest,
    SessionOut,
    TenantMatchOut,
)
from app.schemas.platform import TenantCreateRequest, TenantCreateResponse, TenantOut
from app.services import auth_service, identify_service, platform_service, sample_data_service

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


# ADR-067: tenant-less login, step 0. Previously the login form required a
# raw tenant_id UUID up front (ADR-017: email is only unique per-tenant, so
# the users table -- RLS-scoped -- can't be queried without it). This lets
# the user type only their email first; the frontend then either
# auto-continues (single match) or shows an org picker (multiple matches)
# before the existing, unchanged POST /auth/login. Tighter-than-login rate
# limit: this is unauthenticated and enumeration-adjacent, called on every
# login attempt rather than only on invalid ones.
#
# Not audit-logged: audit_logs.tenant_id is NOT NULL (TenantScopedMixin),
# and this endpoint runs by definition before any tenant is known -- there
# is no tenant row to attribute the event to. A security-relevant log line
# (below) covers the same need without forcing a schema change.
@router.post("/identify")
@limiter.limit("8/minute")
def identify(
    req: IdentifyRequest, request: Request, db: Session = Depends(get_identify_db)
) -> dict:
    matches = identify_service.resolve_tenants_for_email(db, req.email)
    if not matches:
        logger.info("security_event=identify_no_match email=%s", req.email)
    return envelope(
        IdentifyResponse(
            matches=[
                TenantMatchOut(tenant_id=tenant_id, tenant_name=tenant_name)
                for tenant_id, tenant_name in matches
            ]
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


# Phase 4: self-service session management -- a user's own active sessions
# only (never another user's; that would be a separate admin-facing
# feature), so no permission check beyond "is logged in" is needed.
@router.get("/sessions")
def list_sessions(
    ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> dict:
    sessions = auth_service.list_sessions(db, ctx.tenant_id, ctx.user_id)
    return envelope(
        {
            "sessions": [
                SessionOut(
                    id=s.id,
                    created_at=s.created_at,
                    expires_at=s.expires_at,
                    last_seen_at=s.last_seen_at,
                    is_current=s.id == ctx.session_id,
                ).model_dump()
                for s in sessions
            ]
        }
    )


@router.delete("/sessions/{session_id}")
def revoke_session(
    session_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    auth_service.revoke_session(db, ctx.tenant_id, ctx.user_id, session_id, ctx.session_id)
    return envelope({"revoked": True})
