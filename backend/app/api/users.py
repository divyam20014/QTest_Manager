from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    require_any_permission,
    require_permission,
)
from app.core.db import get_db
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.schemas.user import (
    InviteAcceptRequest,
    PasswordResetRequest,
    UserCreateRequest,
    UserEraseRequest,
    UserInviteRequest,
    UserUpdateRequest,
)
from app.services import audit_service, user_erasure_service, user_invite_service, user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(
    ctx: SessionContext = Depends(require_any_permission("user.manage", "project.members.manage")),
    db: Session = Depends(get_db),
) -> dict:
    users = user_service.list_users(db, ctx.tenant_id)
    return envelope([user_service.to_out(db, u).model_dump() for u in users])


@router.get("/me/history")
def own_history(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """Self-service account history: no permission beyond being signed in,
    since this is always scoped to the caller's own user entity."""
    logs = audit_service.get_own_history(db, ctx.tenant_id, ctx.user_id)
    return envelope([log.model_dump(mode="json") for log in logs])


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


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: UUID,
    req: PasswordResetRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = user_service.reset_password(db, ctx.tenant_id, ctx.user_id, user_id, req.new_password)
    return envelope(user_service.to_out(db, user).model_dump())


# ADR-086 (GAP-03): replaces the earlier bare `/gdpr-erase` endpoint. Dry run by
# default; a real run needs the user's email typed back and user.erase (Admin only).
@router.post("/{user_id}/erase")
@limiter.limit(scaled(10))
def erase_user(
    user_id: UUID,
    req: UserEraseRequest,
    request: Request,
    ctx: SessionContext = Depends(require_permission("user.erase")),
    db: Session = Depends(get_db),
) -> dict:
    result = user_erasure_service.erase_user(db, ctx.tenant_id, ctx.user_id, user_id, req)
    return envelope(result.model_dump(mode="json"))


# Tier 1 / ADR-053 (SR-2.4/5.11, SAAS-GAP-8): replaces admin-sets-the-
# password-directly provisioning with an invite the user accepts themself.
@router.post("/invite")
def invite_user(
    req: UserInviteRequest,
    ctx: SessionContext = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> dict:
    invite = user_invite_service.create_invite(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(invite.model_dump(mode="json"))


@router.post("/invite/{token}/accept")
@limiter.limit("10/minute")
def accept_invite(
    request: Request,
    token: str,
    req: InviteAcceptRequest,
    db: Session = Depends(get_db),
) -> dict:
    user = user_invite_service.accept_invite(db, token, req.password)
    return envelope(user_service.to_out(db, user).model_dump())
