import re
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.reporting import require_reports_not_hidden
from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.core.xlsx_report import XLSX_MEDIA_TYPE
from app.schemas.report_builder import (
    MAX_PAGE_SIZE,
    PreviewIn,
    SavedReportCreate,
    SavedReportUpdate,
)
from app.services import report_builder_service as svc

# ADR-098: structured, allowlist-driven report builder. Same gate as /reports/*
# (report.view permission + Reports-hidden-from-Testers setting).
router = APIRouter(
    prefix="/report-builder",
    tags=["report-builder"],
    dependencies=[Depends(require_reports_not_hidden)],
)

_Ctx = Depends(require_permission("report.view"))


def _filename(name: str, ext: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")[:60] or "report"
    return f"{slug}.{ext}"


@router.get("/sources")
@limiter.limit(scaled(120))
def get_sources(request: Request, ctx: SessionContext = _Ctx) -> dict:
    return envelope(svc.sources_metadata())


@router.post("/preview")
@limiter.limit(scaled(30))
def preview(
    request: Request,
    req: PreviewIn,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    result = svc.run_definition(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        req.definition,
        page=req.page,
        page_size=req.page_size,
    )
    return envelope(result)


@router.get("/reports")
@limiter.limit(scaled(120))
def list_reports(
    request: Request, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    return envelope(svc.list_reports(db, ctx.tenant_id, ctx.user_id, ctx.role_code))


@router.post("/reports")
@limiter.limit(scaled(30))
def create_report(
    request: Request,
    req: SavedReportCreate,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    return envelope(svc.create_report(db, ctx.tenant_id, ctx.user_id, ctx.role_code, req))


@router.get("/reports/{report_id}")
@limiter.limit(scaled(120))
def get_report(
    request: Request, report_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    return envelope(svc.get_out(db, ctx.tenant_id, ctx.user_id, ctx.role_code, report_id))


@router.patch("/reports/{report_id}")
@limiter.limit(scaled(30))
def update_report(
    request: Request,
    report_id: UUID,
    req: SavedReportUpdate,
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    return envelope(
        svc.update_report(db, ctx.tenant_id, ctx.user_id, ctx.role_code, report_id, req)
    )


@router.delete("/reports/{report_id}")
@limiter.limit(scaled(30))
def delete_report(
    request: Request, report_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> dict:
    svc.delete_report(db, ctx.tenant_id, ctx.user_id, ctx.role_code, report_id)
    return envelope({"id": str(report_id), "deleted": True})


@router.post("/reports/{report_id}/run")
@limiter.limit(scaled(30))
def run_report(
    request: Request,
    report_id: UUID,
    page: int = Query(default=1, ge=1, le=100_000),
    page_size: int = Query(default=25, ge=1, le=MAX_PAGE_SIZE),
    ctx: SessionContext = _Ctx,
    db: Session = Depends(get_db),
) -> dict:
    return envelope(
        svc.run_saved(
            db,
            ctx.tenant_id,
            ctx.user_id,
            ctx.role_code,
            report_id,
            page=page,
            page_size=page_size,
        )
    )


@router.get("/reports/{report_id}/export.csv")
@limiter.limit(scaled(10))
def export_csv(
    request: Request, report_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> Response:
    name, body = svc.export_csv(db, ctx.tenant_id, ctx.user_id, ctx.role_code, report_id)
    return Response(
        body.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_filename(name, "csv")}"'},
    )


@router.get("/reports/{report_id}/export.xlsx")
@limiter.limit(scaled(10))
def export_xlsx(
    request: Request, report_id: UUID, ctx: SessionContext = _Ctx, db: Session = Depends(get_db)
) -> Response:
    name, body = svc.export_xlsx(db, ctx.tenant_id, ctx.user_id, ctx.role_code, report_id)
    return Response(
        body,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{_filename(name, "xlsx")}"'},
    )
