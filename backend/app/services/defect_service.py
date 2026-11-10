from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models.audit import AuditLog
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.schemas.defect import (
    DefectCreateRequest,
    DefectHistoryEntryOut,
    DefectLinkCreateRequest,
    DefectLinkOut,
    DefectOut,
    DefectStatus,
    ExecutionEvidenceOut,
    LinkableType,
    LinkType,
    RootCause,
    Severity,
    Verdict,
)
from app.services import notification_service
from app.services.project_service import is_assigned

# ADR-026: strictly sequential, no skipping, no reopening.
STATUS_ORDER: list[DefectStatus] = ["New", "Open", "Fixed", "Verified", "Closed"]

# Phase 6 (PV-6.2): fixed SLA budget in days per severity, not tenant-
# configurable (Phase 22 is where tenant-configurable taxonomies/thresholds
# belong -- this is a simple, additive default, not a full SLA engine).
SLA_DAYS_BY_SEVERITY: dict[str, int] = {
    "Critical": 2,
    "High": 5,
    "Medium": 10,
    "Low": 20,
}


def compute_aging(defect: Defect) -> tuple[int, bool]:
    """Returns (age_days, sla_breached). age_days measures the full
    lifecycle to date: time-to-close for a closed defect, time-still-open
    for an open one. sla_breached flags either case where that duration
    exceeds the severity's budget -- a currently-overdue open defect, or a
    closed one that took longer than budget to resolve."""
    end = defect.closed_at if defect.closed_at is not None else datetime.now(UTC)
    age_days = (end - defect.created_at).days
    threshold = SLA_DAYS_BY_SEVERITY.get(defect.severity, 10)
    return age_days, age_days > threshold


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _assigned_project_ids(db: Session, user_id: UUID) -> set[UUID]:
    from app.models.project import ProjectMember

    return set(
        db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        ).scalars()
    )


def create_defect(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, req: DefectCreateRequest
) -> Defect:
    test_case_id: UUID | None = req.test_case_id
    test_case_version_id: UUID | None = None
    test_run_id: UUID | None = None
    test_case_version_step_id: UUID | None = None
    title = req.title
    expected_result = req.expected_result

    if req.execution_step_id is not None:
        step = db.execute(
            select(ExecutionStep).where(
                ExecutionStep.tenant_id == tenant_id, ExecutionStep.id == req.execution_step_id
            )
        ).scalar_one_or_none()
        if step is None:
            raise NotFoundError("Execution step not found")

        run_case = db.execute(
            select(TestRunCase).where(TestRunCase.id == step.test_run_case_id)
        ).scalar_one()
        run = db.execute(select(TestRun).where(TestRun.id == run_case.test_run_id)).scalar_one()
        version_step = db.execute(
            select(TestCaseVersionStep).where(
                TestCaseVersionStep.id == step.test_case_version_step_id
            )
        ).scalar_one()

        project_id = run.project_id
        test_case_id = run_case.test_case_id
        test_case_version_id = run_case.test_case_version_id
        test_run_id = run.id
        test_case_version_step_id = step.test_case_version_step_id

        if title is None:
            # FR-EXEC-003's auto-suggested title.
            title = f"Step {version_step.step_number} Failed: {version_step.action}"
        if expected_result is None:
            expected_result = version_step.expected
    elif req.test_run_id is not None:
        # In-run, not-step-specific: a general issue about this run.
        run_only = db.execute(
            select(TestRun).where(TestRun.tenant_id == tenant_id, TestRun.id == req.test_run_id)
        ).scalar_one_or_none()
        if run_only is None:
            raise NotFoundError("Test run not found")
        project_id = run_only.project_id
        test_run_id = run_only.id
    else:
        assert req.project_id is not None  # enforced by the schema validator
        project_id = req.project_id

    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    assert title is not None  # enforced by the schema validator for the standalone/in-run path

    defect = Defect(
        tenant_id=tenant_id,
        project_id=project_id,
        test_case_id=test_case_id,
        test_case_version_id=test_case_version_id,
        test_run_id=test_run_id,
        test_case_version_step_id=test_case_version_step_id,
        title=title,
        severity=req.severity,
        description=req.description,
        actual_result=req.actual_result,
        expected_result=expected_result,
        environment=req.environment,
        reported_by=actor_user_id,
    )
    db.add(defect)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.created",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"title": title, "severity": req.severity},
    )
    db.commit()
    return defect


def _get_defect_or_404(db: Session, tenant_id: UUID, defect_id: UUID) -> Defect:
    defect = db.execute(
        select(Defect).where(Defect.tenant_id == tenant_id, Defect.id == defect_id)
    ).scalar_one_or_none()
    if defect is None:
        raise NotFoundError("Defect not found")
    return defect


def get_defect(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, defect_id: UUID
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, user_id)
    return defect


def list_defects(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None,
    status: str | None,
    severity: str | None,
    test_run_id: UUID | None = None,
    reported_by: UUID | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    test_case_id: UUID | None = None,
) -> list[Defect]:
    query = select(Defect).where(Defect.tenant_id == tenant_id)

    if project_id is not None:
        project = _get_project_or_404(db, tenant_id, project_id)
        _require_project_access(db, project, role_code, user_id)
        query = query.where(Defect.project_id == project_id)
    elif role_code == "tester":
        query = query.where(Defect.project_id.in_(_assigned_project_ids(db, user_id)))

    if test_case_id is not None:
        # Reverse navigation (test case -> its defects): visibility is
        # already scoped above by project_id/tester-assignment, this just
        # narrows further to one case.
        query = query.where(Defect.test_case_id == test_case_id)

    if status is not None:
        query = query.where(Defect.status == status)
    if severity is not None:
        query = query.where(Defect.severity == severity)
    if reported_by is not None:
        query = query.where(Defect.reported_by == reported_by)
    if created_from is not None:
        query = query.where(Defect.created_at >= created_from)
    if created_to is not None:
        query = query.where(Defect.created_at <= created_to)
    if test_run_id is not None:
        # GAP-20: lets a client (e.g. the Execution Console) ask "which
        # steps in this specific run already have a defect reported?" in
        # one batched call, scoped to this run so defects from other runs
        # against the same step definition (test_case_version_step_id,
        # which persists across reruns) don't false-positive. Also matches
        # defects *linked* (not originally created from) a step in this
        # run, so "link to existing defect" shows up as reported too.
        run_step_ids = select(ExecutionStep.id).where(
            ExecutionStep.test_run_case_id.in_(
                select(TestRunCase.id).where(TestRunCase.test_run_id == test_run_id)
            )
        )
        linked_defect_ids = select(DefectLink.defect_id).where(
            DefectLink.linkable_type == "execution_step", DefectLink.linkable_id.in_(run_step_ids)
        )
        query = query.where(
            or_(Defect.test_run_id == test_run_id, Defect.id.in_(linked_defect_ids))
        )

    return list(db.execute(query.order_by(Defect.created_at.desc())).scalars())


def update_status(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    new_status: str,
    verification_confirmed: bool = False,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if new_status == "Closed":
        # BRD §3.2: "Update Defect Status to 'Closed': Tester No."
        if role_code not in ("admin", "manager"):
            raise ForbiddenError("Only Admin/Manager can close a defect")
        # Spec: "Closing requires verification confirmation" -- a distinct
        # explicit gesture, not merely that Verified exists earlier in the
        # sequence.
        if not verification_confirmed:
            raise ValidationAppError(
                "Closing a defect requires explicit verification confirmation"
            )

    current_index = STATUS_ORDER.index(cast(DefectStatus, defect.status))
    try:
        target_index = STATUS_ORDER.index(cast(DefectStatus, new_status))
    except ValueError as exc:
        raise ValidationAppError(f"Unknown status: {new_status}") from exc

    if target_index != current_index + 1:
        raise ConflictError(
            f"Cannot transition from '{defect.status}' to '{new_status}'; "
            f"the only valid next status is '{STATUS_ORDER[current_index + 1]}'"
            if current_index + 1 < len(STATUS_ORDER)
            else f"'{defect.status}' is already the final status"
        )

    defect.status = new_status
    if new_status == "Closed":
        defect.closed_at = datetime.now(UTC)
        reporter = db.execute(
            select(User).where(User.id == defect.reported_by)
        ).scalar_one_or_none()
        if reporter is not None:
            notification_service.notify(
                db,
                tenant_id,
                actor_user_id,
                defect.reported_by,
                reporter.email,
                "defect_closed",
                "Your defect was closed",
                f'"{defect.title}" was closed.',
                "defect",
                defect.id,
            )

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.status_changed",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"from": STATUS_ORDER[current_index], "to": new_status},
    )
    db.commit()
    return defect


def update_root_cause(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    root_cause: str | None,
) -> Defect:
    """Classification metadata, not a workflow transition -- same
    project-access check as add_link/update_status, no extra role gate."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    previous = defect.root_cause
    defect.root_cause = root_cause

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.root_cause_set",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"from": previous, "to": root_cause},
    )
    db.commit()
    return defect


def add_link(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    req: DefectLinkCreateRequest,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    link = DefectLink(
        tenant_id=tenant_id,
        defect_id=defect_id,
        linkable_type=req.linkable_type,
        linkable_id=req.linkable_id,
        link_type=req.link_type,
    )
    db.add(link)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.link_added",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "linkable_type": req.linkable_type,
            "linkable_id": str(req.linkable_id),
            "link_type": req.link_type,
        },
    )
    db.commit()
    return defect


def get_defect_history(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, defect_id: UUID
) -> list[DefectHistoryEntryOut]:
    """Status changes and other important updates for this defect (spec H),
    reusing the existing hash-chained audit_logs table filtered by entity
    rather than a separate history table -- defects are never updated
    outside of record_audit_event-covered paths, so audit_logs is already
    complete for this purpose."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, user_id)
    set_tenant_context(db, str(tenant_id))

    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "defect",
            AuditLog.entity_id == defect_id,
        )
        .order_by(AuditLog.created_at.asc())
    ).all()
    return [
        DefectHistoryEntryOut(
            id=log.id,
            action=log.action,
            user_id=log.user_id,
            user_name=user_name,
            event_metadata=log.event_metadata or {},
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def _execution_evidence(db: Session, defect: Defect) -> ExecutionEvidenceOut | None:
    """Resolves the originating execution_steps row for a step-linked
    defect, if one can still be found (defect.test_run_id +
    test_case_id + test_case_version_step_id together pin it uniquely,
    since ExecutionStep has no direct FK back to Defect)."""
    if (
        defect.test_run_id is None
        or defect.test_case_id is None
        or defect.test_case_version_step_id is None
    ):
        return None

    run_case = db.execute(
        select(TestRunCase).where(
            TestRunCase.test_run_id == defect.test_run_id,
            TestRunCase.test_case_id == defect.test_case_id,
        )
    ).scalar_one_or_none()
    if run_case is None:
        return None

    step = db.execute(
        select(ExecutionStep).where(
            ExecutionStep.test_run_case_id == run_case.id,
            ExecutionStep.test_case_version_step_id == defect.test_case_version_step_id,
        )
    ).scalar_one_or_none()
    if step is None:
        return None

    executed_by_name = None
    if step.executed_by is not None:
        executed_by_name = db.execute(
            select(User.name).where(User.id == step.executed_by)
        ).scalar_one_or_none()

    return ExecutionEvidenceOut(
        execution_step_id=step.id,
        test_run_case_id=run_case.id,
        verdict=cast(Verdict, step.verdict) if step.verdict is not None else None,
        opened_at=step.opened_at,
        closed_at=step.closed_at,
        duration_ms=step.duration_ms,
        executed_by=step.executed_by,
        executed_by_name=executed_by_name,
    )


def to_out(db: Session, defect: Defect) -> DefectOut:
    # See ARCHITECTURE_DECISIONS.md ADR-007 addendum.
    set_tenant_context(db, str(defect.tenant_id))

    project = db.execute(select(Project).where(Project.id == defect.project_id)).scalar_one()

    test_case_title: str | None = None
    if defect.test_case_id is not None:
        test_case_title = db.execute(
            select(TestCase.title).where(TestCase.id == defect.test_case_id)
        ).scalar_one()

    test_case_version_number: int | None = None
    if defect.test_case_version_id is not None:
        test_case_version_number = db.execute(
            select(TestCaseVersion.version_number).where(
                TestCaseVersion.id == defect.test_case_version_id
            )
        ).scalar_one()

    test_run_name: str | None = None
    if defect.test_run_id is not None:
        test_run_name = db.execute(
            select(TestRun.name).where(TestRun.id == defect.test_run_id)
        ).scalar_one()

    step_number: int | None = None
    if defect.test_case_version_step_id is not None:
        step_number = db.execute(
            select(TestCaseVersionStep.step_number).where(
                TestCaseVersionStep.id == defect.test_case_version_step_id
            )
        ).scalar_one()

    reported_by_name = db.execute(
        select(User.name).where(User.id == defect.reported_by)
    ).scalar_one_or_none()

    evidence = _execution_evidence(db, defect)
    test_run_case_id = evidence.test_run_case_id if evidence is not None else None

    links = db.execute(select(DefectLink).where(DefectLink.defect_id == defect.id)).scalars()
    age_days, sla_breached = compute_aging(defect)

    return DefectOut(
        id=defect.id,
        project_id=defect.project_id,
        project_name=project.name,
        test_case_id=defect.test_case_id,
        test_case_title=test_case_title,
        test_case_version_id=defect.test_case_version_id,
        test_case_version_number=test_case_version_number,
        test_run_id=defect.test_run_id,
        test_run_name=test_run_name,
        test_run_case_id=test_run_case_id,
        test_case_version_step_id=defect.test_case_version_step_id,
        step_number=step_number,
        title=defect.title,
        severity=cast(Severity, defect.severity),
        status=cast(DefectStatus, defect.status),
        description=defect.description,
        actual_result=defect.actual_result,
        expected_result=defect.expected_result,
        environment=defect.environment,
        root_cause=cast(RootCause, defect.root_cause) if defect.root_cause else None,
        reported_by=defect.reported_by,
        reported_by_name=reported_by_name,
        created_at=defect.created_at,
        closed_at=defect.closed_at,
        age_days=age_days,
        sla_breached=sla_breached,
        links=[
            DefectLinkOut(
                id=link_.id,
                linkable_type=cast(LinkableType, link_.linkable_type),
                linkable_id=link_.linkable_id,
                link_type=cast(LinkType, link_.link_type),
                created_at=link_.created_at,
            )
            for link_ in links
        ],
        execution_evidence=evidence,
    )
