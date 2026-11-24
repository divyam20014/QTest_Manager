import csv
import io
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, exists, func, null, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError, NotFoundError
from app.core.field_standards import (
    CLOSED_DEFECT_STATUSES,
    EXECUTION_STATUS_BY_RUN_CASE_STATUS,
    OPEN_DEFECT_STATUSES,
    PARKED_DEFECT_STATUSES,
)
from app.core.ttl_cache import cached_report
from app.core.xlsx_report import SheetSpec, build_workbook
from app.models.audit import AuditLog
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.requirement import Requirement, RequirementTestCaseLink
from app.models.shared_step import SharedStep
from app.models.tenant import Tenant
from app.models.test_asset import Build, Environment, Release
from app.models.test_case import TestCase
from app.models.test_data_set import TestDataSet
from app.models.test_module import TestModule
from app.models.test_plan import TestPlan
from app.models.test_suite import TestSuite
from app.schemas.reporting import (
    ActivityEntry,
    AggregateReport,
    AggregateRow,
    ComplianceDefectRow,
    CompliancePeriodComparison,
    ComplianceProjectSection,
    ComplianceReport,
    ComplianceTestCaseRow,
    CycleTimeByProject,
    DashboardPrevious,
    DashboardSummary,
    DefectAgingSeverityBucket,
    DefectAgingSummary,
    DefectBacklogSummary,
    DefectLeakageReport,
    DefectTrendPoint,
    DefectTrendReport,
    DomainDistributionEntry,
    ExecutionTrendPoint,
    ExecutionTrendReport,
    FlakyTestEntry,
    FlakyTestReport,
    GroupBy,
    LeakageAgeBuckets,
    LeakageReleaseRow,
    LeakageTrendPoint,
    Metric,
    MilestoneRow,
    ModuleCoverageReport,
    ModuleCoverageRow,
    MostReopenedDefect,
    OverdueRunCaseRow,
    OverdueRunCasesReport,
    ProjectStatusBreakdown,
    ProjectTestStatus,
    QualityMetricsReport,
    ReleaseReadinessReport,
    ReopenSummary,
    RunTypeFilter,
    TestCaseSummary,
    TesterPerformanceReport,
    TesterPerformanceRow,
    TestRunSummary,
    TraceabilityMatrixEntry,
    TraceabilityMatrixReport,
    UpcomingMilestonesReport,
    WorkloadEntry,
    WorkloadSummary,
)
from app.services import requirement_service, tester_visibility
from app.services.defect_service import SLA_DAYS_ALL, SLA_DAYS_BY_SEVERITY

COMPLETED_RUN_CASE_STATUSES = ("passed", "failed", "blocked", "ignored")

DOMAINS = ["Motor", "Health", "Travel", "Life", "Property"]

# `defect_service.compute_aging` falls back to this budget for an unknown severity.
DEFAULT_SLA_DAYS = 10


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


def _step_query(
    tenant_id: UUID,
    accessible: set[UUID] | None,
    project_id: UUID | None,
    *columns: Any,
) -> Any:
    """`SELECT <columns> FROM execution_steps` restricted to recorded verdicts of
    this tenant's (non-deleted) runs in the caller's project scope (ADR-113).

    Joins steps -> run cases -> runs only; the `projects` join the report queries
    used to carry is redundant, because a run's project_id is what the scope
    filters on and a run cannot belong to another tenant's project (RLS + FKs).
    Callers add their own period filter and GROUP BY."""
    query = (
        select(*columns)
        .select_from(ExecutionStep)
        .join(TestRunCase, TestRunCase.id == ExecutionStep.test_run_case_id)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .where(ExecutionStep.tenant_id == tenant_id, ExecutionStep.verdict.is_not(None))
    )
    if accessible is not None:
        query = query.where(TestRun.project_id.in_(accessible))
    if project_id is not None:
        query = query.where(TestRun.project_id == project_id)
    return query


# ADR-110: KPI trend baseline = state this many days ago.
PREVIOUS_PERIOD_DAYS = 30


@cached_report("dashboard_summary")
def get_dashboard_summary(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None = None,
) -> DashboardSummary:
    """ADR-079: with `project_id`, every figure is narrowed to that one project (still
    intersected with what the caller may see, so a project outside their scope gives
    zeros, like the other reports)."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    project_query = select(Project).where(Project.tenant_id == tenant_id)
    if accessible is not None:
        project_query = project_query.where(Project.id.in_(accessible))
    if project_id is not None:
        project_query = project_query.where(Project.id == project_id)
    projects = list(db.execute(project_query).scalars())
    status_counts: dict[str, int] = {}
    for p in projects:
        status_counts[p.status] = status_counts.get(p.status, 0) + 1
    # "Active" = not yet Completed (ADR-038) -- the only project status that
    # represents finished work; On Track/At Risk/Delayed are all still open.
    active_projects = sum(n for status, n in status_counts.items() if status != "Completed")

    cutoff = datetime.now(UTC) - timedelta(days=PREVIOUS_PERIOD_DAYS)
    # ADR-113: one pass over the test cases gives both the current per-status counts
    # and the "as of the cutoff" baseline total (same project + visibility scope),
    # filtering on test_cases' own tenant/project columns instead of joining `projects`.
    tc_query = select(
        TestCase.status, func.count(), func.count().filter(TestCase.created_at <= cutoff)
    ).where(TestCase.tenant_id == tenant_id)
    if accessible is not None:
        tc_query = tc_query.where(TestCase.project_id.in_(accessible))
    if project_id is not None:
        tc_query = tc_query.where(TestCase.project_id == project_id)
    tc_query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, tc_query)
    tc_counts: dict[str, int] = {}
    prev_tc_total = 0
    for tc_status, n_all, n_prev in db.execute(tc_query.group_by(TestCase.status)):
        tc_counts[tc_status] = n_all
        prev_tc_total += n_prev
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
    if project_id is not None:
        run_query = run_query.where(Project.id == project_id)
    active_runs = db.execute(run_query).scalar_one()

    # One pass over the step verdicts yields both the current counts and the
    # "as of the cutoff" baseline (a subset: steps closed on or before it).
    step_counts: dict[str | None, int] = {}
    prev_step_counts: dict[str | None, int] = {}
    for verdict, n_all, n_prev in db.execute(
        _step_query(
            tenant_id,
            accessible,
            project_id,
            ExecutionStep.verdict,
            func.count(),
            func.count().filter(ExecutionStep.closed_at <= cutoff),
        ).group_by(ExecutionStep.verdict)
    ):
        step_counts[verdict] = n_all
        prev_step_counts[verdict] = n_prev
    step_total = sum(step_counts.values())
    step_pass_percentage = (step_counts.get("pass", 0) / step_total) if step_total else 0.0

    # Open defects per severity and the "open as of the cutoff" baseline in one pass.
    defect_query = select(
        Defect.severity,
        func.count().filter(Defect.status.notin_(CLOSED_DEFECT_STATUSES)),
        func.count().filter(
            Defect.created_at <= cutoff,
            or_(Defect.closed_at.is_(None), Defect.closed_at > cutoff),
        ),
    ).where(Defect.tenant_id == tenant_id)
    if accessible is not None:
        defect_query = defect_query.where(Defect.project_id.in_(accessible))
    if project_id is not None:
        defect_query = defect_query.where(Defect.project_id == project_id)
    open_by_severity: dict[str, int] = {}
    prev_open_defects = 0
    for severity, n_open, n_prev_open in db.execute(defect_query.group_by(Defect.severity)):
        if n_open:
            open_by_severity[severity] = n_open
        prev_open_defects += n_prev_open

    def _scoped(q):
        if accessible is not None:
            q = q.where(Project.id.in_(accessible))
        if project_id is not None:
            q = q.where(Project.id == project_id)
        return q

    prev_runs = _scoped(
        select(func.count())
        .select_from(TestRun)
        .join(Project, Project.id == TestRun.project_id)
        .where(
            Project.tenant_id == tenant_id,
            TestRun.created_at <= cutoff,
            or_(TestRun.finished_at.is_(None), TestRun.finished_at > cutoff),
        )
    )
    prev_step_total = sum(prev_step_counts.values())
    previous = DashboardPrevious(
        days=PREVIOUS_PERIOD_DAYS,
        test_cases_total=prev_tc_total,
        active_runs=db.execute(prev_runs).scalar_one(),
        open_defects=prev_open_defects,
        step_pass_percentage=(prev_step_counts.get("pass", 0) / prev_step_total)
        if prev_step_total
        else 0.0,
        step_sample_size=prev_step_total,
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
        previous=previous,
    )


@cached_report("domain_distribution")
def get_domain_distribution(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID
) -> list[DomainDistributionEntry]:
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)

    # ADR-113: one grouped query per measure for ALL domains (was five domains x
    # four queries, the step-verdict one a scan of the whole run/step graph each).
    project_query = select(Project.id, Project.domain).where(
        Project.tenant_id == tenant_id, Project.domain.in_(DOMAINS)
    )
    if accessible is not None:
        project_query = project_query.where(Project.id.in_(accessible))
    domain_of: dict[UUID, str] = dict(db.execute(project_query).tuples().all())
    project_ids = list(domain_of)
    project_counts: dict[str, int] = {}
    for dom in domain_of.values():
        project_counts[dom] = project_counts.get(dom, 0) + 1

    tc_by_domain: dict[str, dict[str, int]] = {}
    open_defects_by_domain: dict[str, int] = {}
    steps_by_domain: dict[str, dict[str | None, int]] = {}
    if project_ids:
        for dom, tc_status, n in db.execute(
            tester_visibility.scope_case_query(
                db,
                tenant_id,
                role_code,
                user_id,
                select(Project.domain, TestCase.status, func.count())
                .select_from(TestCase)
                .join(Project, Project.id == TestCase.project_id)
                .where(TestCase.project_id.in_(project_ids)),
            ).group_by(Project.domain, TestCase.status)
        ):
            tc_by_domain.setdefault(dom, {})[tc_status] = n
        open_defects_by_domain = dict(
            db.execute(
                select(Project.domain, func.count())
                .select_from(Defect)
                .join(Project, Project.id == Defect.project_id)
                .where(
                    Defect.project_id.in_(project_ids), Defect.status.notin_(CLOSED_DEFECT_STATUSES)
                )
                .group_by(Project.domain)
            )
            .tuples()
            .all()
        )
        # Grouped by run project (no `projects` join: with it the planner picks a
        # 2 s nested loop over the 1M steps instead of a ~0.5 s hash join) and
        # folded into domains here.
        for step_project_id, verdict, n in db.execute(
            _step_query(
                tenant_id, None, None, TestRun.project_id, ExecutionStep.verdict, func.count()
            )
            .where(TestRun.project_id.in_(project_ids))
            .group_by(TestRun.project_id, ExecutionStep.verdict)
        ):
            domain_steps = steps_by_domain.setdefault(domain_of[step_project_id], {})
            domain_steps[verdict] = domain_steps.get(verdict, 0) + n

    entries = []
    for domain in DOMAINS:
        if domain not in project_counts:
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
        tc_counts = tc_by_domain.get(domain, {})
        tc_total = sum(tc_counts.values())
        approved_percentage = (tc_counts.get("approved", 0) / tc_total * 100) if tc_total else 0.0
        step_counts = steps_by_domain.get(domain, {})
        step_total = sum(step_counts.values())
        pass_percentage = (step_counts.get("pass", 0) / step_total * 100) if step_total else 0.0
        entries.append(
            DomainDistributionEntry(
                domain=domain,
                project_count=project_counts[domain],
                test_case_count=tc_total,
                approved_percentage=approved_percentage,
                open_defect_count=open_defects_by_domain.get(domain, 0),
                pass_percentage=pass_percentage,
            )
        )
    return entries


ACTIVITY_FEED_LIMIT = 10
# A tester's feed is filtered in Python after fetching a generous candidate
# window (below), since resolving "which project does this entity belong
# to" varies by entity_type and isn't worth a single giant UNION query at
# this feed's scale. Admin/manager-tier viewers skip this window entirely
# and query LIMIT 10 directly (see role_code branch below), so this cost is
# only paid for the tier that actually needs it.
_ACTIVITY_FEED_CANDIDATE_WINDOW = 200

# Entity types with a direct `project_id` column, keyed by their
# AuditLog.entity_type string. Typed `Any` rather than `type[DeclarativeBase]`
# since mypy can't otherwise see each concrete model's own `id`/`project_id`/
# `tenant_id` columns through a shared base-class signature.
_DIRECT_PROJECT_MODELS: dict[str, Any] = {
    "test_case": TestCase,
    "defect": Defect,
    "test_run": TestRun,
    "requirement": Requirement,
    "test_module": TestModule,
    "test_suite": TestSuite,
    "test_plan": TestPlan,
    "shared_step": SharedStep,
    "build": Build,
    "release": Release,
}

# Entity types that are tenant-wide/administrative and never belong to a
# project at all (hidden from tester-tier viewers entirely, per the user's
# confirmed decision; still visible to admin/manager-tier viewers, same as
# every other tenant-wide report in this app). "user" covers both genuine
# account-security actions (auth.login_attempted/mfa_verified/logout/
# sso_login -- already excluded for every role below by their "auth."
# action prefix, before this set is even consulted) and legitimate
# administrative actions on that same entity_type (user.created/updated/
# password_reset/gdpr_erased) -- only the latter reach this bucket, since
# the former never survive the action-prefix filter.
_NO_PROJECT_ENTITY_TYPES = frozenset(
    {
        "tenant",
        "subscription",
        "custom_field_definition",
        "user_invite",
        "role",
        "scim_token",
        "service_token",
        "status_label",
        "field_option",
        "test_case_import_batch",
        "defect_import_batch",
        "environment",
        "user",
        "session",
    }
)


def _resolve_entity_project_ids(
    db: Session, tenant_id: UUID, entries: list[tuple[str, UUID]]
) -> dict[tuple[str, UUID], UUID | None]:
    """Maps each (entity_type, entity_id) pair to its owning project id, or
    None if that entity has no project (tenant-wide/administrative, or an
    entity_type this function doesn't recognize -- treated the same, safe
    default: not visible to a tester unless they're the actor)."""
    result: dict[tuple[str, UUID], UUID | None] = {}
    ids_by_type: dict[str, set[UUID]] = {}
    for entity_type, entity_id in entries:
        ids_by_type.setdefault(entity_type, set()).add(entity_id)

    for entity_type, ids in ids_by_type.items():
        if entity_type == "project":
            for entity_id in ids:
                result[(entity_type, entity_id)] = entity_id
        elif entity_type in _DIRECT_PROJECT_MODELS:
            model = _DIRECT_PROJECT_MODELS[entity_type]
            rows = db.execute(
                select(model.id, model.project_id).where(
                    model.tenant_id == tenant_id, model.id.in_(ids)
                )
            ).all()
            for entity_id, project_id in rows:
                result[(entity_type, entity_id)] = project_id
        elif entity_type == "test_run_case":
            rows = db.execute(
                select(TestRunCase.id, TestRun.project_id)
                .join(TestRun, TestRun.id == TestRunCase.test_run_id)
                .where(TestRunCase.tenant_id == tenant_id, TestRunCase.id.in_(ids))
            ).all()
            for entity_id, project_id in rows:
                result[(entity_type, entity_id)] = project_id
        elif entity_type == "execution_step":
            rows = db.execute(
                select(ExecutionStep.id, TestRun.project_id)
                .join(TestRunCase, TestRunCase.id == ExecutionStep.test_run_case_id)
                .join(TestRun, TestRun.id == TestRunCase.test_run_id)
                .where(ExecutionStep.tenant_id == tenant_id, ExecutionStep.id.in_(ids))
            ).all()
            for entity_id, project_id in rows:
                result[(entity_type, entity_id)] = project_id
        elif entity_type == "test_data_set":
            rows = db.execute(
                select(TestDataSet.id, TestCase.project_id)
                .join(TestCase, TestCase.id == TestDataSet.test_case_id)
                .where(TestDataSet.tenant_id == tenant_id, TestDataSet.id.in_(ids))
            ).all()
            for entity_id, project_id in rows:
                result[(entity_type, entity_id)] = project_id
        else:
            # Includes _NO_PROJECT_ENTITY_TYPES and any unrecognized future
            # entity_type -- both resolve to "no project," which a tester
            # only sees if they were the actor (checked by the caller).
            for entity_id in ids:
                result[(entity_type, entity_id)] = None

    return result


def get_activity_stream(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None = None,
) -> list[ActivityEntry]:
    base_query = (
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            # auth.* actions (login, MFA, logout, SSO login, session
            # revocation) are account/session-security events, never
            # "work activity" -- excluded for every role, not just
            # narrowed by tier below. Every entity_type="session" row in
            # this app is written exclusively as auth.session_revoked
            # (see auth_service.py), so this one prefix check also
            # fully covers that entity_type with no separate clause.
            ~AuditLog.action.startswith("auth."),
        )
        .order_by(AuditLog.created_at.desc())
    )

    if project_id is not None:
        # ADR-079: only events whose entity belongs to this project, found by resolving the
        # latest tenant events to their projects (audit rows carry no project id). A
        # project the caller may not see has no visible activity.
        scope = _accessible_project_ids(db, tenant_id, role_code, user_id)
        if scope is not None and project_id not in scope:
            return []
        window = db.execute(base_query.limit(_ACTIVITY_FEED_CANDIDATE_WINDOW)).all()
        owner_of = _resolve_entity_project_ids(
            db, tenant_id, [(log.entity_type, log.entity_id) for log, _ in window]
        )
        in_project = [
            (log, name)
            for log, name in window
            if owner_of.get((log.entity_type, log.entity_id)) == project_id
        ]
        return [
            ActivityEntry(
                user_name=name,
                action=log.action,
                entity_type=log.entity_type,
                entity_id=log.entity_id,
                created_at=log.created_at,
            )
            for log, name in in_project[:ACTIVITY_FEED_LIMIT]
        ]
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    if accessible is None:
        # Admin/manager-tier: tenant-wide visibility of work activity,
        # same as every other report in this app -- the universal
        # account-security exclusion above still applies.
        rows = db.execute(base_query.limit(ACTIVITY_FEED_LIMIT)).all()
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

    # Tester-tier: fetch a generous candidate window, then keep only rows
    # the viewer themself performed, or whose entity belongs to a project
    # they have access to. Tenant-wide administrative entity types (no
    # project at all) are hidden unless the viewer was the actor.
    candidates = db.execute(base_query.limit(_ACTIVITY_FEED_CANDIDATE_WINDOW)).all()
    project_by_entity = _resolve_entity_project_ids(
        db, tenant_id, [(log.entity_type, log.entity_id) for log, _ in candidates]
    )

    entries: list[ActivityEntry] = []
    for log, user_name in candidates:
        if len(entries) >= ACTIVITY_FEED_LIMIT:
            break
        if log.user_id == user_id:
            visible = True
        else:
            entity_project_id = project_by_entity.get((log.entity_type, log.entity_id))
            visible = entity_project_id is not None and entity_project_id in accessible
        if visible:
            entries.append(
                ActivityEntry(
                    user_name=user_name,
                    action=log.action,
                    entity_type=log.entity_type,
                    entity_id=log.entity_id,
                    created_at=log.created_at,
                )
            )
    return entries


def _resolve_user_names(db: Session, user_ids: set[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    rows = db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).tuples().all()
    return dict(rows)


@cached_report("aggregate")
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

    # ADR-113: the test case is only joined in when a priority/status filter needs
    # its columns (every run case has a case, and a defect's case link is optional,
    # so skipping the join changes no row counts). It was a 500k-row join per call.
    needs_case = priority is not None or status is not None
    tc_priority_col: Any = TestCase.priority if needs_case else null()
    tc_status_col: Any = TestCase.status if needs_case else null()

    base: Any
    if metric == "run_status":
        base = (
            select(
                TestRunCase.status.label("value"),
                TestRunCase.assigned_to.label("assignee_id"),
                Project.id.label("project_id"),
                Project.name.label("project_name"),
                Project.domain.label("domain"),
                tc_priority_col.label("tc_priority"),
                tc_status_col.label("tc_status"),
                TestRun.created_at.label("created_at"),
            )
            .join(TestRun, TestRun.id == TestRunCase.test_run_id)
            .join(Project, Project.id == TestRun.project_id)
            .where(Project.tenant_id == tenant_id)
        )
        if needs_case:
            base = base.join(TestCase, TestCase.id == TestRunCase.test_case_id)
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
        base = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, base)
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
                tc_priority_col.label("tc_priority"),
                tc_status_col.label("tc_status"),
                Defect.created_at.label("created_at"),
            )
            .join(Project, Project.id == Defect.project_id)
            .where(Project.tenant_id == tenant_id)
        )
        if needs_case:
            base = base.outerjoin(TestCase, TestCase.id == Defect.test_case_id)
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


@cached_report("execution_trend")
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

    query = _step_query(
        tenant_id,
        accessible,
        project_id,
        func.date(ExecutionStep.closed_at).label("day"),
        ExecutionStep.verdict,
        func.count(),
    ).where(ExecutionStep.closed_at >= func.now() - func.make_interval(0, 0, 0, days))

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


@cached_report("defect_trend")
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


@cached_report("defect_aging")
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

    # ADR-113: aggregated in SQL (one row per severity) instead of loading every
    # open defect. Same rule as `compute_aging` for an open defect: breached when
    # age_days = floor(now - created_at in days) exceeds the severity's SLA budget,
    # i.e. when the age is at least (budget + 1) whole days.
    sla_days = case(
        *[(Defect.severity == sev, days) for sev, days in SLA_DAYS_ALL.items()],
        else_=DEFAULT_SLA_DAYS,
    )
    breached_expr = and_(
        Defect.status.notin_(PARKED_DEFECT_STATUSES),
        (func.now() - Defect.created_at) >= func.make_interval(0, 0, 0, sla_days + 1),
    )
    query = (
        select(Defect.severity, func.count(), func.count().filter(breached_expr))
        .select_from(Defect)
        .join(Project, Project.id == Defect.project_id)
        .where(Project.tenant_id == tenant_id, Defect.status.notin_(CLOSED_DEFECT_STATUSES))
    )
    if accessible is not None:
        query = query.where(Project.id.in_(accessible))
    if project_id is not None:
        query = query.where(Project.id == project_id)

    counts: dict[str, dict[str, int]] = {
        sev: {"open": 0, "breached": 0} for sev in SLA_DAYS_BY_SEVERITY
    }
    for severity, open_count, breached_count in db.execute(query.group_by(Defect.severity)).all():
        bucket = counts.setdefault(severity, {"open": 0, "breached": 0})
        bucket["open"] += open_count
        bucket["breached"] += breached_count

    buckets = [
        DefectAgingSeverityBucket(severity=sev, open_count=c["open"], breached_count=c["breached"])
        for sev, c in counts.items()
    ]
    return DefectAgingSummary(
        buckets=buckets,
        total_open=sum(c["open"] for c in counts.values()),
        total_breached=sum(c["breached"] for c in counts.values()),
    )


@cached_report("reopen_summary")
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

    def scoped(q: Any) -> Any:
        q = q.join(Project, Project.id == Defect.project_id).where(Project.tenant_id == tenant_id)
        if accessible is not None:
            q = q.where(Project.id.in_(accessible))
        if project_id is not None:
            q = q.where(Project.id == project_id)
        return q

    # ADR-113: totals in SQL; only the top-N reopened defects are fetched.
    total_defects, reopened_count, reopen_events = db.execute(
        scoped(
            select(
                func.count(),
                func.count().filter(Defect.reopened_count > 0),
                func.coalesce(func.sum(Defect.reopened_count), 0),
            ).select_from(Defect)
        )
    ).one()
    most_reopened = list(
        db.execute(
            scoped(select(Defect).where(Defect.reopened_count > 0))
            .order_by(Defect.reopened_count.desc(), Defect.id)
            .limit(top_n)
        ).scalars()
    )

    return ReopenSummary(
        total_defects=total_defects,
        reopened_defects=reopened_count,
        reopen_rate=(reopened_count / total_defects) if total_defects else 0.0,
        total_reopen_events=int(reopen_events),
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


@cached_report("release_readiness")
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

    run_case_status_counts = dict(
        db.execute(
            select(TestRunCase.status, func.count())
            .join(TestRun, TestRun.id == TestRunCase.test_run_id)
            .where(TestRun.tenant_id == tenant_id, TestRun.project_id == project_id)
            .group_by(TestRunCase.status)
        )
        .tuples()
        .all()
    )
    total_run_cases = sum(run_case_status_counts.values())
    completed = sum(
        n for s, n in run_case_status_counts.items() if s in COMPLETED_RUN_CASE_STATUSES
    )
    passed = run_case_status_counts.get("passed", 0)
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
        quarantined_count=db.execute(
            select(func.count())
            .select_from(TestCase)
            .where(TestCase.project_id == project_id, TestCase.quarantined.is_(True))
        ).scalar_one(),
    )


@cached_report("workload")
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


@cached_report("flaky_tests")
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
            TestCase.quarantined,
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
    quarantined_ids: set[UUID] = set()
    for test_case_id, title, version_id, status, _completed_at, is_quarantined in rows:
        by_case.setdefault(test_case_id, []).append((version_id, status))
        titles[test_case_id] = title
        if is_quarantined:
            quarantined_ids.add(test_case_id)

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
                quarantined=test_case_id in quarantined_ids,
            )
        )

    entries.sort(key=lambda e: e.flip_rate, reverse=True)
    return FlakyTestReport(project_id=project_id, tests=entries[:limit])


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


@cached_report("traceability_matrix")
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
        select(RequirementTestCaseLink.requirement_id, RequirementTestCaseLink.test_case_id)
        # ADR-116: links to soft-deleted cases are left out (ORM hook on TestCase).
        .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
        .where(RequirementTestCaseLink.requirement_id.in_(requirement_ids))
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
        open_defects = [d for d in defects if d.status not in CLOSED_DEFECT_STATUSES]

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
                AuditLog.event_metadata["to"].astext.in_(CLOSED_DEFECT_STATUSES),
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


@cached_report("quality_metrics")
def get_quality_metrics(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    *,
    days: int = 30,
    project_id: UUID | None = None,
    run_type: RunTypeFilter = "Regression",
) -> QualityMetricsReport:
    """ADR-071: BRD section 2.2 success metrics from real data.

    Definitions (also shown in the UI):
    - Step-level defect precision: of defects raised from a test run
      (`test_run_id` set) and created in the period, the share that point at
      an exact step (`test_case_version_step_id` set, or an `execution_step`
      defect link).
    - Cycle time: mean of `finished_at - created_at` over runs of `run_type`
      created in the period that have finished; unfinished runs are excluded
      rather than counted as zero.
    - Pass rate: share of step verdicts recorded in the period that are
      `pass`, matching the Dashboard's step pass-rate definition.
    - Review-gate coverage: share of all current test cases that are
      `approved` (a snapshot, not period-bound).
    Soft-deleted runs/defects are excluded by the ORM-level filter.
    """
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    since = func.now() - func.make_interval(0, 0, 0, days)

    def scope(query: Any, project_col: Any) -> Any:
        if accessible is not None:
            query = query.where(project_col.in_(accessible))
        if project_id is not None:
            query = query.where(project_col == project_id)
        return query

    # (a) step-level defect precision
    step_linked = (Defect.test_case_version_step_id.is_not(None)) | exists().where(
        DefectLink.defect_id == Defect.id, DefectLink.linkable_type == "execution_step"
    )
    defect_query = scope(
        select(func.count(), func.count().filter(step_linked))
        .select_from(Defect)
        .join(Project, Project.id == Defect.project_id)
        .where(
            Project.tenant_id == tenant_id,
            Defect.test_run_id.is_not(None),
            Defect.created_at >= since,
        ),
        Project.id,
    )
    execution_defects, linked_defects = db.execute(defect_query).one()

    # (b) cycle time of finished runs created in the period
    cycle_seconds = func.extract("epoch", TestRun.finished_at - TestRun.created_at)
    cycle_query = (
        select(Project.id, Project.name, func.count(), func.avg(cycle_seconds))
        .select_from(TestRun)
        .join(Project, Project.id == TestRun.project_id)
        .where(
            Project.tenant_id == tenant_id,
            TestRun.finished_at.is_not(None),
            TestRun.created_at >= since,
        )
    )
    if run_type != "all":
        cycle_query = cycle_query.where(TestRun.run_type == run_type)
    cycle_rows = db.execute(
        scope(cycle_query, Project.id).group_by(Project.id, Project.name).order_by(Project.name)
    ).all()
    by_project = [
        CycleTimeByProject(
            project_id=pid,
            project_name=name,
            finished_run_count=count,
            average_cycle_time_hours=round(float(avg) / 3600, 2) if avg is not None else None,
        )
        for pid, name, count, avg in cycle_rows
    ]
    total_runs = sum(r.finished_run_count for r in by_project)
    weighted = sum((r.average_cycle_time_hours or 0.0) * r.finished_run_count for r in by_project)
    average_cycle = round(weighted / total_runs, 2) if total_runs else None

    # (c) pass rate over verdicts recorded in the period
    step_query = _step_query(
        tenant_id, accessible, project_id, ExecutionStep.verdict, func.count()
    ).where(ExecutionStep.closed_at >= since)
    step_counts: dict[str | None, int] = dict(
        db.execute(step_query.group_by(ExecutionStep.verdict)).tuples().all()
    )
    step_total = sum(step_counts.values())

    # (d) review-gate coverage (current state)
    tc_query = scope(
        select(TestCase.status, func.count())
        .join(Project, Project.id == TestCase.project_id)
        .where(Project.tenant_id == tenant_id),
        Project.id,
    )
    tc_counts: dict[str, int] = dict(db.execute(tc_query.group_by(TestCase.status)).tuples().all())
    tc_total = sum(tc_counts.values())
    approved = tc_counts.get("approved", 0)

    def pct(part: int, whole: int) -> float | None:
        return round(part * 100.0 / whole, 1) if whole else None

    return QualityMetricsReport(
        period_days=days,
        project_id=project_id,
        run_type=run_type,
        execution_defect_count=execution_defects,
        step_linked_defect_count=linked_defects,
        step_defect_precision_percentage=pct(linked_defects, execution_defects),
        finished_run_count=total_runs,
        average_cycle_time_hours=average_cycle,
        cycle_time_by_project=by_project,
        step_sample_size=step_total,
        step_pass_percentage=pct(step_counts.get("pass", 0), step_total),
        total_test_cases=tc_total,
        approved_test_cases=approved,
        review_gate_coverage_percentage=pct(approved, tc_total),
    )


# --- Excel exports (ADR-071) ------------------------------------------------


def _quality_metrics_rows(report: QualityMetricsReport) -> list[tuple[str, Any]]:
    def val(v: Any) -> Any:
        return "No data in this period" if v is None else v

    return [
        ("Period (days)", report.period_days),
        ("Run type for cycle time", report.run_type),
        ("Step-level defect precision (%)", val(report.step_defect_precision_percentage)),
        ("  Execution-raised defects", report.execution_defect_count),
        ("  ...of which linked to a step", report.step_linked_defect_count),
        ("Average cycle time (hours)", val(report.average_cycle_time_hours)),
        ("  Finished runs counted", report.finished_run_count),
        ("Step pass rate (%)", val(report.step_pass_percentage)),
        ("  Step verdicts counted", report.step_sample_size),
        ("Review-gate coverage (% Approved)", val(report.review_gate_coverage_percentage)),
        ("  Approved test cases", report.approved_test_cases),
        ("  Total test cases", report.total_test_cases),
    ]


def quality_metrics_sheets(report: QualityMetricsReport) -> list[SheetSpec]:
    return [
        SheetSpec(
            "Quality Metrics",
            ["Metric", "Value"],
            _quality_metrics_rows(report),
            title="QTestHub Quality Metrics",
        ),
        SheetSpec(
            "Cycle Time by Project",
            ["Project", "Finished Runs", "Average Cycle Time (hours)"],
            [
                (r.project_name, r.finished_run_count, r.average_cycle_time_hours)
                for r in report.cycle_time_by_project
            ],
        ),
    ]


def quality_metrics_to_xlsx(report: QualityMetricsReport) -> bytes:
    return build_workbook(quality_metrics_sheets(report))


def aggregate_report_to_xlsx(report: AggregateReport, filters: dict[str, str]) -> bytes:
    values = sorted({r.value for r in report.rows})
    labels: list[str] = []
    matrix: dict[str, dict[str, int]] = {}
    for r in report.rows:
        if r.group_label not in matrix:
            labels.append(r.group_label)
            matrix[r.group_label] = {}
        matrix[r.group_label][r.value] = matrix[r.group_label].get(r.value, 0) + r.count
    pivot_rows = [
        (label, *(matrix[label].get(v, 0) for v in values), sum(matrix[label].values()))
        for label in labels
    ]
    return build_workbook(
        [
            SheetSpec(
                "Report",
                [f"Group ({report.group_by})", *values, "Total"],
                pivot_rows,
                title=f"QTestHub report: {report.metric} by {report.group_by}",
                notes=[(k, v) for k, v in filters.items() if v],
            ),
            SheetSpec(
                "Data",
                ["Group", "Value", "Count"],
                [(r.group_label, r.value, r.count) for r in report.rows],
            ),
        ]
    )


def traceability_matrix_to_xlsx(report: TraceabilityMatrixReport) -> bytes:
    return build_workbook(
        [
            SheetSpec(
                "Traceability",
                [
                    "Requirement",
                    "Linked Test Cases",
                    "Passed",
                    "Failed",
                    "Blocked",
                    "Not Executed",
                    "Coverage %",
                ],
                [
                    (
                        e.requirement_title,
                        e.linked_test_case_count,
                        e.passed_count,
                        e.failed_count,
                        e.blocked_count,
                        e.not_executed_count,
                        e.coverage_percentage,
                    )
                    for e in report.entries
                ],
                title="QTestHub Requirements Traceability Matrix",
                notes=[
                    ("Total requirements", report.total_requirements),
                    ("Overall coverage %", report.overall_requirement_coverage_percentage),
                ],
            )
        ]
    )


def compliance_report_to_xlsx(
    report: ComplianceReport, quality: QualityMetricsReport | None = None
) -> bytes:
    period = (
        f"{report.period_from.isoformat() if report.period_from else 'All time'}"
        f" to {report.period_to.isoformat() if report.period_to else 'present'}"
    )
    sheets = [
        SheetSpec(
            "Compliance Summary",
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
                "Requirements Total",
                "Requirement Coverage %",
                "Defects Open",
                "Defects SLA-Breached",
            ],
            [
                (
                    s.name,
                    s.domain,
                    s.total_test_cases,
                    s.approved_test_cases,
                    s.draft_test_cases,
                    s.ready_for_review_test_cases,
                    s.open_defects,
                    s.critical_defects,
                    s.requirement_covered,
                    s.requirement_total,
                    s.requirement_coverage_percentage,
                    s.defect_aging.total_open,
                    s.defect_aging.total_breached,
                )
                for s in report.projects
            ],
            title="QTestHub Compliance Summary",
            notes=[
                ("Tenant", report.tenant_name),
                ("Generated At (UTC)", report.generated_at),
                (
                    "Reporting Officer",
                    f"{report.reporting_officer_name} ({report.reporting_officer_email})",
                ),
                ("Reporting Period", period),
            ],
        )
    ]
    if report.trend is not None:
        t = report.trend
        sheets.append(
            SheetSpec(
                "Period Trend",
                ["Measure", "Current Period", "Prior Period"],
                [
                    (
                        "Test Cases Created",
                        t.test_cases_created_current,
                        t.test_cases_created_prior,
                    ),
                    ("Defects Opened", t.defects_opened_current, t.defects_opened_prior),
                    ("Defects Closed", t.defects_closed_current, t.defects_closed_prior),
                ],
            )
        )
    if quality is not None:
        sheets.extend(quality_metrics_sheets(quality))
    return build_workbook(sheets)


PRODUCTION_ENV_NAMES = ("production", "prod")


def _pct(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator * 100, 1) if denominator else None


@cached_report("defect_leakage")
def get_defect_leakage(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    *,
    project_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> DefectLeakageReport:
    """ADR-097. A defect has 'escaped' when it is linked (fixed_in_release_id) to a
    release that has shipped (release_date set and not in the future), OR its
    environment (Environment.name, else the legacy free-text column) is 'production'
    or 'prod' (case-insensitive). Releases have no status column, so the date is the
    only 'released' signal."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    if project_id is not None:
        if accessible is not None and project_id not in accessible:
            raise ForbiddenError("Project not accessible")
        _get_project_or_404(db, tenant_id, project_id)

    # ADR-113: grouped in SQL (month / age bucket / release / environment are the
    # only things the report derives from a defect row), so a 100k-defect tenant
    # sends back a few hundred rows instead of every defect.
    age = func.now() - Defect.created_at
    age_bucket = case(
        (age < func.make_interval(0, 0, 0, 7), 0),
        (age < func.make_interval(0, 0, 0, 31), 1),
        else_=2,
    )
    month_expr = func.to_char(Defect.created_at, "YYYY-MM")
    query = (
        select(
            Defect.severity,
            Defect.status,
            month_expr,
            age_bucket,
            Defect.fixed_in_release_id,
            Environment.name,
            Defect.environment,
            func.count(),
        )
        .select_from(Defect)
        .outerjoin(Environment, Environment.id == Defect.environment_id)
        .where(Defect.tenant_id == tenant_id)
    )
    if project_id is not None:
        query = query.where(Defect.project_id == project_id)
    elif accessible is not None:
        query = query.where(Defect.project_id.in_(accessible))
    if date_from is not None:
        start = datetime(date_from.year, date_from.month, date_from.day, tzinfo=UTC)
        query = query.where(Defect.created_at >= start)
    if date_to is not None:
        end = datetime(date_to.year, date_to.month, date_to.day, tzinfo=UTC) + timedelta(days=1)
        query = query.where(Defect.created_at < end)
    rows = db.execute(
        query.group_by(
            Defect.severity,
            Defect.status,
            month_expr,
            age_bucket,
            Defect.fixed_in_release_id,
            Environment.name,
            Defect.environment,
        )
    ).all()

    today = datetime.now(UTC).date()
    rel_query = select(Release.id, Release.name, Release.release_date, Release.project_id).where(
        Release.tenant_id == tenant_id
    )
    if project_id is not None:
        rel_query = rel_query.where(Release.project_id == project_id)
    releases = {r.id: r for r in db.execute(rel_query).all()}

    overall_sev: dict[str, int] = {}
    buckets = LeakageAgeBuckets()
    per_release: dict[UUID | None, dict[str, Any]] = {}
    trend: dict[str, list[int]] = {}
    total = escaped = open_escaped = 0

    for severity, status, month_key, bucket, release_id, env_name, env_text, n in rows:
        rel = releases.get(release_id) if release_id is not None else None
        released = rel is not None and rel.release_date is not None and rel.release_date <= today
        env = (env_name or env_text or "").strip().lower()
        is_escaped = released or env in PRODUCTION_ENV_NAMES
        slot = per_release.setdefault(
            release_id if rel is not None else None,
            {"total": 0, "escaped": 0, "open": 0, "sev": {}},
        )
        month = trend.setdefault(month_key, [0, 0])
        total += n
        slot["total"] += n
        month[0] += n
        if not is_escaped:
            continue
        escaped += n
        slot["escaped"] += n
        month[1] += n
        overall_sev[severity] = overall_sev.get(severity, 0) + n
        slot["sev"][severity] = slot["sev"].get(severity, 0) + n
        if status in OPEN_DEFECT_STATUSES:
            open_escaped += n
            slot["open"] += n
            if bucket == 0:
                buckets.under_7d += n
            elif bucket == 1:
                buckets.d7_to_30 += n
            else:
                buckets.over_30d += n

    release_rows = []
    for rid, slot in per_release.items():
        rel = releases.get(rid) if rid is not None else None
        release_rows.append(
            LeakageReleaseRow(
                release_id=rid,
                release_name=rel.name if rel is not None else "No release",
                project_id=rel.project_id if rel is not None else None,
                release_date=rel.release_date.isoformat() if rel and rel.release_date else None,
                total_defects=slot["total"],
                escaped_defects=slot["escaped"],
                leakage_percentage=_pct(slot["escaped"], slot["total"]),
                detection_effectiveness_percentage=_pct(
                    slot["total"] - slot["escaped"], slot["total"]
                ),
                open_escaped_defects=slot["open"],
                escaped_by_severity=slot["sev"],
            )
        )
    release_rows.sort(key=lambda r: (r.release_id is None, r.release_date or "", r.release_name))

    case_q = (
        select(func.count())
        .select_from(TestCase)
        .where(TestCase.tenant_id == tenant_id, TestCase.quarantined.is_(True))
    )
    if project_id is not None:
        case_q = case_q.where(TestCase.project_id == project_id)
    elif accessible is not None:
        case_q = case_q.where(TestCase.project_id.in_(accessible))
    case_q = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, case_q)
    quarantined_cases = db.execute(case_q).scalar_one()

    return DefectLeakageReport(
        project_id=project_id,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        total_defects=total,
        escaped_defects=escaped,
        leakage_percentage=_pct(escaped, total),
        detection_effectiveness_percentage=_pct(total - escaped, total),
        open_escaped_defects=open_escaped,
        open_escaped_age_buckets=buckets,
        escaped_by_severity=overall_sev,
        quarantined_test_cases=quarantined_cases,
        releases=release_rows,
        trend=[
            LeakageTrendPoint(
                period=p,
                total_defects=v[0],
                escaped_defects=v[1],
                leakage_percentage=_pct(v[1], v[0]),
            )
            for p, v in sorted(trend.items())
        ],
    )


def defect_leakage_to_xlsx(report: DefectLeakageReport) -> bytes:
    def val(v: Any) -> Any:
        return "No defects" if v is None else v

    summary = [
        ("Total defects", report.total_defects),
        ("Escaped defects", report.escaped_defects),
        ("Leakage (%)", val(report.leakage_percentage)),
        ("Detection effectiveness (%)", val(report.detection_effectiveness_percentage)),
        ("Open escaped defects", report.open_escaped_defects),
        ("  Open escaped < 7 days", report.open_escaped_age_buckets.under_7d),
        ("  Open escaped 7-30 days", report.open_escaped_age_buckets.d7_to_30),
        ("  Open escaped > 30 days", report.open_escaped_age_buckets.over_30d),
        ("Quarantined test cases (not counted as passing)", report.quarantined_test_cases),
    ]
    by_release = [
        (
            r.release_name,
            r.release_date or "",
            r.total_defects,
            r.escaped_defects,
            val(r.leakage_percentage),
            val(r.detection_effectiveness_percentage),
            r.open_escaped_defects,
        )
        for r in report.releases
    ]
    return build_workbook(
        [
            SheetSpec(
                "Defect Leakage", ["Metric", "Value"], summary, title="QTestHub Defect Leakage"
            ),
            SheetSpec(
                "By Release",
                [
                    "Release",
                    "Release date",
                    "Total",
                    "Escaped",
                    "Leakage (%)",
                    "Detection effectiveness (%)",
                    "Open escaped",
                ],
                by_release,
            ),
        ]
    )


# --- ADR-123: project dashboard aggregates ------------------------------------------------
# Each is one SQL GROUP BY over one project's rows (never serialising cases), narrowed by the
# caller's project scope and the ADR-093 Tester case scope, and cached per tenant / role / user.

# A run case counts as "executed" for a case's derived status (ADR-116) in these states.
EXECUTED_RUN_CASE_STATUSES = tuple(EXECUTION_STATUS_BY_RUN_CASE_STATUS)
# Overdue = past its due date and not yet executed (blocked / failed work was acted on).
OVERDUE_RUN_CASE_STATUSES = ("pending", "in_progress")
OPEN_RELEASE_STATUSES = ("Planned", "In Progress")
MILESTONE_LIMIT = 10
OVERDUE_LIMIT = 50

_BUCKET_BY_STATUS = {
    "passed": "passed",
    "failed": "failed",
    "blocked": "blocked",
    "ignored": "skipped",
}


def _require_project_scope(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> Project:
    """403 for a project outside a Tester's scope, 404 for an unknown project (like the other
    project-scoped reports); the caller can never aggregate another project."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    if accessible is not None and project_id not in accessible:
        raise ForbiddenError("Project not accessible")
    return _get_project_or_404(db, tenant_id, project_id)


def _percentage(numerator: int, denominator: int) -> float | None:
    return round(100 * numerator / denominator, 1) if denominator else None


def _latest_status_join(tenant_id: UUID, project_id: UUID):
    """`test_cases` LEFT JOIN the lean latest-executed-run-case-per-case (ADR-116), restricted
    to the project's runs. Returns (latest subquery, select-from) for the callers' GROUP BYs."""
    from app.services.test_case_service import _latest_exec_select

    latest = _latest_exec_select(tenant_id, project_id=project_id, lean=True).subquery("latest")
    return latest, TestCase.__table__.outerjoin(latest, latest.c.test_case_id == TestCase.id)


def _status_buckets(rows: list[tuple[str | None, int]]) -> dict[str, int]:
    out = {"passed": 0, "failed": 0, "blocked": 0, "skipped": 0, "not_run": 0}
    for status, n in rows:
        out[_BUCKET_BY_STATUS.get(status or "", "not_run")] += n
    return out


@cached_report("project_test_status")
def get_project_test_status(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> ProjectTestStatus:
    _require_project_scope(db, tenant_id, role_code, user_id, project_id)
    latest, source = _latest_status_join(tenant_id, project_id)
    query = (
        select(latest.c.status, func.count())
        .select_from(source)
        .where(
            TestCase.tenant_id == tenant_id,
            TestCase.project_id == project_id,
            TestCase.deleted_at.is_(None),
        )
        .group_by(latest.c.status)
    )
    query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, query)
    b = _status_buckets([(s, n) for s, n in db.execute(query).all()])
    executed = b["passed"] + b["failed"] + b["blocked"] + b["skipped"]
    total = executed + b["not_run"]
    return ProjectTestStatus(
        project_id=project_id,
        total=total,
        executed=executed,
        passed=b["passed"],
        failed=b["failed"],
        blocked=b["blocked"],
        skipped=b["skipped"],
        not_run=b["not_run"],
        execution_percentage=_percentage(executed, total),
        pass_rate=_percentage(b["passed"], executed),
    )


@cached_report("module_coverage")
def get_module_coverage(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> ModuleCoverageReport:
    _require_project_scope(db, tenant_id, role_code, user_id, project_id)
    latest, source = _latest_status_join(tenant_id, project_id)
    query = (
        select(TestCase.module_id, latest.c.status, func.count())
        .select_from(source)
        .where(
            TestCase.tenant_id == tenant_id,
            TestCase.project_id == project_id,
            TestCase.deleted_at.is_(None),
        )
        .group_by(TestCase.module_id, latest.c.status)
    )
    query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, query)
    per_module: dict[UUID | None, list[tuple[str | None, int]]] = {}
    for module_id, status, n in db.execute(query).all():
        per_module.setdefault(module_id, []).append((status, n))
    names = {
        mid: name
        for mid, name in db.execute(
            select(TestModule.id, TestModule.name).where(
                TestModule.tenant_id == tenant_id, TestModule.project_id == project_id
            )
        ).all()
    }
    rows: list[ModuleCoverageRow] = []
    for module_id, statuses in per_module.items():
        b = _status_buckets(statuses)
        executed = b["passed"] + b["failed"] + b["blocked"] + b["skipped"]
        total = executed + b["not_run"]
        rows.append(
            ModuleCoverageRow(
                module_id=module_id,
                module_name=names.get(module_id, "No module") if module_id else "No module",
                total=total,
                executed=executed,
                passed=b["passed"],
                failed=b["failed"],
                blocked=b["blocked"],
                skipped=b["skipped"],
                not_run=b["not_run"],
                coverage_percentage=_percentage(executed, total),
            )
        )
    # Largest modules first; the unmodulated bucket last on ties.
    rows.sort(key=lambda r: (-r.total, r.module_id is None, r.module_name.lower()))
    return ModuleCoverageReport(project_id=project_id, rows=rows)


@cached_report("tester_performance")
def get_tester_performance(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> TesterPerformanceReport:
    """Per tester: the cases whose latest executed result (ADR-116) they recorded, with the
    pass rate over those, plus the defects they reported in the project. The "executed by"
    here is exactly the Test Cases list's `executed_by` filter, so a row links to a list that
    shows the same number."""
    _require_project_scope(db, tenant_id, role_code, user_id, project_id)
    from app.services.test_case_service import _latest_exec_select

    latest = _latest_exec_select(tenant_id, project_id=project_id, lean=True).subquery("latest")
    step_executor = (
        select(ExecutionStep.executed_by)
        .where(
            ExecutionStep.test_run_case_id == latest.c.run_case_id,
            ExecutionStep.executed_by.is_not(None),
        )
        .order_by(ExecutionStep.closed_at.desc().nulls_last())
        .limit(1)
        .correlate(latest)
        .scalar_subquery()
    )
    executor = func.coalesce(latest.c.executed_by, step_executor)
    query = (
        select(executor.label("executor"), latest.c.status, func.count())
        .select_from(TestCase.__table__.join(latest, latest.c.test_case_id == TestCase.id))
        .where(
            TestCase.tenant_id == tenant_id,
            TestCase.project_id == project_id,
            TestCase.deleted_at.is_(None),
        )
        .group_by(executor, latest.c.status)
    )
    query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, query)
    per_user: dict[UUID | None, list[tuple[str | None, int]]] = {}
    for executor_id, status, n in db.execute(query).all():
        per_user.setdefault(executor_id, []).append((status, n))
    defects: dict[UUID | None, int] = {
        reporter: n
        for reporter, n in db.execute(
            select(Defect.reported_by, func.count())
            .where(Defect.tenant_id == tenant_id, Defect.project_id == project_id)
            .group_by(Defect.reported_by)
        ).all()
    }
    names = _resolve_user_names(db, {u for u in (*per_user, *defects) if u is not None})
    rows: list[TesterPerformanceRow] = []
    for uid in set(per_user) | set(defects):
        b = _status_buckets(per_user.get(uid, []))
        executed = b["passed"] + b["failed"] + b["blocked"] + b["skipped"]
        if not executed and not defects.get(uid):
            continue
        rows.append(
            TesterPerformanceRow(
                user_id=uid,
                user_name=names.get(uid) if uid else None,
                executed=executed,
                passed=b["passed"],
                failed=b["failed"],
                blocked=b["blocked"],
                skipped=b["skipped"],
                pass_rate=_percentage(b["passed"], executed),
                defects_raised=defects.get(uid, 0),
            )
        )
    rows.sort(key=lambda r: (-r.executed, -r.defects_raised, (r.user_name or "").lower()))
    return TesterPerformanceReport(project_id=project_id, rows=rows)


def _today() -> date:
    return datetime.now(UTC).date()


def _overdue_base(tenant_id: UUID, project_id: UUID, today: date):
    return (
        select(TestRunCase.id)
        .select_from(TestRunCase)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(TestCase, TestCase.id == TestRunCase.test_case_id)
        .where(
            TestRunCase.tenant_id == tenant_id,
            TestRun.project_id == project_id,
            TestRun.finished_at.is_(None),
            TestRunCase.due_date.is_not(None),
            TestRunCase.due_date < today,
            TestRunCase.status.in_(OVERDUE_RUN_CASE_STATUSES),
        )
    )


@cached_report("overdue_run_cases")
def get_overdue_run_cases(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> OverdueRunCasesReport:
    """Run cases past their due date and not yet executed, in the project's open runs. The
    same filter backs the Execution Console's `?overdue=1` list, so the totals agree."""
    _require_project_scope(db, tenant_id, role_code, user_id, project_id)
    today = _today()
    base = tester_visibility.scope_case_query(
        db, tenant_id, role_code, user_id, _overdue_base(tenant_id, project_id, today)
    )
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(
        base.with_only_columns(
            TestRunCase.id,
            TestRun.id,
            TestRun.name,
            TestCase.id,
            TestCase.display_id,
            TestCase.title,
            TestRunCase.status,
            TestRunCase.assigned_to,
            TestRunCase.due_date,
        )
        .order_by(TestRunCase.due_date, TestRunCase.id)
        .limit(OVERDUE_LIMIT)
    ).all()
    names = _resolve_user_names(db, {r[7] for r in rows if r[7] is not None})
    items = [
        OverdueRunCaseRow(
            run_case_id=r[0],
            run_id=r[1],
            run_name=r[2],
            test_case_id=r[3],
            test_case_display_id=r[4],
            title=r[5],
            status=r[6],
            assignee_id=r[7],
            assignee_name=names.get(r[7]) if r[7] else None,
            due_date=r[8],
            days_overdue=(today - r[8]).days,
        )
        for r in rows
    ]
    return OverdueRunCasesReport(project_id=project_id, total=total, items=items)


@cached_report("upcoming_milestones")
def get_upcoming_milestones(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> UpcomingMilestonesReport:
    """Releases dated today or later that are not Released / Cancelled, plus the earliest open
    due date of each open run (run cases not yet executed). Soonest first."""
    _require_project_scope(db, tenant_id, role_code, user_id, project_id)
    today = _today()
    items: list[MilestoneRow] = []
    for rid, name, when, status in db.execute(
        select(Release.id, Release.name, Release.release_date, Release.status)
        .where(
            Release.tenant_id == tenant_id,
            Release.project_id == project_id,
            Release.release_date.is_not(None),
            Release.release_date >= today,
            or_(Release.status.is_(None), Release.status.in_(OPEN_RELEASE_STATUSES)),
        )
        .order_by(Release.release_date, Release.id)
        .limit(MILESTONE_LIMIT)
    ).all():
        items.append(
            MilestoneRow(
                kind="release",
                id=rid,
                name=name,
                milestone_date=when,
                days_until=(when - today).days,
                detail=status,
            )
        )
    run_query = (
        select(TestRun.id, TestRun.name, func.min(TestRunCase.due_date), func.count())
        .select_from(TestRunCase)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(TestCase, TestCase.id == TestRunCase.test_case_id)
        .where(
            TestRunCase.tenant_id == tenant_id,
            TestRun.project_id == project_id,
            TestRun.finished_at.is_(None),
            TestRunCase.due_date.is_not(None),
            TestRunCase.due_date >= today,
            TestRunCase.status.in_(OVERDUE_RUN_CASE_STATUSES),
        )
        .group_by(TestRun.id, TestRun.name)
        .order_by(func.min(TestRunCase.due_date), TestRun.id)
        .limit(MILESTONE_LIMIT)
    )
    run_query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, run_query)
    for rid, name, when, n in db.execute(run_query).all():
        items.append(
            MilestoneRow(
                kind="run_due",
                id=rid,
                name=name,
                milestone_date=when,
                days_until=(when - today).days,
                detail=f"{n} open case{'s' if n != 1 else ''} due",
                open_cases=n,
            )
        )
    items.sort(key=lambda m: (m.milestone_date, m.kind, str(m.id)))
    return UpcomingMilestonesReport(project_id=project_id, items=items[:MILESTONE_LIMIT])
