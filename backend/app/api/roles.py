from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_any_permission, require_permission
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


@router.get("/assignable")
def list_assignable_roles(
    ctx: SessionContext = Depends(
        require_any_permission("user.manage", "project.members.manage")
    ),
    db: Session = Depends(get_db),
) -> dict:
    """RBAC Phase 1: same list as GET /roles, but gated by the lighter
    `project.members.manage` permission too, so a Manager (who legitimately
    manages project membership but lacks tenant-wide `user.manage`) can
    populate a project-role-override picker without being granted full
    user-management rights."""
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
