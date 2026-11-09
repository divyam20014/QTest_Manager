from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_any_permission, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.user import UserCreateRequest, UserUpdateRequest
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(
    ctx: SessionContext = Depends(require_any_permission("user.manage", "project.members.manage")),
    db: Session = Depends(get_db),
) -> dict:
    users = user_service.list_users(db, ctx.tenant_id)
    return envelope([user_service.to_out(db, u).model_dump() for u in users])


@router.post("")
def create_user(
    req: UserCreateRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = user_service.create_user(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(user_service.to_out(db, user).model_dump())


@router.patch("/{user_id}")
def update_user(
    user_id: UUID,
    req: UserUpdateRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = user_service.update_user(db, ctx.tenant_id, ctx.user_id, user_id, req)
    return envelope(user_service.to_out(db, user).model_dump())


@router.delete("/{user_id}")
def deactivate_user(
    user_id: UUID,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = user_service.deactivate_user(db, ctx.tenant_id, ctx.user_id, user_id)
    return envelope(user_service.to_out(db, user).model_dump())


@router.post("/{user_id}/gdpr-erase")
def gdpr_erase(
    user_id: UUID,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = user_service.gdpr_erase(db, ctx.tenant_id, ctx.user_id, user_id)
    return envelope(user_service.to_out(db, user).model_dump())
