from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.models.identity import User
from app.schemas.reporting import GroupBy, Metric
from app.services import reporting_service

router = APIRouter(tags=["reporting"])


@router.get("/dashboard/summary")
def dashboard_summary(
    ctx: SessionContext = Depends(require_permission("report.view")), db: Session = Depends(get_db)
) -> dict:
    summary = reporting_service.get_dashboard_summary(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    return envelope(summary.model_dump(mode="json"))


@router.get("/dashboard/domain-distribution")
def domain_distribution(
    ctx: SessionContext = Depends(require_permission("report.view")), db: Session = Depends(get_db)
) -> dict:
    entries = reporting_service.get_domain_distribution(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id
    )
    return envelope([e.model_dump(mode="json") for e in entries])


@router.get("/dashboard/activity-stream")
def activity_stream(
    ctx: SessionContext = Depends(require_permission("report.view")), db: Session = Depends(get_db)
) -> dict:
    entries = reporting_service.get_activity_stream(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    return envelope([e.model_dump(mode="json") for e in entries])


@router.get("/reports/aggregate")
def aggregate_report(
    metric: Metric = Query(...),
    group_by: GroupBy = Query(...),
    project_id: UUID | None = Query(default=None),
    domain: str | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    priority: str | None = Query(default=None),
    status: str | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    report = reporting_service.get_aggregate_report(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        metric,
        group_by,
        project_id=project_id,
        domain=domain,
        assignee_id=assignee_id,
        date_from=date_from,
        date_to=date_to,
        priority=priority,
        status=status,
    )
    return envelope(report.model_dump(mode="json"))


@router.get("/reports/execution-trend")
def execution_trend(
    days: int = Query(default=30, ge=1, le=180),
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    report = reporting_service.get_execution_trend(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, days, project_id
    )
    return envelope(report.model_dump(mode="json"))


@router.get("/reports/defect-trend")
def defect_trend(
    days: int = Query(default=30, ge=1, le=180),
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    report = reporting_service.get_defect_trend(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, days, project_id
    )
    return envelope(report.model_dump(mode="json"))


@router.get("/reports/defect-aging")
def defect_aging(
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    summary = reporting_service.get_defect_aging_summary(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope(summary.model_dump(mode="json"))


@router.get("/reports/defect-reopen-summary")
def defect_reopen_summary(
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    summary = reporting_service.get_reopen_summary(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope(summary.model_dump(mode="json"))


@router.get("/reports/release-readiness")
def release_readiness(
    project_id: UUID = Query(),
    release_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    report = reporting_service.get_release_readiness(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, release_id
    )
    return envelope(report.model_dump(mode="json"))


@router.get("/reports/workload")
def workload_summary(
    project_id: UUID = Query(),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    summary = reporting_service.get_workload_summary(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope(summary.model_dump(mode="json"))


@router.get("/reports/flaky-tests")
def flaky_tests(
    project_id: UUID = Query(),
    limit: int = Query(default=10, ge=1, le=50),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    report = reporting_service.get_flaky_tests(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, limit
    )
    return envelope(report.model_dump(mode="json"))


@router.get("/reports/compliance-detail")
def compliance_detail(
    period_from: datetime | None = Query(default=None),
    period_to: datetime | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.compliance_export")),
    db: Session = Depends(get_db),
) -> dict:
    reporting_officer = db.execute(select(User).where(User.id == ctx.user_id)).scalar_one()
    report = reporting_service.get_compliance_report(
        db, ctx.tenant_id, reporting_officer, ctx.role_code, ctx.user_id, period_from, period_to
    )
    return envelope(report.model_dump(mode="json"))


@router.get("/reports/compliance-export")
def compliance_export(
    period_from: datetime | None = Query(default=None),
    period_to: datetime | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.compliance_export")),
    db: Session = Depends(get_db),
) -> PlainTextResponse:
    reporting_officer = db.execute(select(User).where(User.id == ctx.user_id)).scalar_one()
    report = reporting_service.get_compliance_report(
        db, ctx.tenant_id, reporting_officer, ctx.role_code, ctx.user_id, period_from, period_to
    )
    csv_text = reporting_service.compliance_report_to_csv(report)
    return PlainTextResponse(
        csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="compliance_summary.csv"'},
    )
