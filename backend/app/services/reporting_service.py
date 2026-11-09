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
    DashboardSummary,
    DefectBacklogSummary,
    DomainDistributionEntry,
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

    tc_query = (
        select(TestCase.status, func.count())
        .join(Project, Project.id == TestCase.project_id)
        .where(Project.tenant_id == tenant_id)
    )
    if accessible is not None:
        tc_query = tc_query.where(Project.id.in_(accessible))
    tc_counts: dict[str, int] = dict(db.execute(tc_query.group_by(TestCase.status)).tuples().all())
    tc_total = sum(tc_counts.values())
    approved_ratio = (tc_counts.get("approved", 0) / tc_total) if tc_total else 0.0

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
        projects=ProjectStatusBreakdown(total=len(projects), by_status=status_counts),
        test_cases=TestCaseSummary(total=tc_total, approved_ratio=approved_ratio),
        test_runs=TestRunSummary(active=active_runs, step_pass_percentage=step_pass_percentage),
        defects=DefectBacklogSummary(open_by_severity=open_by_severity),
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

        entries.append(
            DomainDistributionEntry(
                domain=domain,
                project_count=len(projects),
                test_case_count=tc_total,
                approved_percentage=approved_percentage,
                open_defect_count=open_defect_count,
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
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, metric: Metric, group_by: GroupBy
) -> AggregateReport:
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
            )
            .join(TestRun, TestRun.id == TestRunCase.test_run_id)
            .join(Project, Project.id == TestRun.project_id)
            .where(Project.tenant_id == tenant_id)
        )
    elif metric == "priority":
        base = (
            select(
                TestCase.priority.label("value"),
                TestCase.assignee_id.label("assignee_id"),
                Project.id.label("project_id"),
                Project.name.label("project_name"),
                Project.domain.label("domain"),
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
            )
            .join(Project, Project.id == Defect.project_id)
            .where(Project.tenant_id == tenant_id)
        )
    else:
        raise ValueError(f"Unknown metric: {metric}")  # schema already restricts this

    if accessible is not None:
        base = base.where(Project.id.in_(accessible))

    subq = base.subquery()

    group_cols: list[Any]
    if group_by == "project":
        group_cols = [subq.c.project_id, subq.c.project_name, subq.c.value]
    elif group_by == "domain":
        group_cols = [subq.c.domain, subq.c.value]
    elif group_by == "assignee":
        group_cols = [subq.c.assignee_id, subq.c.value]
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
            project_id, project_name = group_values
            result_rows.append(
                AggregateRow(
                    group_key=str(project_id), group_label=project_name, value=value, count=count
                )
            )
        elif group_by == "domain":
            (domain,) = group_values
            result_rows.append(
                AggregateRow(group_key=None, group_label=domain, value=value, count=count)
            )
        else:
            (assignee_id,) = group_values
            label = (
                names.get(assignee_id, "Unassigned") if assignee_id is not None else "Unassigned"
            )
            result_rows.append(
                AggregateRow(
                    group_key=str(assignee_id) if assignee_id is not None else None,
                    group_label=label,
                    value=value,
                    count=count,
                )
            )

    return AggregateReport(metric=metric, group_by=group_by, rows=result_rows)


def generate_compliance_csv(db: Session, tenant_id: UUID, reporting_officer: User) -> str:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one()
    projects = list(db.execute(select(Project).where(Project.tenant_id == tenant_id)).scalars())

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["QTestHub Compliance Summary"])
    writer.writerow(["Tenant", tenant.name])
    writer.writerow(["Generated At (UTC)", datetime.now(UTC).isoformat()])
    writer.writerow(["Reporting Officer", f"{reporting_officer.name} ({reporting_officer.email})"])
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

    for project in projects:
        tc_counts: dict[str, int] = dict(
            db.execute(
                select(TestCase.status, func.count())
                .where(TestCase.project_id == project.id)
                .group_by(TestCase.status)
            )
            .tuples()
            .all()
        )
        defect_counts: dict[str, int] = dict(
            db.execute(
                select(Defect.severity, func.count())
                .where(Defect.project_id == project.id, Defect.status != "Closed")
                .group_by(Defect.severity)
            )
            .tuples()
            .all()
        )
        writer.writerow(
            [
                project.name,
                project.domain,
                sum(tc_counts.values()),
                tc_counts.get("approved", 0),
                tc_counts.get("draft", 0),
                tc_counts.get("ready_for_review", 0),
                sum(defect_counts.values()),
                defect_counts.get("Critical", 0),
            ]
        )

    return buffer.getvalue()
