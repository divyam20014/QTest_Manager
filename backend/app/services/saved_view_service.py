"""ADR-096: private per-user saved list views."""

from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import set_tenant_context
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.models.saved_view import SavedView
from app.schemas.saved_view import (
    MAX_VIEWS_PER_LIST,
    SavedViewCreateRequest,
    SavedViewUpdateRequest,
    validate_view,
)


def list_views(
    db: Session, tenant_id: UUID, user_id: UUID, list_key: str | None
) -> list[SavedView]:
    set_tenant_context(db, str(tenant_id))
    stmt = select(SavedView).where(SavedView.tenant_id == tenant_id, SavedView.user_id == user_id)
    if list_key is not None:
        stmt = stmt.where(SavedView.list_key == list_key)
    return list(db.execute(stmt.order_by(SavedView.name)).scalars())


def _get_own_or_404(db: Session, tenant_id: UUID, user_id: UUID, view_id: UUID) -> SavedView:
    set_tenant_context(db, str(tenant_id))
    view = db.execute(
        select(SavedView).where(
            SavedView.tenant_id == tenant_id,
            SavedView.user_id == user_id,
            SavedView.id == view_id,
        )
    ).scalar_one_or_none()
    if view is None:
        raise NotFoundError("Saved view not found")
    return view


def _clear_default(db: Session, user_id: UUID, list_key: str, except_id: UUID | None) -> None:
    stmt = update(SavedView).where(
        SavedView.user_id == user_id, SavedView.list_key == list_key, SavedView.is_default
    )
    if except_id is not None:
        stmt = stmt.where(SavedView.id != except_id)
    db.execute(stmt.values(is_default=False))


def create_view(
    db: Session, tenant_id: UUID, user_id: UUID, req: SavedViewCreateRequest
) -> SavedView:
    set_tenant_context(db, str(tenant_id))
    count = db.execute(
        select(func.count())
        .select_from(SavedView)
        .where(SavedView.user_id == user_id, SavedView.list_key == req.list_key)
    ).scalar_one()
    if count >= MAX_VIEWS_PER_LIST:
        raise ConflictError(f"You can save at most {MAX_VIEWS_PER_LIST} views per list")
    if req.is_default:
        _clear_default(db, user_id, req.list_key, None)
    view = SavedView(
        tenant_id=tenant_id,
        user_id=user_id,
        list_key=req.list_key,
        name=req.name,
        filters=req.filters,
        sort=req.sort,
        is_default=req.is_default,
    )
    db.add(view)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("You already have a view with this name") from None
    set_tenant_context(db, str(tenant_id))
    db.refresh(view)
    return view


def update_view(
    db: Session, tenant_id: UUID, user_id: UUID, view_id: UUID, req: SavedViewUpdateRequest
) -> SavedView:
    view = _get_own_or_404(db, tenant_id, user_id, view_id)
    fields = req.model_fields_set
    if "filters" in fields or "sort" in fields:
        new_filters = req.filters if req.filters is not None else view.filters
        new_sort = req.sort if "sort" in fields else view.sort
        try:
            validate_view(view.list_key, new_filters, new_sort)
        except ValueError as exc:
            raise ValidationAppError(str(exc)) from None
        view.filters = new_filters
        view.sort = new_sort
    if req.name is not None:
        view.name = req.name
    if req.is_default is not None:
        if req.is_default:
            _clear_default(db, user_id, view.list_key, view.id)
        view.is_default = req.is_default
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("You already have a view with this name") from None
    set_tenant_context(db, str(tenant_id))
    db.refresh(view)
    return view


def delete_view(db: Session, tenant_id: UUID, user_id: UUID, view_id: UUID) -> None:
    view = _get_own_or_404(db, tenant_id, user_id, view_id)
    db.delete(view)
    db.commit()
