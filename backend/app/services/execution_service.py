from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.schemas.execution import (
    ExecutionStepOut,
    RunCaseContextOut,
    RunCaseStatus,
    RunType,
    TestRunCaseAddRequest,
    TestRunCaseOut,
    TestRunCreateRequest,
    TestRunOut,
    TestRunSummaryOut,
    TestRunUpdateRequest,
    Verdict,
)
from app.services.project_service import is_assigned


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    """ADR-019's pattern: tenant-wide for Admin/Manager, Tester must be assigned."""
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _get_run_or_404(db: Session, tenant_id: UUID, run_id: UUID) -> TestRun:
    run = db.execute(
        select(TestRun).where(TestRun.tenant_id == tenant_id, TestRun.id == run_id)
    ).scalar_one_or_none()
    if run is None:
        raise NotFoundError("Test run not found")
    return run


def _get_run_case_or_404(db: Session, tenant_id: UUID, test_run_case_id: UUID) -> TestRunCase:
    run_case = db.execute(
        select(TestRunCase).where(
            TestRunCase.tenant_id == tenant_id, TestRunCase.id == test_run_case_id
        )
    ).scalar_one_or_none()
    if run_case is None:
        raise NotFoundError("Test run case not found")
    return run_case


def _get_execution_step_or_404(
    db: Session, tenant_id: UUID, execution_step_id: UUID
) -> ExecutionStep:
    step = db.execute(
        select(ExecutionStep).where(
            ExecutionStep.tenant_id == tenant_id, ExecutionStep.id == execution_step_id
        )
    ).scalar_one_or_none()
    if step is None:
        raise NotFoundError("Execution step not found")
    return step


def _authorize_run_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, run: TestRun
) -> None:
    project = _get_project_or_404(db, tenant_id, run.project_id)
    _require_project_access(db, project, role_code, user_id)


def _authorize_run_case_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, run_case: TestRunCase
) -> TestRun:
    run = _get_run_or_404(db, tenant_id, run_case.test_run_id)
    _authorize_run_access(db, tenant_id, role_code, user_id, run)
    return run


def get_execution_step(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, execution_step_id: UUID
) -> ExecutionStep:
    """Phase 7 (attachment wiring, GAP-75): resolves a step through its run
    case to the owning project's visibility rule, the same chain
    open_step/record_verdict already authorize against -- an attachment on
    a step is never more visible than the step itself."""
    step = _get_execution_step_or_404(db, tenant_id, execution_step_id)
    run_case = _get_run_case_or_404(db, tenant_id, step.test_run_case_id)
    _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    return step


def _validate_bundlable_cases(
    db: Session, tenant_id: UUID, project_id: UUID, test_case_ids: list[UUID]
) -> list[TestCase]:
    cases = list(
        db.execute(
            select(TestCase).where(
                TestCase.tenant_id == tenant_id, TestCase.id.in_(test_case_ids)
            )
        ).scalars()
    )
    found_ids = {c.id for c in cases}
    missing = set(test_case_ids) - found_ids
    if missing:
        raise ValidationAppError(f"Unknown test case id(s): {', '.join(str(m) for m in missing)}")

    wrong_project = [c.title for c in cases if c.project_id != project_id]
    if wrong_project:
        raise ValidationAppError(
            f"Test cases must belong to this project: {', '.join(wrong_project)}"
        )

    not_approved = [c.title for c in cases if c.status != "approved"]
    if not_approved:
        # ADR-025: only approved test cases may be bundled into a run.
        raise ConflictError(
            f"Only approved test cases can be added to a run: {', '.join(not_approved)}"
        )
    return cases


def _bundle_case_into_run(
    db: Session, tenant_id: UUID, run_id: UUID, case: TestCase
) -> TestRunCase:
    run_case = TestRunCase(
        tenant_id=tenant_id,
        test_run_id=run_id,
        test_case_id=case.id,
        test_case_version_id=case.current_version_id,
        status="pending",
    )
    db.add(run_case)
    db.flush()

    # ADR-023: pre-create one execution_steps row per pinned step.
    steps = db.execute(
        select(TestCaseVersionStep)
        .where(TestCaseVersionStep.test_case_version_id == case.current_version_id)
        .order_by(TestCaseVersionStep.step_number)
    ).scalars()
    for step in steps:
        db.add(
            ExecutionStep(
                tenant_id=tenant_id,
                test_run_case_id=run_case.id,
                test_case_version_step_id=step.id,
            )
        )
    return run_case


def create_test_run(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: TestRunCreateRequest,
) -> TestRun:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    cases = _validate_bundlable_cases(db, tenant_id, project_id, req.test_case_ids)

    run = TestRun(
        tenant_id=tenant_id,
        project_id=project_id,
        name=req.name,
        run_type=req.run_type,
        executed_by=actor_user_id,
    )
    db.add(run)
    db.flush()

    for case in cases:
        _bundle_case_into_run(db, tenant_id, run.id, case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.created",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"name": run.name, "case_count": len(cases)},
    )
    db.commit()
    return run


def update_test_run(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    run_id: UUID,
    req: TestRunUpdateRequest,
) -> TestRun:
    run = _get_run_or_404(db, tenant_id, run_id)
    _authorize_run_access(db, tenant_id, role_code, actor_user_id, run)
    if run.finished_at is not None:
        raise ConflictError("Cannot edit a finished test run")

    any_started = db.execute(
        select(TestRunCase).where(
            TestRunCase.test_run_id == run.id, TestRunCase.started_at.is_not(None)
        )
    ).first()
    if any_started is not None:
        raise ConflictError("Cannot edit run details after execution has started")

    changes = req.model_dump(exclude_unset=True)
    if "name" in changes:
        run.name = changes["name"]
    if "run_type" in changes:
        run.run_type = changes["run_type"]

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.updated",
        entity_type="test_run",
        entity_id=run.id,
        metadata=changes,
    )
    db.commit()
    return run


def add_test_run_cases(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    run_id: UUID,
    req: TestRunCaseAddRequest,
) -> TestRun:
    run = _get_run_or_404(db, tenant_id, run_id)
    _authorize_run_access(db, tenant_id, role_code, actor_user_id, run)
    if run.finished_at is not None:
        raise ConflictError("Cannot add test cases to a finished test run")

    already_bundled = set(
        db.execute(
            select(TestRunCase.test_case_id).where(TestRunCase.test_run_id == run.id)
        ).scalars()
    )
    duplicate_ids = [str(i) for i in req.test_case_ids if i in already_bundled]
    if duplicate_ids:
        raise ConflictError(f"Test case(s) already in this run: {', '.join(duplicate_ids)}")

    cases = _validate_bundlable_cases(db, tenant_id, run.project_id, req.test_case_ids)
    for case in cases:
        _bundle_case_into_run(db, tenant_id, run.id, case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.cases_added",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"added_count": len(cases)},
    )
    db.commit()
    return run


def remove_test_run_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    run_id: UUID,
    test_run_case_id: UUID,
) -> TestRun:
    run = _get_run_or_404(db, tenant_id, run_id)
    _authorize_run_access(db, tenant_id, role_code, actor_user_id, run)
    if run.finished_at is not None:
        raise ConflictError("Cannot remove test cases from a finished test run")

    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    if run_case.test_run_id != run.id:
        raise NotFoundError("Test run case not found")

    any_opened = db.execute(
        select(ExecutionStep).where(
            ExecutionStep.test_run_case_id == run_case.id, ExecutionStep.opened_at.is_not(None)
        )
    ).first()
    if any_opened is not None:
        raise ConflictError("Cannot remove a test case that already has execution in progress")

    db.query(ExecutionStep).filter(ExecutionStep.test_run_case_id == run_case.id).delete()
    db.delete(run_case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.case_removed",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"test_run_case_id": str(test_run_case_id)},
    )
    db.commit()
    return run


def assign_run_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_run_case_id: UUID,
    assigned_to: UUID | None,
) -> TestRunCase:
    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    run = _authorize_run_case_access(db, tenant_id, role_code, actor_user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot reassign a case on a finished test run")

    if assigned_to is not None:
        user_exists = db.execute(
            select(User).where(User.tenant_id == tenant_id, User.id == assigned_to)
        ).scalar_one_or_none()
        if user_exists is None:
            raise NotFoundError("Assignee not found in this tenant")

    run_case.assigned_to = assigned_to
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testruncase.assigned",
        entity_type="test_run_case",
        entity_id=run_case.id,
        metadata={"assigned_to": str(assigned_to) if assigned_to else None},
    )
    db.commit()
    return run_case


def pause_test_run(db: Session, tenant_id: UUID, actor_user_id: UUID, run_id: UUID) -> TestRun:
    """Caller must already hold testrun.finish (admin/manager only)."""
    run = _get_run_or_404(db, tenant_id, run_id)
    if run.finished_at is not None:
        raise ConflictError("Cannot pause a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is already paused")

    run.paused_at = datetime.now(UTC)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.paused",
        entity_type="test_run",
        entity_id=run.id,
    )
    db.commit()
    return run


def resume_test_run(db: Session, tenant_id: UUID, actor_user_id: UUID, run_id: UUID) -> TestRun:
    """Caller must already hold testrun.finish (admin/manager only)."""
    run = _get_run_or_404(db, tenant_id, run_id)
    if run.paused_at is None:
        raise ConflictError("Test run is not paused")

    run.paused_at = None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.resumed",
        entity_type="test_run",
        entity_id=run.id,
    )
    db.commit()
    return run


def get_test_run(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, run_id: UUID
) -> TestRun:
    run = _get_run_or_404(db, tenant_id, run_id)
    _authorize_run_access(db, tenant_id, role_code, user_id, run)
    return run


def list_test_runs(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> list[TestRunSummaryOut]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)

    runs = list(
        db.execute(
            select(TestRun)
            .where(TestRun.tenant_id == tenant_id, TestRun.project_id == project_id)
            .order_by(TestRun.created_at.desc())
        ).scalars()
    )
    if not runs:
        return []

    run_ids = [r.id for r in runs]
    case_counts: dict[UUID, int] = dict(
        db.execute(
            select(TestRunCase.test_run_id, func.count())
            .where(TestRunCase.test_run_id.in_(run_ids))
            .group_by(TestRunCase.test_run_id)
        )
        .tuples()
        .all()
    )

    return [
        TestRunSummaryOut(
            id=run.id,
            project_id=run.project_id,
            name=run.name,
            run_type=cast(RunType, run.run_type),
            executed_by=run.executed_by,
            created_at=run.created_at,
            finished_at=run.finished_at,
            paused_at=run.paused_at,
            case_count=case_counts.get(run.id, 0),
        )
        for run in runs
    ]


def to_out(db: Session, run: TestRun) -> TestRunOut:
    # See ARCHITECTURE_DECISIONS.md ADR-007 addendum: re-assert tenant
    # context before any fresh RLS-protected query, in case this is called
    # right after a prior commit in the same request.
    set_tenant_context(db, str(run.tenant_id))

    run_cases = list(
        db.execute(select(TestRunCase).where(TestRunCase.test_run_id == run.id)).scalars()
    )
    case_outs: list[TestRunCaseOut] = []
    for run_case in run_cases:
        case = db.execute(select(TestCase).where(TestCase.id == run_case.test_case_id)).scalar_one()
        verdict_counts: dict[str | None, int] = {
            verdict: count
            for verdict, count in db.execute(
                select(ExecutionStep.verdict, func.count())
                .where(ExecutionStep.test_run_case_id == run_case.id)
                .group_by(ExecutionStep.verdict)
            ).all()
        }
        step_count = sum(verdict_counts.values())
        verdict_counts.pop(None, None)
        case_outs.append(
            TestRunCaseOut(
                id=run_case.id,
                test_case_id=run_case.test_case_id,
                test_case_version_id=run_case.test_case_version_id,
                title=case.title,
                status=cast(RunCaseStatus, run_case.status),
                assigned_to=run_case.assigned_to,
                started_at=run_case.started_at,
                completed_at=run_case.completed_at,
                step_count=step_count,
                passed_count=verdict_counts.get("pass", 0),
                failed_count=verdict_counts.get("fail", 0),
                ignored_count=verdict_counts.get("ignore", 0),
            )
        )

    return TestRunOut(
        id=run.id,
        project_id=run.project_id,
        name=run.name,
        run_type=cast(RunType, run.run_type),
        executed_by=run.executed_by,
        created_at=run.created_at,
        finished_at=run.finished_at,
        paused_at=run.paused_at,
        cases=case_outs,
    )


def list_steps_for_run_case(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_run_case_id: UUID
) -> list[ExecutionStepOut]:
    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)

    rows = db.execute(
        select(ExecutionStep, TestCaseVersionStep)
        .join(
            TestCaseVersionStep, TestCaseVersionStep.id == ExecutionStep.test_case_version_step_id
        )
        .where(ExecutionStep.test_run_case_id == test_run_case_id)
        .order_by(TestCaseVersionStep.step_number)
    ).all()
    return [_step_out(es, tcvs) for es, tcvs in rows]


def _step_out(execution_step: ExecutionStep, version_step: TestCaseVersionStep) -> ExecutionStepOut:
    return ExecutionStepOut(
        id=execution_step.id,
        test_case_version_step_id=version_step.id,
        step_number=version_step.step_number,
        action=version_step.action,
        expected=version_step.expected,
        verdict=cast(Verdict, execution_step.verdict)
        if execution_step.verdict is not None
        else None,
        opened_at=execution_step.opened_at,
        closed_at=execution_step.closed_at,
        duration_ms=execution_step.duration_ms,
        executed_by=execution_step.executed_by,
    )


def step_to_out(db: Session, step: ExecutionStep) -> ExecutionStepOut:
    set_tenant_context(db, str(step.tenant_id))
    version_step = db.execute(
        select(TestCaseVersionStep).where(TestCaseVersionStep.id == step.test_case_version_step_id)
    ).scalar_one()
    return _step_out(step, version_step)


def get_run_case_context(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_run_case_id: UUID
) -> RunCaseContextOut:
    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    run = _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    set_tenant_context(db, str(tenant_id))

    project = db.execute(select(Project).where(Project.id == run.project_id)).scalar_one()
    case = db.execute(select(TestCase).where(TestCase.id == run_case.test_case_id)).scalar_one()
    version = db.execute(
        select(TestCaseVersion).where(TestCaseVersion.id == run_case.test_case_version_id)
    ).scalar_one()
    assignee_name = None
    if run_case.assigned_to is not None:
        assignee_name = db.execute(
            select(User.name).where(User.id == run_case.assigned_to)
        ).scalar_one_or_none()

    return RunCaseContextOut(
        run_id=run.id,
        run_name=run.name,
        run_finished=run.finished_at is not None,
        run_paused=run.paused_at is not None,
        project_id=project.id,
        project_name=project.name,
        test_case_id=case.id,
        test_case_title=case.title,
        priority=case.priority,
        version_number=version.version_number,
        assignee_id=run_case.assigned_to,
        assignee_name=assignee_name,
        status=cast(RunCaseStatus, run_case.status),
    )


def open_step(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, execution_step_id: UUID
) -> ExecutionStep:
    step = _get_execution_step_or_404(db, tenant_id, execution_step_id)
    run_case = db.execute(
        select(TestRunCase).where(TestRunCase.id == step.test_run_case_id)
    ).scalar_one()
    run = _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot modify steps on a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is paused")

    if step.opened_at is None:
        step.opened_at = datetime.now(UTC)
        if run_case.started_at is None:
            run_case.started_at = step.opened_at
        if run_case.status == "pending":
            run_case.status = "in_progress"

    db.commit()
    return step


def _recompute_run_case_status(db: Session, run_case: TestRunCase) -> None:
    """ADR-024: recomputed from scratch every time, not tracked incrementally."""
    verdicts = list(
        db.execute(
            select(ExecutionStep.verdict).where(ExecutionStep.test_run_case_id == run_case.id)
        ).scalars()
    )
    if any(v == "fail" for v in verdicts):
        new_status = "failed"
    elif all(v is not None for v in verdicts):
        new_status = "passed"
    elif any(v is not None for v in verdicts):
        new_status = "in_progress"
    else:
        new_status = "pending"

    run_case.status = new_status
    run_case.completed_at = datetime.now(UTC) if new_status in ("passed", "failed") else None


def record_verdict(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    execution_step_id: UUID,
    verdict: str,
) -> ExecutionStep:
    step = _get_execution_step_or_404(db, tenant_id, execution_step_id)
    run_case = db.execute(
        select(TestRunCase).where(TestRunCase.id == step.test_run_case_id)
    ).scalar_one()
    run = _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot modify steps on a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is paused")

    # Row-locked: concurrent verdicts on sibling steps of the same run_case
    # must serialize around the status recompute below. Without this, two
    # transactions can each read the verdicts list before the other's
    # commit, and whichever commits last silently overwrites the correct
    # status with one computed from a stale read (found by a concurrency
    # test, not a reproduced production incident).
    db.execute(
        select(TestRunCase).where(TestRunCase.id == run_case.id).with_for_update()
    ).scalar_one()

    now = datetime.now(UTC)
    if step.opened_at is None:
        # Tolerate a verdict submitted without a prior /open call.
        step.opened_at = now
    step.closed_at = now
    step.duration_ms = int((step.closed_at - step.opened_at).total_seconds() * 1000)
    step.verdict = verdict
    step.executed_by = user_id

    if run_case.started_at is None:
        run_case.started_at = now

    # SessionLocal uses autoflush=False (app/core/db.py), so the SELECT
    # inside _recompute_run_case_status would otherwise read the step's
    # pre-update verdict from the database, not the value just assigned
    # above in memory -- flush first so the recompute sees it.
    db.flush()
    _recompute_run_case_status(db, run_case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="executionstep.verdict_recorded",
        entity_type="execution_step",
        entity_id=step.id,
        metadata={
            "verdict": verdict,
            "test_run_case_id": str(run_case.id),
            "duration_ms": step.duration_ms,
        },
    )
    db.commit()
    return step


def finish_test_run(db: Session, tenant_id: UUID, actor_user_id: UUID, run_id: UUID) -> TestRun:
    run = _get_run_or_404(db, tenant_id, run_id)
    if run.finished_at is not None:
        raise ConflictError("Test run is already finished")

    run.finished_at = datetime.now(UTC)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.finished",
        entity_type="test_run",
        entity_id=run.id,
    )
    db.commit()
    return run
