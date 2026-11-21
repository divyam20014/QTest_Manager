"""ADR-099: custom dashboards (private per user + one tenant team default).

Widgets never get their own data queries: the frontend reads each widget's
data from the existing report/dashboard endpoints. This module only stores the
layout, validates settings, and flags widgets whose project the viewer can no
longer see (revalidated on every read)."""

from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.auth import SessionContext
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.project import Project
from app.schemas.dashboards import (
    MAX_DASHBOARDS_PER_USER,
    SETTINGS_MODELS,
    DashboardCreate,
    DashboardUpdate,
    WidgetIn,
    settings_size_ok,
)
from app.services import report_builder_service
from app.services.reporting_service import _accessible_project_ids

MANAGE = "tenant.settings.manage"


def _audit(db: Session, ctx: SessionContext, action: str, d: Dashboard, **extra: Any) -> None:
    record_audit_event(
        db,
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        action=action,
        entity_type="dashboard",
        entity_id=d.id,
        metadata={"name": d.name, **extra},
    )


def _visible_project_ids(db: Session, ctx: SessionContext, ids: set[UUID]) -> set[UUID]:
    """Subset of `ids` that exist in this tenant and the user may see."""
    if not ids:
        return set()
    found = set(
        db.execute(
            select(Project.id).where(Project.tenant_id == ctx.tenant_id, Project.id.in_(ids))
        ).scalars()
    )
    accessible = _accessible_project_ids(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    return found if accessible is None else found & accessible


def _get_readable(db: Session, ctx: SessionContext, dashboard_id: UUID) -> Dashboard:
    set_tenant_context(db, str(ctx.tenant_id))
    d = db.execute(
        select(Dashboard).where(Dashboard.tenant_id == ctx.tenant_id, Dashboard.id == dashboard_id)
    ).scalar_one_or_none()
    if d is None or not (d.is_team_default or d.owner_user_id == ctx.user_id):
        raise NotFoundError("Dashboard not found")
    return d


def _get_editable(db: Session, ctx: SessionContext, dashboard_id: UUID) -> Dashboard:
    d = _get_readable(db, ctx, dashboard_id)
    if d.is_team_default and MANAGE not in ctx.permissions:
        raise ForbiddenError("Only an Admin can change the team default dashboard")
    return d


def _widgets(db: Session, dashboard_id: UUID) -> list[DashboardWidget]:
    return list(
        db.execute(
            select(DashboardWidget)
            .where(DashboardWidget.dashboard_id == dashboard_id)
            .order_by(DashboardWidget.position)
        ).scalars()
    )


def _out(
    db: Session, ctx: SessionContext, d: Dashboard, *, with_widgets: bool = True
) -> dict[str, Any]:
    set_tenant_context(db, str(ctx.tenant_id))  # a commit() just ended the last one
    widgets = _widgets(db, d.id)
    owner = d.owner_user_id == ctx.user_id
    out: dict[str, Any] = {
        "id": str(d.id),
        "name": d.name,
        "is_team_default": d.is_team_default,
        "is_owner": owner,
        "can_edit": owner or (d.is_team_default and MANAGE in ctx.permissions),
        "widget_count": len(widgets),
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }
    if with_widgets:
        wanted = {
            UUID(str(w.settings["project_id"])) for w in widgets if w.settings.get("project_id")
        }
        visible = _visible_project_ids(db, ctx, wanted)
        out["widgets"] = [
            {
                "id": str(w.id),
                "widget_type": w.widget_type,
                "size": w.size,
                "position": w.position,
                "settings": w.settings,
                "project_access": (
                    "denied"
                    if w.settings.get("project_id")
                    and UUID(str(w.settings["project_id"])) not in visible
                    else "ok"
                ),
            }
            for w in widgets
        ]
    return out


def list_dashboards(db: Session, ctx: SessionContext) -> list[dict[str, Any]]:
    set_tenant_context(db, str(ctx.tenant_id))
    rows = db.execute(
        select(Dashboard)
        .where(
            Dashboard.tenant_id == ctx.tenant_id,
            (Dashboard.owner_user_id == ctx.user_id) | Dashboard.is_team_default,
        )
        .order_by(Dashboard.is_team_default.desc(), Dashboard.name, Dashboard.id)
    ).scalars()
    return [_out(db, ctx, d, with_widgets=False) for d in rows]


def get_dashboard(db: Session, ctx: SessionContext, dashboard_id: UUID) -> dict[str, Any]:
    return _out(db, ctx, _get_readable(db, ctx, dashboard_id))


def create_dashboard(db: Session, ctx: SessionContext, req: DashboardCreate) -> dict[str, Any]:
    set_tenant_context(db, str(ctx.tenant_id))
    count = db.execute(
        select(func.count()).select_from(Dashboard).where(Dashboard.owner_user_id == ctx.user_id)
    ).scalar_one()
    if count >= MAX_DASHBOARDS_PER_USER:
        raise ConflictError(f"You can have at most {MAX_DASHBOARDS_PER_USER} dashboards")
    d = Dashboard(tenant_id=ctx.tenant_id, owner_user_id=ctx.user_id, name=req.name)
    db.add(d)
    db.flush()
    _audit(db, ctx, "dashboard.created", d)
    db.commit()
    return _out(db, ctx, d)


def rename_dashboard(
    db: Session, ctx: SessionContext, dashboard_id: UUID, req: DashboardUpdate
) -> dict[str, Any]:
    d = _get_editable(db, ctx, dashboard_id)
    d.name = req.name
    db.commit()
    return _out(db, ctx, d)


def delete_dashboard(db: Session, ctx: SessionContext, dashboard_id: UUID) -> None:
    d = _get_editable(db, ctx, dashboard_id)
    _audit(db, ctx, "dashboard.deleted", d)
    db.delete(d)
    db.commit()


def _validate_widget(w: WidgetIn, index: int) -> dict[str, Any]:
    if not settings_size_ok(w.settings):
        raise ValidationAppError(f"Widget {index + 1}: settings are too large")
    try:
        parsed = SETTINGS_MODELS[w.widget_type].model_validate(w.settings)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(p) for p in first["loc"]) or "settings"
        raise ValidationAppError(
            f"Widget {index + 1} ({w.widget_type}): {field}: {first['msg']}"
        ) from None
    return parsed.model_dump(mode="json", exclude_none=True)


def replace_widgets(
    db: Session, ctx: SessionContext, dashboard_id: UUID, widgets: list[WidgetIn]
) -> dict[str, Any]:
    d = _get_editable(db, ctx, dashboard_id)
    cleaned = [_validate_widget(w, i) for i, w in enumerate(widgets)]
    project_ids = {UUID(c["project_id"]) for c in cleaned if "project_id" in c}
    if project_ids - _visible_project_ids(db, ctx, project_ids):
        raise ValidationAppError("A widget refers to a project you cannot access")
    for i, (w, c) in enumerate(zip(widgets, cleaned, strict=True)):
        if w.widget_type == "saved_report":
            try:
                report_builder_service.get_visible(
                    db, ctx.tenant_id, ctx.user_id, ctx.role_code, UUID(c["report_id"])
                )
            except NotFoundError:
                raise ValidationAppError(
                    f"Widget {i + 1} (saved_report): report_id: saved report not found"
                ) from None
    # Atomic replace: one transaction; any failure above leaves the old list.
    db.execute(delete(DashboardWidget).where(DashboardWidget.dashboard_id == d.id))
    for i, (w, c) in enumerate(zip(widgets, cleaned, strict=True)):
        db.add(
            DashboardWidget(
                tenant_id=ctx.tenant_id,
                dashboard_id=d.id,
                widget_type=w.widget_type,
                size=w.size,
                position=i,
                settings=c,
            )
        )
    d.updated_at = func.now()  # type: ignore[assignment]
    db.commit()
    return _out(db, ctx, d)


def set_team_default(
    db: Session, ctx: SessionContext, dashboard_id: UUID, enabled: bool
) -> dict[str, Any] | None:
    """Admin only. enabled=True publishes a copy of one of the Admin's own
    dashboards as the (single) team default, replacing any previous one;
    enabled=False on the team default removes it."""
    if MANAGE not in ctx.permissions:
        raise ForbiddenError(f"Missing permission: {MANAGE}")
    d = _get_readable(db, ctx, dashboard_id)
    if not enabled:
        if not d.is_team_default:
            raise ConflictError("This dashboard is not the team default")
        _audit(db, ctx, "dashboard.team_default_set", d, enabled=False)
        db.delete(d)
        db.commit()
        return None
    if d.is_team_default:
        return _out(db, ctx, d)
    source_widgets = _widgets(db, d.id)
    old = db.execute(
        select(Dashboard).where(
            Dashboard.tenant_id == ctx.tenant_id, Dashboard.is_team_default.is_(True)
        )
    ).scalar_one_or_none()
    if old is not None:
        db.delete(old)
        db.flush()
    new = Dashboard(tenant_id=ctx.tenant_id, owner_user_id=None, name=d.name, is_team_default=True)
    db.add(new)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("Another team default was set at the same time; try again") from None
    for w in source_widgets:
        db.add(
            DashboardWidget(
                tenant_id=ctx.tenant_id,
                dashboard_id=new.id,
                widget_type=w.widget_type,
                size=w.size,
                position=w.position,
                settings=dict(w.settings),
            )
        )
    _audit(db, ctx, "dashboard.team_default_set", new, enabled=True)
    db.commit()
    return _out(db, ctx, new)
