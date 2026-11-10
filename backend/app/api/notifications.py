from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context
from app.core.db import get_db
from app.core.responses import envelope
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    unread_only: bool = Query(default=False),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    items = notification_service.list_notifications(
        db, ctx.tenant_id, ctx.user_id, unread_only
    )
    return envelope([i.model_dump(mode="json") for i in items])


@router.get("/unread-count")
def unread_count(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    count = notification_service.get_unread_count(db, ctx.tenant_id, ctx.user_id)
    return envelope({"count": count})


@router.patch("/{notification_id}/read")
def mark_read(
    notification_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    notification = notification_service.mark_read(
        db, ctx.tenant_id, ctx.user_id, notification_id
    )
    return envelope(notification.model_dump(mode="json"))


@router.post("/mark-all-read")
def mark_all_read(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    count = notification_service.mark_all_read(db, ctx.tenant_id, ctx.user_id)
    return envelope({"marked_count": count})
