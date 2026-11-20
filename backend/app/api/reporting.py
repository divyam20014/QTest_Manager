from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.pdf_report import render_compliance_report_pdf
from app.core.responses import envelope
from app.core.xlsx_report import XLSX_MEDIA_TYPE
from app.models.identity import User
from app.schemas.reporting import GroupBy, Metric, RunTypeFilter
from app.services import reporting_service, tester_visibility

router = APIRouter(tags=["reporting"])


def require_reports_not_hidden(
    ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> None:
    """ADR-093: 403 for a Tester when the tenant hides Reports from Testers. The
    /dashboard/* endpoints deliberately stay open (the Dashboard must render)."""
    tester_visibility.require_reports_visible(db, ctx.tenant_id, ctx.role_code)


@router.get("/dashboard/summary")
def dashboard_summary(
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    summary = reporting_service.get_dashboard_summary(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
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
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    entries = reporting_service.get_activity_stream(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope([e.model_dump(mode="json") for e in entries])


@router.get("/reports/aggregate", dependencies=[Depends(require_reports_not_hidden)])
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


@router.get("/reports/execution-trend", dependencies=[Depends(require_reports_not_hidden)])
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


@router.get("/reports/defect-trend", dependencies=[Depends(require_reports_not_hidden)])
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


@router.get("/reports/defect-aging", dependencies=[Depends(require_reports_not_hidden)])
def defect_aging(
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    summary = reporting_service.get_defect_aging_summary(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope(summary.model_dump(mode="json"))


@router.get("/reports/defect-reopen-summary", dependencies=[Depends(require_reports_not_hidden)])
def defect_reopen_summary(
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    summary = reporting_service.get_reopen_summary(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope(summary.model_dump(mode="json"))


@router.get("/reports/release-readiness", dependencies=[Depends(require_reports_not_hidden)])
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


@router.get("/reports/workload", dependencies=[Depends(require_reports_not_hidden)])
def workload_summary(
    project_id: UUID = Query(),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    summary = reporting_service.get_workload_summary(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope(summary.model_dump(mode="json"))


@router.get("/reports/flaky-tests", dependencies=[Depends(require_reports_not_hidden)])
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


@router.get("/reports/traceability-matrix", dependencies=[Depends(require_reports_not_hidden)])
def traceability_matrix(
    project_id: UUID = Query(),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    report = reporting_service.get_traceability_matrix(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope(report.model_dump(mode="json"))


@router.get(
    "/reports/traceability-matrix/export", dependencies=[Depends(require_reports_not_hidden)]
)
def traceability_matrix_export(
    project_id: UUID = Query(),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> PlainTextResponse:
    report = reporting_service.get_traceability_matrix(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    csv_text = reporting_service.traceability_matrix_to_csv(report)
    return PlainTextResponse(
        csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="traceability_matrix.csv"'},
    )


@router.get("/reports/compliance-detail", dependencies=[Depends(require_reports_not_hidden)])
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


@router.get("/reports/compliance-export", dependencies=[Depends(require_reports_not_hidden)])
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


@router.get("/reports/compliance-detail/pdf", dependencies=[Depends(require_reports_not_hidden)])
def compliance_detail_pdf(
    period_from: datetime | None = Query(default=None),
    period_to: datetime | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.compliance_export")),
    db: Session = Depends(get_db),
) -> Response:
    """Pass 4 (ADR-065): additive to the existing browser-print view, not a
    replacement -- a real downloadable file for scheduled/emailed delivery."""
    reporting_officer = db.execute(select(User).where(User.id == ctx.user_id)).scalar_one()
    report = reporting_service.get_compliance_report(
        db, ctx.tenant_id, reporting_officer, ctx.role_code, ctx.user_id, period_from, period_to
    )
    pdf_bytes = render_compliance_report_pdf(report)
    return Response(
        pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="compliance_report.pdf"'},
    )


def _xlsx_response(contents: bytes, filename: str) -> Response:
    return Response(
        contents,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/reports/quality-metrics", dependencies=[Depends(require_reports_not_hidden)])
def quality_metrics(
    days: int = Query(default=30, ge=1, le=365),
    project_id: UUID | None = Query(default=None),
    run_type: RunTypeFilter = Query(default="Regression"),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> dict:
    report = reporting_service.get_quality_metrics(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        days=days,
        project_id=project_id,
        run_type=run_type,
    )
    return envelope(report.model_dump(mode="json"))


@router.get(
    "/reports/quality-metrics/export.xlsx", dependencies=[Depends(require_reports_not_hidden)]
)
def quality_metrics_export_xlsx(
    days: int = Query(default=30, ge=1, le=365),
    project_id: UUID | None = Query(default=None),
    run_type: RunTypeFilter = Query(default="Regression"),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> Response:
    report = reporting_service.get_quality_metrics(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        days=days,
        project_id=project_id,
        run_type=run_type,
    )
    return _xlsx_response(reporting_service.quality_metrics_to_xlsx(report), "quality_metrics.xlsx")


@router.get("/reports/aggregate/export.xlsx", dependencies=[Depends(require_reports_not_hidden)])
def aggregate_export_xlsx(
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
) -> Response:
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
    filters = {
        "Project": str(project_id) if project_id else "",
        "Domain": domain or "",
        "Assignee": str(assignee_id) if assignee_id else "",
        "From": date_from.isoformat() if date_from else "",
        "To": date_to.isoformat() if date_to else "",
        "Test case priority": priority or "",
        "Test case status": status or "",
    }
    return _xlsx_response(
        reporting_service.aggregate_report_to_xlsx(report, filters), f"report_{metric}.xlsx"
    )


@router.get(
    "/reports/traceability-matrix/export.xlsx", dependencies=[Depends(require_reports_not_hidden)]
)
def traceability_matrix_export_xlsx(
    project_id: UUID = Query(),
    ctx: SessionContext = Depends(require_permission("report.view")),
    db: Session = Depends(get_db),
) -> Response:
    report = reporting_service.get_traceability_matrix(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return _xlsx_response(
        reporting_service.traceability_matrix_to_xlsx(report), "traceability_matrix.xlsx"
    )


@router.get("/reports/compliance-export.xlsx", dependencies=[Depends(require_reports_not_hidden)])
def compliance_export_xlsx(
    period_from: datetime | None = Query(default=None),
    period_to: datetime | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("report.compliance_export")),
    db: Session = Depends(get_db),
) -> Response:
    reporting_officer = db.execute(select(User).where(User.id == ctx.user_id)).scalar_one()
    report = reporting_service.get_compliance_report(
        db, ctx.tenant_id, reporting_officer, ctx.role_code, ctx.user_id, period_from, period_to
    )
    quality = reporting_service.get_quality_metrics(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, days=30, run_type="all"
    )
    return _xlsx_response(
        reporting_service.compliance_report_to_xlsx(report, quality), "compliance_summary.xlsx"
    )
