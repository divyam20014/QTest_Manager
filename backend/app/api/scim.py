from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.errors import UnauthorizedError
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.schemas.scim import (
    ScimPatchRequest,
    ScimUserCreateRequest,
    ScimUserReplaceRequest,
)
from app.services import scim_service

# The public, spec-shaped SCIM 2.0 API (bearer-token authenticated, not
# session-cookie authenticated -- an IdP calls this directly).
router = APIRouter(prefix="/scim/v2/{tenant_id}", tags=["scim"])

# Tenant-admin token management -- session-cookie authenticated, same
# sso.manage permission bar as SSO configuration (SCIM is normally paired
# with SSO, and both represent the same "who else can provision identity
# into this tenant" trust decision).
admin_router = APIRouter(prefix="/scim-tokens", tags=["scim"])


def require_scim_token(tenant_id: UUID, request: Request, db: Session = Depends(get_db)) -> None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise UnauthorizedError("A SCIM bearer token is required")
    raw_token = auth_header[len("bearer ") :].strip()
    if not scim_service.authenticate(db, tenant_id, raw_token):
        raise UnauthorizedError("Invalid SCIM bearer token")


@router.get("/Users")
@limiter.limit("60/minute")
def scim_list_users(
    tenant_id: UUID,
    request: Request,
    startIndex: int = 1,
    count: int = 50,
    db: Session = Depends(get_db),
    _: None = Depends(require_scim_token),
) -> dict:
    return scim_service.list_users(db, tenant_id, max(startIndex, 1), max(count, 1)).model_dump()


@router.get("/Users/{user_id}")
@limiter.limit("60/minute")
def scim_get_user(
    tenant_id: UUID,
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_scim_token),
) -> dict:
    return scim_service.get_user(db, tenant_id, user_id).model_dump()


@router.post("/Users", status_code=201)
@limiter.limit("60/minute")
def scim_create_user(
    tenant_id: UUID,
    req: ScimUserCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_scim_token),
) -> dict:
    return scim_service.create_user(db, tenant_id, req).model_dump()


@router.put("/Users/{user_id}")
@limiter.limit("60/minute")
def scim_replace_user(
    tenant_id: UUID,
    user_id: UUID,
    req: ScimUserReplaceRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_scim_token),
) -> dict:
    return scim_service.replace_user(db, tenant_id, user_id, req).model_dump()


@router.patch("/Users/{user_id}")
@limiter.limit("60/minute")
def scim_patch_user(
    tenant_id: UUID,
    user_id: UUID,
    req: ScimPatchRequest,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_scim_token),
) -> dict:
    return scim_service.patch_user(db, tenant_id, user_id, req).model_dump()


@router.delete("/Users/{user_id}", status_code=204)
@limiter.limit("60/minute")
def scim_delete_user(
    tenant_id: UUID,
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(require_scim_token),
) -> Response:
    scim_service.deactivate_user(db, tenant_id, user_id)
    return Response(status_code=204)


@admin_router.post("")
def create_scim_token(
    ctx: SessionContext = Depends(require_permission("sso.manage")),
    db: Session = Depends(get_db),
) -> dict:
    token, raw = scim_service.create_token(db, ctx.tenant_id, ctx.user_id)
    return envelope({"id": str(token.id), "token": raw})


@admin_router.get("")
def list_scim_tokens(
    ctx: SessionContext = Depends(require_permission("sso.manage")),
    db: Session = Depends(get_db),
) -> dict:
    tokens = scim_service.list_tokens(db, ctx.tenant_id)
    return envelope(
        [
            {
                "id": str(t.id),
                "created_at": t.created_at.isoformat(),
                "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
                "revoked_at": t.revoked_at.isoformat() if t.revoked_at else None,
            }
            for t in tokens
        ]
    )


@admin_router.delete("/{token_id}")
def revoke_scim_token(
    token_id: UUID,
    ctx: SessionContext = Depends(require_permission("sso.manage")),
    db: Session = Depends(get_db),
) -> dict:
    scim_service.revoke_token(db, ctx.tenant_id, ctx.user_id, token_id)
    return envelope({"revoked": True})
