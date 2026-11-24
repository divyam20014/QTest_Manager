"""ADR-123: project dashboard layouts (the configurable project Overview).

Reuses the ADR-099 `dashboards` / `dashboard_widgets` tables with `dashboards.project_id`:

* a user's own layout of one project (owner = the user, one per project);
* the project's default layout (owner NULL, one per project), editable by whoever may edit the
  project (`project.edit` plus the ADR-018 assignment rule, exactly like `PATCH /projects/{id}`).

Resolution for a viewer: own layout, else the project default, else the built-in order. Only
the layout is stored here; every widget reads its numbers from the report endpoints with the
viewer's own session and this project's id, so visibility, Tester scoping and "Reports hidden"
apply unchanged. Org dashboards (`project_id` NULL) never appear here and vice versa.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.auth import SessionContext, get_effective_permissions_for_project
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.project import Project
from app.schemas.dashboards import (
    PROJECT_DASHBOARD_NAME,
    PROJECT_WIDGET_CATALOGUE,
    ProjectWidgetIn,
)
from app.services.project_service import is_assigned
from app.services.reporting_service import _accessible_project_ids


def _visible_project(db: Session, ctx: SessionContext, project_id: UUID) -> Project:
    """404 (never 403) for a project that does not exist here or is outside the viewer's scope."""
    set_tenant_context(db, str(ctx.tenant_id))
    project = db.execute(
        select(Project).where(Project.tenant_id == ctx.tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    accessible = _accessible_project_ids(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    if project is None or (accessible is not None and project_id not in accessible):
        raise NotFoundError("Project not found")
    return project


def can_set_default(db: Session, ctx: SessionContext, project: Project) -> bool:
    if "project.edit" not in get_effective_permissions_for_project(db, ctx, project.id):
        return False
    if ctx.role_code == "admin":
        return True
    return ctx.role_code == "manager" and is_assigned(db, project, ctx.user_id)


def _layout_row(db: Session, ctx: SessionContext, project_id: UUID, owner: UUID | None):
    query = select(Dashboard).where(
        Dashboard.tenant_id == ctx.tenant_id, Dashboard.project_id == project_id
    )
    query = query.where(
        Dashboard.owner_user_id.is_(None) if owner is None else Dashboard.owner_user_id == owner
    )
    return db.execute(query).scalar_one_or_none()


def _widgets_of(db: Session, dashboard_id: UUID) -> list[dict[str, str]]:
    rows = db.execute(
        select(DashboardWidget.widget_type, DashboardWidget.size)
        .where(DashboardWidget.dashboard_id == dashboard_id)
        .order_by(DashboardWidget.position)
    ).all()
    known = {key for key, _ in PROJECT_WIDGET_CATALOGUE}
    # A widget type a later release removed is ignored when read.
    return [{"widget_type": t, "size": s} for t, s in rows if t in known]


def _builtin() -> list[dict[str, str]]:
    return [{"widget_type": k, "size": s} for k, s in PROJECT_WIDGET_CATALOGUE]


def get_layout(db: Session, ctx: SessionContext, project_id: UUID) -> dict[str, Any]:
    project = _visible_project(db, ctx, project_id)
    own = _layout_row(db, ctx, project_id, ctx.user_id)
    default = _layout_row(db, ctx, project_id, None)
    default_widgets = _widgets_of(db, default.id) if default is not None else _builtin()
    if own is not None:
        source, widgets = "user", _widgets_of(db, own.id)
    elif default is not None:
        source, widgets = "project_default", default_widgets
    else:
        source, widgets = "builtin", default_widgets
    return {
        "project_id": str(project_id),
        "layout_source": source,
        "widgets": widgets,
        "default_widgets": default_widgets,
        "has_project_default": default is not None,
        "can_set_default": can_set_default(db, ctx, project),
        "catalogue": [{"widget_type": k, "default_size": s} for k, s in PROJECT_WIDGET_CATALOGUE],
    }


def _validate(widgets: list[ProjectWidgetIn]) -> None:
    seen: set[str] = set()
    for w in widgets:
        if w.widget_type in seen:
            raise ValidationAppError(f"Widget {w.widget_type} appears more than once")
        seen.add(w.widget_type)


def _replace(
    db: Session,
    ctx: SessionContext,
    project_id: UUID,
    owner: UUID | None,
    widgets: list[ProjectWidgetIn],
) -> Dashboard:
    row = _layout_row(db, ctx, project_id, owner)
    if row is None:
        row = Dashboard(
            tenant_id=ctx.tenant_id,
            owner_user_id=owner,
            project_id=project_id,
            name=PROJECT_DASHBOARD_NAME,
        )
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise ConflictError("The layout was saved at the same time; try again") from None
    db.execute(delete(DashboardWidget).where(DashboardWidget.dashboard_id == row.id))
    for i, w in enumerate(widgets):
        db.add(
            DashboardWidget(
                tenant_id=ctx.tenant_id,
                dashboard_id=row.id,
                widget_type=w.widget_type,
                size=w.size,
                position=i,
                settings={},
            )
        )
    row.updated_at = func.now()  # type: ignore[assignment]
    return row


def save_own_layout(
    db: Session, ctx: SessionContext, project_id: UUID, widgets: list[ProjectWidgetIn]
) -> dict[str, Any]:
    _visible_project(db, ctx, project_id)
    _validate(widgets)
    _replace(db, ctx, project_id, ctx.user_id, widgets)
    db.commit()
    return get_layout(db, ctx, project_id)


def reset_own_layout(db: Session, ctx: SessionContext, project_id: UUID) -> dict[str, Any]:
    _visible_project(db, ctx, project_id)
    row = _layout_row(db, ctx, project_id, ctx.user_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return get_layout(db, ctx, project_id)


def _require_default_editor(db: Session, ctx: SessionContext, project_id: UUID) -> Project:
    project = _visible_project(db, ctx, project_id)
    if not can_set_default(db, ctx, project):
        raise ForbiddenError("You cannot change this project's default dashboard")
    return project


def save_default_layout(
    db: Session, ctx: SessionContext, project_id: UUID, widgets: list[ProjectWidgetIn]
) -> dict[str, Any]:
    _require_default_editor(db, ctx, project_id)
    _validate(widgets)
    row = _replace(db, ctx, project_id, None, widgets)
    record_audit_event(
        db,
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        action="dashboard.project_default_set",
        entity_type="dashboard",
        entity_id=row.id,
        metadata={"project_id": str(project_id), "widgets": [w.widget_type for w in widgets]},
    )
    db.commit()
    return get_layout(db, ctx, project_id)


def clear_default_layout(db: Session, ctx: SessionContext, project_id: UUID) -> dict[str, Any]:
    _require_default_editor(db, ctx, project_id)
    row = _layout_row(db, ctx, project_id, None)
    if row is not None:
        record_audit_event(
            db,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            action="dashboard.project_default_cleared",
            entity_type="dashboard",
            entity_id=row.id,
            metadata={"project_id": str(project_id)},
        )
        db.delete(row)
        db.commit()
    return get_layout(db, ctx, project_id)
