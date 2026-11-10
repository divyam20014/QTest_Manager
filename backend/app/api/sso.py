import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission, set_session_cookie
from app.core.db import get_db
from app.core.errors import UnauthorizedError
from app.core.responses import envelope
from app.schemas.sso import SsoConfigUpsertRequest, SsoStatusOut
from app.services import sso_service

# Public login/callback -- unauthenticated by definition, this IS the
# authentication mechanism.
router = APIRouter(prefix="/auth/sso", tags=["sso"])

# Tenant-admin SSO configuration -- authenticated, gated by sso.manage.
admin_router = APIRouter(prefix="/sso", tags=["sso"])

_STATE_COOKIE = "qth_sso_state"
_STATE_COOKIE_MAX_AGE = 600


@router.get("/{tenant_id}/status")
def sso_status(tenant_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Public: lets the login page know whether to show a 'Sign in with
    SSO' option for this tenant, without exposing issuer/client details."""
    return envelope(SsoStatusOut(enabled=sso_service.is_enabled(db, tenant_id)).model_dump())


@router.get("/{tenant_id}/login")
def sso_login(tenant_id: UUID, request: Request, db: Session = Depends(get_db)) -> RedirectResponse:
    cfg = sso_service.get_config(db, tenant_id)
    if cfg is None or not cfg.enabled:
        raise UnauthorizedError("SSO is not configured for this organization")

    redirect_uri = str(request.url_for("sso_callback", tenant_id=tenant_id))
    state = secrets.token_urlsafe(24)
    auth_url = sso_service.build_authorization_url(cfg, redirect_uri, state)

    redirect = RedirectResponse(auth_url)
    redirect.set_cookie(
        _STATE_COOKIE, state, httponly=True, samesite="lax", max_age=_STATE_COOKIE_MAX_AGE
    )
    return redirect


@router.get("/{tenant_id}/callback", name="sso_callback")
def sso_callback(
    tenant_id: UUID,
    code: str,
    state: str,
    request: Request,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    cookie_state = request.cookies.get(_STATE_COOKIE)
    if not cookie_state or cookie_state != state:
        raise UnauthorizedError("Invalid or expired SSO login attempt")

    redirect_uri = str(request.url_for("sso_callback", tenant_id=tenant_id))
    session_row = sso_service.exchange_code_and_provision(db, tenant_id, code, redirect_uri)

    redirect = RedirectResponse("/")
    set_session_cookie(redirect, session_row.id)
    redirect.delete_cookie(_STATE_COOKIE)
    return redirect


@admin_router.get("/config")
def get_sso_config(
    ctx: SessionContext = Depends(require_permission("sso.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(sso_service.get_config_out(db, ctx.tenant_id).model_dump())


@admin_router.put("/config")
def update_sso_config(
    req: SsoConfigUpsertRequest,
    ctx: SessionContext = Depends(require_permission("sso.manage")),
    db: Session = Depends(get_db),
) -> dict:
    updated = sso_service.upsert_config(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(updated.model_dump())
