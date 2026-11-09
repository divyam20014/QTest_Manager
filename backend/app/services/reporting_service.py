import csv
import io
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.defect import Defect
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.tenant import Tenant
from app.models.test_case import TestCase
from app.schemas.reporting import (
    ActivityEntry,
    AggregateReport,
    AggregateRow,
    ComplianceDefectRow,
    ComplianceProjectSection,
    ComplianceReport,
    ComplianceTestCaseRow,
    DashboardSummary,
    DefectBacklogSummary,
    DomainDistributionEntry,
    ExecutionTrendPoint,
    ExecutionTrendReport,
    GroupBy,
    Metric,
    ProjectStatusBreakdown,
    TestCaseSummary,
    TestRunSummary,
)

DOMAINS = ["Motor", "Health", "Travel", "Life", "Property"]


def _accessible_project_ids(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID
) -> set[UUID] | None:
    """ADR-027: Tester's dashboard/reporting scope mirrors ADR-019's
    assigned-projects restriction; None means tenant-wide (Admin/Manager)."""
    if role_code != "tester":
        return None
    owned = set(
        db.execute(
            select(Project.id).where(Project.tenant_id == tenant_id, Project.owner_id == user_id)
        ).scalars()
    )
    member_of = set(
        db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        ).scalars()
    )
    return owned | member_of


def get_dashboard_summary(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID
) -> DashboardSummary:
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    project_query = select(Project).where(Project.tenant_id == tenant_id)
    if accessible is not None:
        project_query = project_query.where(Project.id.in_(accessible))
    projects = list(db.execute(project_query).scalars())
    status_counts: dict[str, int] = {}
    for p in projects:
        status_counts[p.status] = status_counts.get(p.status, 0) + 1
    # "Active" = not yet Completed (ADR-038) -- the only project status that
    # represents finished work; On Track/At Risk/Delayed are all still open.
    active_projects = sum(n for status, n in status_counts.items() if status != "Completed")

    tc_query = (
        select(TestCase.status, func.count())
        .join(Project, Project.id == TestCase.project_id)
        .where(Project.tenant_id == tenant_id)
    )
    if accessible is not None:
        tc_query = tc_query.where(Project.id.in_(accessible))
    tc_counts: dict[str, int] = dict(db.execute(tc_query.group_by(TestCase.status)).tuples().all())
    tc_total = sum(tc_counts.values())
    approved_count = tc_counts.get("approved", 0)
    approved_ratio = (approved_count / tc_total) if tc_total else 0.0

    run_query = (
        select(func.count())
        .select_from(TestRun)
        .join(Project, Project.id == TestRun.project_id)
        .where(Project.tenant_id == tenant_id, TestRun.finished_at.is_(None))
    )
    if accessible is not None:
        run_query = run_query.where(Project.id.in_(accessible))
    active_runs = db.execute(run_query).scalar_one()

    step_query = (
        select(ExecutionStep.verdict, func.count())
        .select_from(ExecutionStep)
        .join(TestRunCase, TestRunCase.id == ExecutionStep.test_run_case_id)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(Project, Project.id == TestRun.project_id)
        .where(Project.tenant_id == tenant_id, ExecutionStep.verdict.is_not(None))
    )
    if accessible is not None:
        step_query = step_query.where(Project.id.in_(accessible))
    step_counts: dict[str | None, int] = dict(
        db.execute(step_query.group_by(ExecutionStep.verdict)).tuples().all()
    )
    step_total = sum(step_counts.values())
    step_pass_percentage = (step_counts.get("pass", 0) / step_total) if step_total else 0.0

    defect_query = (
        select(Defect.severity, func.count())
        .join(Project, Project.id == Defect.project_id)
        .where(Project.tenant_id == tenant_id, Defect.status != "Closed")
    )
    if accessible is not None:
        defect_query = defect_query.where(Project.id.in_(accessible))
    open_by_severity: dict[str, int] = dict(
        db.execute(defect_query.group_by(Defect.severity)).tuples().all()
    )

    return DashboardSummary(
        projects=ProjectStatusBreakdown(
            total=len(projects), active=active_projects, by_status=status_counts
        ),
        test_cases=TestCaseSummary(
            total=tc_total, approved_count=approved_count, approved_ratio=approved_ratio
        ),
        test_runs=TestRunSummary(active=active_runs, step_pass_percentage=step_pass_percentage),
        defects=DefectBacklogSummary(
            open_by_severity=open_by_severity,
            critical_count=open_by_severity.get("Critical", 0),
        ),
    )


def get_domain_distribution(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID
) -> list[DomainDistributionEntry]:
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    entries = []
    for domain in DOMAINS:
        project_query = select(Project).where(
            Project.tenant_id == tenant_id, Project.domain == domain
        )
        if accessible is not None:
            project_query = project_query.where(Project.id.in_(accessible))
        projects = list(db.execute(project_query).scalars())
        project_ids = [p.id for p in projects]
        if not project_ids:
            entries.append(
                DomainDistributionEntry(
                    domain=domain,
                    project_count=0,
                    test_case_count=0,
                    approved_percentage=0.0,
                    open_defect_count=0,
                    pass_percentage=0.0,
                )
            )
            continue

        tc_counts: dict[str, int] = dict(
            db.execute(
                select(TestCase.status, func.count())
                .where(TestCase.project_id.in_(project_ids))
                .group_by(TestCase.status)
            )
            .tuples()
            .all()
        )
        tc_total = sum(tc_counts.values())
        approved_percentage = (tc_counts.get("approved", 0) / tc_total * 100) if tc_total else 0.0

        open_defect_count = db.execute(
            select(func.count())
            .select_from(Defect)
            .where(Defect.project_id.in_(project_ids), Defect.status != "Closed")
        ).scalar_one()

        step_counts: dict[str | None, int] = dict(
            db.execute(
                select(ExecutionStep.verdict, func.count())
                .select_from(ExecutionStep)
                .join(TestRunCase, TestRunCase.id == ExecutionStep.test_run_case_id)
                .join(TestRun, TestRun.id == TestRunCase.test_run_id)
                .where(TestRun.project_id.in_(project_ids), ExecutionStep.verdict.is_not(None))
                .group_by(ExecutionStep.verdict)
            )
            .tuples()
            .all()
        )
        step_total = sum(step_counts.values())
        pass_percentage = (step_counts.get("pass", 0) / step_total * 100) if step_total else 0.0

        entries.append(
            DomainDistributionEntry(
                domain=domain,
                project_count=len(projects),
                test_case_count=tc_total,
                approved_percentage=approved_percentage,
                open_defect_count=open_defect_count,
                pass_percentage=pass_percentage,
            )
        )
    return entries


def get_activity_stream(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID
) -> list[ActivityEntry]:
    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(AuditLog.tenant_id == tenant_id)
        .order_by(AuditLog.created_at.desc())
        .limit(10)
    ).all()
    return [
        ActivityEntry(
            user_name=user_name,
            action=log.action,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def _resolve_user_names(db: Session, user_ids: set[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    rows = db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).tuples().all()
    return dict(rows)


def get_aggregate_report(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    metric: Metric,
    group_by: GroupBy,
    *,
    project_id: UUID | None = None,
    domain: str | None = None,
    assignee_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    priority: str | None = None,
    status: str | None = None,
) -> AggregateReport:
    """Report filters (ADR-038): project/domain/assignee/date-range narrow
    the result set for any metric; priority/status specifically narrow by
    the *test case's own* priority/authoring-status, joined in for every
    metric (not just the "priority"/"test_case_status" metrics themselves)
    -- e.g. "show defect severity breakdown, but only for Critical-priority
    test cases." Defects with no linked test case (standalone) are excluded
    whenever a priority/status filter is applied, which is correct: there
    is nothing for such a filter to match against.
    """
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    base: Any
    if metric == "run_status":
        base = (
            select(
                TestRunCase.status.label("value"),
                TestRunCase.assigned_to.label("assignee_id"),
                Project.id.label("project_id"),
                Project.name.label("project_name"),
                Project.domain.label("domain"),
                TestCase.priority.label("tc_priority"),
                TestCase.status.label("tc_status"),
                TestRun.created_at.label("created_at"),
            )
            .join(TestRun, TestRun.id == TestRunCase.test_run_id)
            .join(Project, Project.id == TestRun.project_id)
            .join(TestCase, TestCase.id == TestRunCase.test_case_id)
            .where(Project.tenant_id == tenant_id)
        )
    elif metric in ("priority", "test_case_status"):
        value_col = TestCase.priority if metric == "priority" else TestCase.status
        base = (
            select(
                value_col.label("value"),
                TestCase.assignee_id.label("assignee_id"),
                Project.id.label("project_id"),
                Project.name.label("project_name"),
                Project.domain.label("domain"),
                TestCase.priority.label("tc_priority"),
                TestCase.status.label("tc_status"),
                TestCase.created_at.label("created_at"),
            )
            .join(Project, Project.id == TestCase.project_id)
            .where(Project.tenant_id == tenant_id)
        )
    elif metric in ("defect_severity", "defect_status"):
        value_col = Defect.severity if metric == "defect_severity" else Defect.status
        base = (
            select(
                value_col.label("value"),
                Defect.reported_by.label("assignee_id"),
                Project.id.label("project_id"),
                Project.name.label("project_name"),
                Project.domain.label("domain"),
                TestCase.priority.label("tc_priority"),
                TestCase.status.label("tc_status"),
                Defect.created_at.label("created_at"),
            )
            .join(Project, Project.id == Defect.project_id)
            .outerjoin(TestCase, TestCase.id == Defect.test_case_id)
            .where(Project.tenant_id == tenant_id)
        )
    else:
        raise ValueError(f"Unknown metric: {metric}")  # schema already restricts this

    if accessible is not None:
        base = base.where(Project.id.in_(accessible))
    if project_id is not None:
        base = base.where(Project.id == project_id)
    if domain is not None:
        base = base.where(Project.domain == domain)

    subq = base.subquery()

    filtered = select(subq)
    if assignee_id is not None:
        filtered = filtered.where(subq.c.assignee_id == assignee_id)
    if date_from is not None:
        filtered = filtered.where(subq.c.created_at >= date_from)
    if date_to is not None:
        filtered = filtered.where(subq.c.created_at <= date_to)
    if priority is not None:
        filtered = filtered.where(subq.c.tc_priority == priority)
    if status is not None:
        filtered = filtered.where(subq.c.tc_status == status)
    filtered_subq = filtered.subquery()

    group_cols: list[Any]
    if group_by == "project":
        group_cols = [
            filtered_subq.c.project_id,
            filtered_subq.c.project_name,
            filtered_subq.c.value,
        ]
    elif group_by == "domain":
        group_cols = [filtered_subq.c.domain, filtered_subq.c.value]
    elif group_by == "assignee":
        group_cols = [filtered_subq.c.assignee_id, filtered_subq.c.value]
    else:
        raise ValueError(f"Unknown group_by: {group_by}")

    rows = db.execute(select(*group_cols, func.count()).group_by(*group_cols)).all()

    if group_by == "assignee":
        assignee_ids = {r[0] for r in rows if r[0] is not None}
        names = _resolve_user_names(db, assignee_ids)

    result_rows: list[AggregateRow] = []
    for row in rows:
        *group_values, value, count = row
        if group_by == "project":
            row_project_id, project_name = group_values
            result_rows.append(
                AggregateRow(
                    group_key=str(row_project_id),
                    group_label=project_name,
                    value=value,
                    count=count,
                )
            )
        elif group_by == "domain":
            (row_domain,) = group_values
            result_rows.append(
                AggregateRow(group_key=None, group_label=row_domain, value=value, count=count)
            )
        else:
            (row_assignee_id,) = group_values
            label = (
                names.get(row_assignee_id, "Unassigned")
                if row_assignee_id is not None
                else "Unassigned"
            )
            result_rows.append(
                AggregateRow(
                    group_key=str(row_assignee_id) if row_assignee_id is not None else None,
                    group_label=label,
                    value=value,
                    count=count,
                )
            )

    return AggregateReport(metric=metric, group_by=group_by, rows=result_rows)


def get_execution_trend(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    days: int = 30,
    project_id: UUID | None = None,
) -> ExecutionTrendReport:
    """Daily pass/fail/ignore verdict counts over the trailing `days` days
    (spec D's "Execution Trends" metric) -- a time-bucketed series, distinct
    from the current-state snapshot the other metrics compute."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    query = (
        select(
            func.date(ExecutionStep.closed_at).label("day"),
            ExecutionStep.verdict,
            func.count(),
        )
        .select_from(ExecutionStep)
        .join(TestRunCase, TestRunCase.id == ExecutionStep.test_run_case_id)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(Project, Project.id == TestRun.project_id)
        .where(
            Project.tenant_id == tenant_id,
            ExecutionStep.verdict.is_not(None),
            ExecutionStep.closed_at >= func.now() - func.make_interval(0, 0, 0, days),
        )
    )
    if accessible is not None:
        query = query.where(Project.id.in_(accessible))
    if project_id is not None:
        query = query.where(Project.id == project_id)

    rows = db.execute(query.group_by("day", ExecutionStep.verdict).order_by("day")).all()

    by_day: dict[str, dict[str, int]] = {}
    for day, verdict, count in rows:
        key = day.isoformat()
        by_day.setdefault(key, {"pass": 0, "fail": 0, "ignore": 0})
        by_day[key][verdict] = count

    points = [
        ExecutionTrendPoint(
            date=day,
            pass_count=counts["pass"],
            fail_count=counts["fail"],
            ignore_count=counts["ignore"],
        )
        for day, counts in sorted(by_day.items())
    ]
    return ExecutionTrendReport(points=points)


def get_compliance_report(
    db: Session,
    tenant_id: UUID,
    reporting_officer: User,
    period_from: datetime | None = None,
    period_to: datetime | None = None,
) -> ComplianceReport:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one()
    projects = list(db.execute(select(Project).where(Project.tenant_id == tenant_id)).scalars())

    sections: list[ComplianceProjectSection] = []
    for project in projects:
        tc_query = select(TestCase).where(TestCase.project_id == project.id)
        if period_from is not None:
            tc_query = tc_query.where(TestCase.created_at >= period_from)
        if period_to is not None:
            tc_query = tc_query.where(TestCase.created_at <= period_to)
        test_cases = list(db.execute(tc_query).scalars())
        tc_counts: dict[str, int] = {}
        for tc in test_cases:
            tc_counts[tc.status] = tc_counts.get(tc.status, 0) + 1

        defect_query = select(Defect).where(Defect.project_id == project.id)
        if period_from is not None:
            defect_query = defect_query.where(Defect.created_at >= period_from)
        if period_to is not None:
            defect_query = defect_query.where(Defect.created_at <= period_to)
        defects = list(db.execute(defect_query).scalars())
        open_defects = [d for d in defects if d.status != "Closed"]

        sections.append(
            ComplianceProjectSection(
                project_id=project.id,
                name=project.name,
                domain=project.domain,
                total_test_cases=len(test_cases),
                approved_test_cases=tc_counts.get("approved", 0),
                draft_test_cases=tc_counts.get("draft", 0),
                ready_for_review_test_cases=tc_counts.get("ready_for_review", 0),
                open_defects=len(open_defects),
                critical_defects=sum(1 for d in open_defects if d.severity == "Critical"),
                test_cases=[
                    ComplianceTestCaseRow(
                        id=tc.id, title=tc.title, status=tc.status, priority=tc.priority
                    )
                    for tc in test_cases
                ],
                defects=[
                    ComplianceDefectRow(
                        id=d.id, title=d.title, severity=d.severity, status=d.status
                    )
                    for d in defects
                ],
            )
        )

    return ComplianceReport(
        tenant_name=tenant.name,
        generated_at=datetime.now(UTC),
        reporting_officer_name=reporting_officer.name,
        reporting_officer_email=reporting_officer.email,
        period_from=period_from,
        period_to=period_to,
        projects=sections,
    )


def compliance_report_to_csv(report: ComplianceReport) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["QTestHub Compliance Summary"])
    writer.writerow(["Tenant", report.tenant_name])
    writer.writerow(["Generated At (UTC)", report.generated_at.isoformat()])
    writer.writerow(
        ["Reporting Officer", f"{report.reporting_officer_name} ({report.reporting_officer_email})"]
    )
    writer.writerow(
        [
            "Reporting Period",
            f"{report.period_from.isoformat() if report.period_from else 'All time'}"
            f" to {report.period_to.isoformat() if report.period_to else 'present'}",
        ]
    )
    writer.writerow([])
    writer.writerow(
        [
            "Project",
            "Domain",
            "Total Test Cases",
            "Approved",
            "Draft",
            "Ready for Review",
            "Open Defects",
            "Critical Defects",
        ]
    )
    for section in report.projects:
        writer.writerow(
            [
                section.name,
                section.domain,
                section.total_test_cases,
                section.approved_test_cases,
                section.draft_test_cases,
                section.ready_for_review_test_cases,
                section.open_defects,
                section.critical_defects,
            ]
        )

    for section in report.projects:
        writer.writerow([])
        writer.writerow([f"{section.name} -- Test Cases"])
        writer.writerow(["ID", "Title", "Status", "Priority"])
        for tc in section.test_cases:
            writer.writerow([str(tc.id), tc.title, tc.status, tc.priority])

        writer.writerow([])
        writer.writerow([f"{section.name} -- Defects"])
        writer.writerow(["ID", "Title", "Severity", "Status"])
        for d in section.defects:
            writer.writerow([str(d.id), d.title, d.severity, d.status])

    return buffer.getvalue()
