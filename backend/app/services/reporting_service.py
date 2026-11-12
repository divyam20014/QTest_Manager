import csv
import io
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError, NotFoundError
from app.models.audit import AuditLog
from app.models.defect import Defect
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.requirement import Requirement, RequirementTestCaseLink
from app.models.tenant import Tenant
from app.models.test_asset import Release
from app.models.test_case import TestCase
from app.schemas.reporting import (
    ActivityEntry,
    AggregateReport,
    AggregateRow,
    ComplianceDefectRow,
    CompliancePeriodComparison,
    ComplianceProjectSection,
    ComplianceReport,
    ComplianceTestCaseRow,
    DashboardSummary,
    DefectAgingSeverityBucket,
    DefectAgingSummary,
    DefectBacklogSummary,
    DefectTrendPoint,
    DefectTrendReport,
    DomainDistributionEntry,
    ExecutionTrendPoint,
    ExecutionTrendReport,
    FlakyTestEntry,
    FlakyTestReport,
    GroupBy,
    Metric,
    MostReopenedDefect,
    ProjectStatusBreakdown,
    ReleaseReadinessReport,
    ReopenSummary,
    TestCaseSummary,
    TestRunSummary,
    TraceabilityMatrixEntry,
    TraceabilityMatrixReport,
    WorkloadEntry,
    WorkloadSummary,
)
from app.services import requirement_service
from app.services.defect_service import SLA_DAYS_BY_SEVERITY, compute_aging

OPEN_DEFECT_STATUSES = ("New", "Open")
COMPLETED_RUN_CASE_STATUSES = ("passed", "failed", "blocked", "ignored")

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
        test_runs=TestRunSummary(
            active=active_runs,
            step_pass_percentage=step_pass_percentage,
            step_sample_size=step_total,
        ),
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
        value_col: Any = TestCase.priority if metric == "priority" else TestCase.status
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
    elif metric in ("defect_severity", "defect_status", "defect_root_cause"):
        if metric == "defect_severity":
            value_col = Defect.severity
        elif metric == "defect_status":
            value_col = Defect.status
        else:
            # Uncategorized defects group together rather than vanishing
            # from the report (root_cause is nullable -- set at any point
            # during triage, not required at creation).
            value_col = func.coalesce(Defect.root_cause, "uncategorized")
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


def get_defect_trend(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    days: int = 30,
    project_id: UUID | None = None,
) -> DefectTrendReport:
    """Daily opened-vs-closed defect counts over the trailing `days` days
    (PV-6.5) -- distinct from get_domain_distribution's current-snapshot
    open-count, this is a time series of the defect *flow*, mirroring
    get_execution_trend's shape for the analogous metric."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    opened_query = (
        select(func.date(Defect.created_at).label("day"), func.count())
        .select_from(Defect)
        .join(Project, Project.id == Defect.project_id)
        .where(
            Project.tenant_id == tenant_id,
            Defect.created_at >= func.now() - func.make_interval(0, 0, 0, days),
        )
    )
    closed_query = (
        select(func.date(Defect.closed_at).label("day"), func.count())
        .select_from(Defect)
        .join(Project, Project.id == Defect.project_id)
        .where(
            Project.tenant_id == tenant_id,
            Defect.closed_at.is_not(None),
            Defect.closed_at >= func.now() - func.make_interval(0, 0, 0, days),
        )
    )
    if accessible is not None:
        opened_query = opened_query.where(Project.id.in_(accessible))
        closed_query = closed_query.where(Project.id.in_(accessible))
    if project_id is not None:
        opened_query = opened_query.where(Project.id == project_id)
        closed_query = closed_query.where(Project.id == project_id)

    by_day: dict[str, dict[str, int]] = {}
    for day, count in db.execute(opened_query.group_by("day")).all():
        by_day.setdefault(day.isoformat(), {"opened": 0, "closed": 0})["opened"] = count
    for day, count in db.execute(closed_query.group_by("day")).all():
        by_day.setdefault(day.isoformat(), {"opened": 0, "closed": 0})["closed"] = count

    points = [
        DefectTrendPoint(date=day, opened_count=counts["opened"], closed_count=counts["closed"])
        for day, counts in sorted(by_day.items())
    ]
    return DefectTrendReport(points=points)


def get_defect_aging_summary(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None = None,
) -> DefectAgingSummary:
    """Currently-open defects bucketed by severity, each flagged against
    its severity's SLA budget (PV-6.2) via the same compute_aging used on
    every DefectOut -- this just aggregates it instead of showing it
    per-defect."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    query = (
        select(Defect)
        .join(Project, Project.id == Defect.project_id)
        .where(Project.tenant_id == tenant_id, Defect.status != "Closed")
    )
    if accessible is not None:
        query = query.where(Project.id.in_(accessible))
    if project_id is not None:
        query = query.where(Project.id == project_id)

    open_defects = db.execute(query).scalars().all()

    counts: dict[str, dict[str, int]] = {
        sev: {"open": 0, "breached": 0} for sev in SLA_DAYS_BY_SEVERITY
    }
    for defect in open_defects:
        bucket = counts.setdefault(defect.severity, {"open": 0, "breached": 0})
        bucket["open"] += 1
        _, breached = compute_aging(defect)
        if breached:
            bucket["breached"] += 1

    buckets = [
        DefectAgingSeverityBucket(severity=sev, open_count=c["open"], breached_count=c["breached"])
        for sev, c in counts.items()
    ]
    return DefectAgingSummary(
        buckets=buckets,
        total_open=sum(c["open"] for c in counts.values()),
        total_breached=sum(c["breached"] for c in counts.values()),
    )


def get_reopen_summary(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None = None,
    top_n: int = 10,
) -> ReopenSummary:
    """PV-6.3 reopen-rate analytics -- counts defect_service.reopen_defect
    events, which are the only writer of reopened_count/last_reopened_at."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    query = select(Defect).join(Project, Project.id == Defect.project_id).where(
        Project.tenant_id == tenant_id
    )
    if accessible is not None:
        query = query.where(Project.id.in_(accessible))
    if project_id is not None:
        query = query.where(Project.id == project_id)

    defects = db.execute(query).scalars().all()
    total_defects = len(defects)
    reopened = [d for d in defects if d.reopened_count > 0]

    most_reopened = sorted(reopened, key=lambda d: d.reopened_count, reverse=True)[:top_n]

    return ReopenSummary(
        total_defects=total_defects,
        reopened_defects=len(reopened),
        reopen_rate=(len(reopened) / total_defects) if total_defects else 0.0,
        total_reopen_events=sum(d.reopened_count for d in defects),
        most_reopened=[
            MostReopenedDefect(
                defect_id=d.id,
                title=d.title,
                status=d.status,
                reopened_count=d.reopened_count,
                last_reopened_at=d.last_reopened_at,
            )
            for d in most_reopened
            if d.last_reopened_at is not None
        ],
    )


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def get_release_readiness(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    release_id: UUID | None = None,
) -> ReleaseReadinessReport:
    """PV-7.1: the underlying metrics rather than one blended score."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    if accessible is not None and project_id not in accessible:
        raise ForbiddenError("Project not accessible")
    project = _get_project_or_404(db, tenant_id, project_id)

    release_name = None
    if release_id is not None:
        release = db.execute(
            select(Release).where(
                Release.tenant_id == tenant_id,
                Release.id == release_id,
                Release.project_id == project.id,
            )
        ).scalar_one_or_none()
        if release is None:
            raise NotFoundError("Release not found")
        release_name = release.name

    total_test_cases = db.execute(
        select(func.count()).select_from(TestCase).where(TestCase.project_id == project_id)
    ).scalar_one()

    run_case_statuses = list(
        db.execute(
            select(TestRunCase.status)
            .join(TestRun, TestRun.id == TestRunCase.test_run_id)
            .where(TestRun.tenant_id == tenant_id, TestRun.project_id == project_id)
        ).scalars()
    )
    total_run_cases = len(run_case_statuses)
    completed = sum(1 for s in run_case_statuses if s in COMPLETED_RUN_CASE_STATUSES)
    passed = sum(1 for s in run_case_statuses if s == "passed")
    completion_pct = round((completed / total_run_cases) * 100, 1) if total_run_cases else 0.0
    pass_pct = round((passed / completed) * 100, 1) if completed else 0.0

    open_defects = db.execute(
        select(Defect.severity, func.count())
        .where(
            Defect.tenant_id == tenant_id,
            Defect.project_id == project_id,
            Defect.status.in_(OPEN_DEFECT_STATUSES),
        )
        .group_by(Defect.severity)
    ).all()
    open_by_severity = {sev: count for sev, count in open_defects}

    coverage = requirement_service.get_coverage_report(
        db, tenant_id, role_code, user_id, project_id
    )

    return ReleaseReadinessReport(
        project_id=project_id,
        release_id=release_id,
        release_name=release_name,
        total_test_cases=total_test_cases,
        execution_completion_percentage=completion_pct,
        pass_percentage=pass_pct,
        open_defects_by_severity=open_by_severity,
        requirement_coverage_percentage=coverage.coverage_percentage,
    )


def get_workload_summary(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> WorkloadSummary:
    """PV-7.2: per-user breakdown to spot over/under-loaded testers.
    "Defects reported" rather than "assigned" -- Defect has no assignee
    field today, only reported_by."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    if accessible is not None and project_id not in accessible:
        raise ForbiddenError("Project not accessible")

    assigned_tc: dict[UUID, int] = {}
    for assignee_id, count in db.execute(
        select(TestCase.assignee_id, func.count())
        .where(TestCase.project_id == project_id, TestCase.assignee_id.is_not(None))
        .group_by(TestCase.assignee_id)
    ).all():
        assigned_tc[assignee_id] = count

    pending: dict[UUID, int] = {}
    in_progress: dict[UUID, int] = {}
    for assigned_to, status, count in db.execute(
        select(TestRunCase.assigned_to, TestRunCase.status, func.count())
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .where(
            TestRun.project_id == project_id,
            TestRunCase.assigned_to.is_not(None),
            TestRunCase.status.in_(("pending", "in_progress")),
        )
        .group_by(TestRunCase.assigned_to, TestRunCase.status)
    ).all():
        if status == "pending":
            pending[assigned_to] = count
        else:
            in_progress[assigned_to] = count

    reported_open: dict[UUID, int] = {}
    for reported_by, count in db.execute(
        select(Defect.reported_by, func.count())
        .where(Defect.project_id == project_id, Defect.status.in_(OPEN_DEFECT_STATUSES))
        .group_by(Defect.reported_by)
    ).all():
        reported_open[reported_by] = count

    all_user_ids = set(assigned_tc) | set(pending) | set(in_progress) | set(reported_open)
    names = _resolve_user_names(db, all_user_ids)

    entries = [
        WorkloadEntry(
            user_id=uid,
            user_name=names.get(uid),
            assigned_test_cases=assigned_tc.get(uid, 0),
            assigned_test_run_cases_pending=pending.get(uid, 0),
            assigned_test_run_cases_in_progress=in_progress.get(uid, 0),
            defects_reported_open=reported_open.get(uid, 0),
        )
        for uid in all_user_ids
    ]
    entries.sort(key=lambda e: e.user_name or "")
    return WorkloadSummary(project_id=project_id, entries=entries)


def get_flaky_tests(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    limit: int = 10,
) -> FlakyTestReport:
    """PV-7.4: a test case is 'flaky' when its pass/fail verdict flips
    between consecutive runs while pinned to the SAME test_case_version_id
    -- a flip tied to a version change is a legitimate behavior change,
    not flakiness."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    if accessible is not None and project_id not in accessible:
        raise ForbiddenError("Project not accessible")

    rows = db.execute(
        select(
            TestRunCase.test_case_id,
            TestCase.title,
            TestRunCase.test_case_version_id,
            TestRunCase.status,
            TestRunCase.completed_at,
        )
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(TestCase, TestCase.id == TestRunCase.test_case_id)
        .where(
            TestRun.project_id == project_id,
            TestRunCase.status.in_(("passed", "failed")),
            TestRunCase.completed_at.is_not(None),
        )
        .order_by(TestRunCase.test_case_id, TestRunCase.completed_at)
    ).all()

    by_case: dict[UUID, list[tuple]] = {}
    titles: dict[UUID, str] = {}
    for test_case_id, title, version_id, status, _completed_at in rows:
        by_case.setdefault(test_case_id, []).append((version_id, status))
        titles[test_case_id] = title

    entries = []
    for test_case_id, runs in by_case.items():
        if len(runs) < 2:
            continue
        flips = sum(
            1
            for (prev_version, prev_status), (version, status) in zip(runs, runs[1:], strict=False)
            if version == prev_version and status != prev_status
        )
        if flips == 0:
            continue
        entries.append(
            FlakyTestEntry(
                test_case_id=test_case_id,
                test_case_title=titles[test_case_id],
                run_count=len(runs),
                flip_count=flips,
                flip_rate=round(flips / (len(runs) - 1), 2),
            )
        )

    entries.sort(key=lambda e: e.flip_rate, reverse=True)
    return FlakyTestReport(project_id=project_id, tests=entries[:limit])


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def get_traceability_matrix(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> TraceabilityMatrixReport:
    """Phase 3 RTM: per-requirement pass/fail/blocked/not-executed breakdown,
    not just the linked-test-case COUNT that RequirementCoverageReport gives.
    'Latest status per test case' is picked the same way get_flaky_tests
    already orders executions -- by recency -- here across (run creation,
    started_at, completed_at) since a case's run can still be in progress
    (no completed_at yet) and should still count as the most recent attempt
    if its run is the newest one touching that case."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    if accessible is not None and project_id not in accessible:
        raise ForbiddenError("Project not accessible")
    _get_project_or_404(db, tenant_id, project_id)

    requirements = list(
        db.execute(
            select(Requirement)
            .where(Requirement.tenant_id == tenant_id, Requirement.project_id == project_id)
            .order_by(Requirement.created_at)
        ).scalars()
    )

    overall_coverage = requirement_service.get_coverage_report(
        db, tenant_id, role_code, user_id, project_id
    )

    if not requirements:
        return TraceabilityMatrixReport(
            project_id=project_id,
            total_requirements=0,
            overall_requirement_coverage_percentage=overall_coverage.coverage_percentage,
            entries=[],
        )

    requirement_ids = [r.id for r in requirements]
    links = db.execute(
        select(RequirementTestCaseLink.requirement_id, RequirementTestCaseLink.test_case_id).where(
            RequirementTestCaseLink.requirement_id.in_(requirement_ids)
        )
    ).all()
    req_to_cases: dict[UUID, list[UUID]] = {}
    all_case_ids: set[UUID] = set()
    for req_id, case_id in links:
        req_to_cases.setdefault(req_id, []).append(case_id)
        all_case_ids.add(case_id)

    latest_status: dict[UUID, str] = {}
    if all_case_ids:
        rows = db.execute(
            select(
                TestRunCase.test_case_id,
                TestRunCase.status,
                TestRun.created_at,
                TestRunCase.started_at,
                TestRunCase.completed_at,
                TestRunCase.id,
            )
            .join(TestRun, TestRun.id == TestRunCase.test_run_id)
            .where(TestRun.project_id == project_id, TestRunCase.test_case_id.in_(all_case_ids))
        ).all()
        ordered = sorted(
            rows,
            key=lambda r: (r[2], r[3] or _EPOCH, r[4] or _EPOCH, r[5]),
        )
        for test_case_id, status, *_rest in ordered:
            latest_status[test_case_id] = status  # last write wins == most recent

    entries = []
    for req in requirements:
        case_ids = req_to_cases.get(req.id, [])
        total = len(case_ids)
        passed = failed = blocked = 0
        for cid in case_ids:
            status = latest_status.get(cid)
            if status == "passed":
                passed += 1
            elif status == "failed":
                failed += 1
            elif status == "blocked":
                blocked += 1
        not_executed = total - passed - failed - blocked
        coverage_pct = round(((passed + failed + blocked) / total) * 100, 1) if total else 0.0
        entries.append(
            TraceabilityMatrixEntry(
                requirement_id=req.id,
                requirement_title=req.title,
                linked_test_case_count=total,
                passed_count=passed,
                failed_count=failed,
                blocked_count=blocked,
                not_executed_count=not_executed,
                coverage_percentage=coverage_pct,
            )
        )

    return TraceabilityMatrixReport(
        project_id=project_id,
        total_requirements=len(requirements),
        overall_requirement_coverage_percentage=overall_coverage.coverage_percentage,
        entries=entries,
    )


def traceability_matrix_to_csv(report: TraceabilityMatrixReport) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Requirement",
            "Linked Test Cases",
            "Passed",
            "Failed",
            "Blocked",
            "Not Executed",
            "Coverage %",
        ]
    )
    for e in report.entries:
        writer.writerow(
            [
                e.requirement_title,
                e.linked_test_case_count,
                e.passed_count,
                e.failed_count,
                e.blocked_count,
                e.not_executed_count,
                e.coverage_percentage,
            ]
        )
    return buf.getvalue()


def get_compliance_report(
    db: Session,
    tenant_id: UUID,
    reporting_officer: User,
    role_code: str,
    user_id: UUID,
    period_from: datetime | None = None,
    period_to: datetime | None = None,
) -> ComplianceReport:
    from app.services.requirement_service import get_coverage_report

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

        coverage = get_coverage_report(db, tenant_id, role_code, user_id, project.id)
        aging = get_defect_aging_summary(db, tenant_id, role_code, user_id, project.id)

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
                requirement_total=coverage.total_requirements,
                requirement_covered=coverage.covered_requirements,
                requirement_coverage_percentage=coverage.coverage_percentage,
                defect_aging=aging,
            )
        )

    trend = _compliance_period_trend(db, tenant_id, period_from, period_to)

    return ComplianceReport(
        tenant_name=tenant.name,
        generated_at=datetime.now(UTC),
        reporting_officer_name=reporting_officer.name,
        reporting_officer_email=reporting_officer.email,
        period_from=period_from,
        period_to=period_to,
        projects=sections,
        trend=trend,
    )


def _compliance_period_trend(
    db: Session,
    tenant_id: UUID,
    period_from: datetime | None,
    period_to: datetime | None,
) -> CompliancePeriodComparison | None:
    """Cheap this-period-vs-prior-period comparison: the prior window is the
    same length immediately before period_from. No trend if no period was
    specified -- there is no meaningful "prior" to an all-time report."""
    if period_from is None or period_to is None:
        return None
    window = period_to - period_from
    if window.total_seconds() <= 0:
        return None
    prior_from = period_from - window
    prior_to = period_from

    def _count(model: type[TestCase] | type[Defect], gte: datetime, lt: datetime) -> int:
        return db.execute(
            select(func.count())
            .select_from(model)
            .join(Project, Project.id == model.project_id)
            .where(
                Project.tenant_id == tenant_id,
                model.created_at >= gte,
                model.created_at < lt,
            )
        ).scalar_one()

    def _count_defects_closed(gte: datetime, lt: datetime) -> int:
        # Defect has no updated_at column -- the audit log (already
        # hash-chained, already the source of truth for every defect history
        # view elsewhere in this app) is the only reliable record of *when*
        # a status transition happened, not just its current status.
        return db.execute(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.tenant_id == tenant_id,
                AuditLog.entity_type == "defect",
                AuditLog.action == "defect.status_changed",
                AuditLog.event_metadata["to"].astext == "Closed",
                AuditLog.created_at >= gte,
                AuditLog.created_at < lt,
            )
        ).scalar_one()

    return CompliancePeriodComparison(
        test_cases_created_current=_count(TestCase, period_from, period_to),
        test_cases_created_prior=_count(TestCase, prior_from, prior_to),
        defects_opened_current=_count(Defect, period_from, period_to),
        defects_opened_prior=_count(Defect, prior_from, prior_to),
        defects_closed_current=_count_defects_closed(period_from, period_to),
        defects_closed_prior=_count_defects_closed(prior_from, prior_to),
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
            "Requirements Covered",
            "Requirement Coverage %",
            "Defects Open",
            "Defects SLA-Breached",
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
                f"{section.requirement_covered}/{section.requirement_total}",
                section.requirement_coverage_percentage,
                section.defect_aging.total_open,
                section.defect_aging.total_breached,
            ]
        )

    if report.trend is not None:
        writer.writerow([])
        writer.writerow(["Period-over-Period Trend", "Current Period", "Prior Period"])
        writer.writerow(
            [
                "Test Cases Created",
                report.trend.test_cases_created_current,
                report.trend.test_cases_created_prior,
            ]
        )
        writer.writerow(
            [
                "Defects Opened",
                report.trend.defects_opened_current,
                report.trend.defects_opened_prior,
            ]
        )
        writer.writerow(
            [
                "Defects Closed",
                report.trend.defects_closed_current,
                report.trend.defects_closed_prior,
            ]
        )

    for section in report.projects:
        writer.writerow([])
        writer.writerow([f"{section.name} -- Defect Aging by Severity"])
        writer.writerow(["Severity", "Open", "SLA-Breached"])
        for bucket in section.defect_aging.buckets:
            writer.writerow([bucket.severity, bucket.open_count, bucket.breached_count])

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
