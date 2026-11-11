from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.service_token import ServiceTokenCreateRequest, ServiceTokenOut
from app.services import service_token_service

# Tenant-admin token management (ADR-059) -- session-cookie authenticated,
# same admin-only bar as sso.manage/scim-tokens, mirroring
# app/api/scim.py's admin_router exactly.
router = APIRouter(prefix="/service-tokens", tags=["service-tokens"])


@router.post("")
def create_service_token(
    req: ServiceTokenCreateRequest,
    ctx: SessionContext = Depends(require_permission("integration.manage")),
    db: Session = Depends(get_db),
) -> dict:
    token, raw = service_token_service.create_token(
        db, ctx.tenant_id, ctx.user_id, req.name, req.scope
    )
    return envelope(
        {
            "token": ServiceTokenOut.model_validate(token).model_dump(),
            "raw_value": raw,
        }
    )


@router.get("")
def list_service_tokens(
    ctx: SessionContext = Depends(require_permission("integration.manage")),
    db: Session = Depends(get_db),
) -> dict:
    tokens = service_token_service.list_tokens(db, ctx.tenant_id)
    return envelope([ServiceTokenOut.model_validate(t).model_dump() for t in tokens])


@router.delete("/{token_id}")
def revoke_service_token(
    token_id: UUID,
    ctx: SessionContext = Depends(require_permission("integration.manage")),
    db: Session = Depends(get_db),
) -> dict:
    service_token_service.revoke_token(db, ctx.tenant_id, ctx.user_id, token_id)
    return envelope({"revoked": True})
