from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.role import RoleCreateRequest, RoleUpdateRequest
from app.services import role_service

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("")
def list_roles(
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope([r.model_dump(mode="json") for r in role_service.list_roles(db, ctx.tenant_id)])


@router.get("/permissions")
def list_permissions(
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope([p.model_dump() for p in role_service.list_permissions(db)])


@router.post("")
def create_role(
    req: RoleCreateRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    role = role_service.create_role(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(role.model_dump(mode="json"))


@router.patch("/{role_id}")
def update_role(
    role_id: UUID,
    req: RoleUpdateRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    role = role_service.update_role(db, ctx.tenant_id, ctx.user_id, role_id, req)
    return envelope(role.model_dump(mode="json"))


@router.delete("/{role_id}")
def deactivate_role(
    role_id: UUID,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    role = role_service.deactivate_role(db, ctx.tenant_id, ctx.user_id, role_id)
    return envelope(role.model_dump(mode="json"))
