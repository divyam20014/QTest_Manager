from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context
from app.core.db import get_db
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.models.saved_view import SavedView
from app.schemas.saved_view import (
    ListKey,
    SavedViewCreateRequest,
    SavedViewOut,
    SavedViewUpdateRequest,
)
from app.services import saved_view_service

# ADR-096: private per-user saved list views. Any signed-in user manages their
# own; there is deliberately no sharing and no permission code.
router = APIRouter(prefix="/saved-views", tags=["saved-views"])


def _out(view: SavedView) -> dict:
    return SavedViewOut(
        id=view.id,
        list_key=view.list_key,  # type: ignore[arg-type]
        name=view.name,
        filters=view.filters,
        sort=view.sort,
        is_default=view.is_default,
        created_at=view.created_at,
        updated_at=view.updated_at,
    ).model_dump(mode="json")


@router.get("")
@limiter.limit(scaled(120))
def list_saved_views(
    request: Request,
    list_key: ListKey | None = Query(default=None),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    views = saved_view_service.list_views(db, ctx.tenant_id, ctx.user_id, list_key)
    return envelope([_out(v) for v in views])


@router.post("")
@limiter.limit(scaled(60))
def create_saved_view(
    request: Request,
    req: SavedViewCreateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(_out(saved_view_service.create_view(db, ctx.tenant_id, ctx.user_id, req)))


@router.patch("/{view_id}")
@limiter.limit(scaled(60))
def update_saved_view(
    request: Request,
    view_id: UUID,
    req: SavedViewUpdateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    view = saved_view_service.update_view(db, ctx.tenant_id, ctx.user_id, view_id, req)
    return envelope(_out(view))


@router.delete("/{view_id}")
@limiter.limit(scaled(60))
def delete_saved_view(
    request: Request,
    view_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    saved_view_service.delete_view(db, ctx.tenant_id, ctx.user_id, view_id)
    return envelope({"id": str(view_id), "deleted": True})
