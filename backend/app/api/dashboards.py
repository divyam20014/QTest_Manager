from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context
from app.core.db import get_db
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.schemas.dashboards import (
    DashboardCreate,
    DashboardUpdate,
    TeamDefaultIn,
    WidgetsReplaceIn,
)
from app.services import dashboard_service as svc

# ADR-099: any signed-in user. Visibility is enforced in the service (own
# dashboards + the tenant team default; anything else is a 404).
router = APIRouter(prefix="/dashboards", tags=["dashboards"])

_Ctx = Depends(get_current_context)


@router.get("")
@limiter.limit(scaled(120))
def list_dashboards(
    request: Request, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    return envelope(svc.list_dashboards(db, ctx))


@router.post("")
@limiter.limit(scaled(30))
def create_dashboard(
    request: Request,
    req: DashboardCreate,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    return envelope(svc.create_dashboard(db, ctx, req))


@router.get("/{dashboard_id}")
@limiter.limit(scaled(120))
def get_dashboard(
    request: Request, dashboard_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    return envelope(svc.get_dashboard(db, ctx, dashboard_id))


@router.patch("/{dashboard_id}")
@limiter.limit(scaled(30))
def rename_dashboard(
    request: Request,
    dashboard_id: UUID,
    req: DashboardUpdate,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    return envelope(svc.rename_dashboard(db, ctx, dashboard_id, req))


@router.delete("/{dashboard_id}")
@limiter.limit(scaled(30))
def delete_dashboard(
    request: Request, dashboard_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    svc.delete_dashboard(db, ctx, dashboard_id)
    return envelope({"id": str(dashboard_id), "deleted": True})


@router.put("/{dashboard_id}/widgets")
@limiter.limit(scaled(30))
def replace_widgets(
    request: Request,
    dashboard_id: UUID,
    req: WidgetsReplaceIn,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    return envelope(svc.replace_widgets(db, ctx, dashboard_id, req.widgets))


@router.post("/{dashboard_id}/team-default")
@limiter.limit(scaled(30))
def set_team_default(
    request: Request,
    dashboard_id: UUID,
    req: TeamDefaultIn,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    result = svc.set_team_default(db, ctx, dashboard_id, req.enabled)
    return envelope(result if result is not None else {"id": str(dashboard_id), "removed": True})
