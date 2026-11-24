from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_project_permission
from app.core.db import get_db
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.schemas.dashboards import ProjectLayoutIn
from app.services import project_dashboard_service as svc

# ADR-123: the layout of one project's Overview. Any signed-in user who can see the project
# reads and keeps their own layout (a project outside their scope is a 404); the project default
# needs `project.edit` (project-role override aware) plus the ADR-018 assignment rule.
router = APIRouter(tags=["project-dashboards"])

_Ctx = Depends(get_current_context)


@router.get("/projects/{project_id}/dashboard")
@limiter.limit(scaled(120))
def get_project_dashboard(
    request: Request, project_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    return envelope(svc.get_layout(db, ctx, project_id))


@router.put("/projects/{project_id}/dashboard")
@limiter.limit(scaled(30))
def save_project_dashboard(
    request: Request,
    project_id: UUID,
    req: ProjectLayoutIn,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    return envelope(svc.save_own_layout(db, ctx, project_id, req.widgets))


@router.delete("/projects/{project_id}/dashboard")
@limiter.limit(scaled(30))
def reset_project_dashboard(
    request: Request, project_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    return envelope(svc.reset_own_layout(db, ctx, project_id))


@router.put("/projects/{project_id}/dashboard/default")
@limiter.limit(scaled(30))
def save_project_dashboard_default(
    request: Request,
    project_id: UUID,
    req: ProjectLayoutIn,
    ctx: SessionContext = Depends(require_project_permission("project.edit")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(svc.save_default_layout(db, ctx, project_id, req.widgets))


@router.delete("/projects/{project_id}/dashboard/default")
@limiter.limit(scaled(30))
def clear_project_dashboard_default(
    request: Request,
    project_id: UUID,
    ctx: SessionContext = Depends(require_project_permission("project.edit")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(svc.clear_default_layout(db, ctx, project_id))
