from datetime import UTC, date, datetime, timedelta
from typing import cast
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.config import get_settings
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.text_sanitize import sanitize_markdown
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_data_set import TestDataSetRow
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
from app.services import notification_service, run_context
from app.services.project_service import is_assigned

settings = get_settings()


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


def _require_execution_rights(role_code: str, user_id: UUID, run_case: TestRunCase) -> None:
    """ADR-059: strict assignee-based execution. A role without tenant-wide
    project access (today's Tester, or a custom role lacking
    `project.view.all`) may only execute -- open a step or record a
    verdict on -- a run case explicitly assigned to them. Unlike the
    read-only visibility check in `_authorize_run_case_access`, there is no
    unassigned-run-case fallback: an unassigned run case is simply not
    executable by such a role until an Admin/Manager assigns one. Full-
    access roles are unaffected."""
    if role_code in ("admin", "manager"):
        return
    if run_case.assigned_to == user_id:
        return
    raise ForbiddenError(
        "This test case is not assigned to you. Ask an Admin or Manager to assign it "
        "before you can execute it."
    )


# ADR-070: a run finishes itself once every run case is complete: either
# blocked (it needs outside action, not further testing in this run) or with a
# verdict recorded on every one of its steps (pass, fail or ignore).


def _require_not_blocked(run_case: TestRunCase) -> None:
    if run_case.status == "blocked":
        raise ConflictError("This test case is blocked. Unblock it before recording results on it.")


def _finish_run(
    db: Session,
    tenant_id: UUID,
    run: TestRun,
    actor_user_id: UUID | None,
    *,
    auto: bool,
    service_token_id: UUID | None = None,
) -> None:
    """Shared by the manual Finish Run endpoint and auto-finish: stamps
    finished_at, writes the audit event and notifies the run owner. Does NOT
    commit -- the caller owns the transaction."""
    run.finished_at = datetime.now(UTC)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        service_token_id=service_token_id,
        action="testrun.finished",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"auto": True} if auto else None,
    )

    owner = db.execute(select(User).where(User.id == run.executed_by)).scalar_one_or_none()
    if owner is not None:
        notification_service.notify(
            db,
            tenant_id,
            actor_user_id,
            run.executed_by,
            owner.email,
            "test_run_completed",
            "A test run you own has finished",
            f'Test run "{run.name}" is complete.',
            "test_run",
            run.id,
        )


def _auto_finish_if_complete(
    db: Session,
    tenant_id: UUID,
    run_id: UUID,
    actor_user_id: UUID | None,
    service_token_id: UUID | None = None,
) -> bool:
    """Rule B (ADR-070): finish the run when every run case is complete
    (blocked, or every step recorded and not failed). Idempotent (never
    finishes twice) and race-safe: the run row is locked so two final
    verdicts landing concurrently on different cases serialize -- the
    second one sees the first's committed result and does the finish;
    without the lock both could see the other's case as still open and the
    run would never auto-finish. Paused runs never auto-finish (nothing can
    be recorded while paused anyway)."""
    # autoflush is off (app/core/db.py): flush so the status counts below see
    # the verdict/status change made earlier in this same transaction.
    db.flush()
    locked = db.execute(
        select(TestRun)
        .where(TestRun.tenant_id == tenant_id, TestRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if locked is None or locked.finished_at is not None or locked.paused_at is not None:
        return False
    total_cases = db.execute(
        select(func.count()).select_from(TestRunCase).where(TestRunCase.test_run_id == run_id)
    ).scalar_one()
    if total_cases == 0:
        return False
    # A case is complete when it is blocked, or when every one of its steps
    # has a verdict AND it did not fail. A failed case keeps the run open on
    # purpose: BRD Journey 4 has the tester re-run the failed step after the
    # fix in the same run (and a case with one failed step is already 'failed'
    # under ADR-024's fail-fast rollup while its other steps are still to be
    # executed). Once the step is re-verdicted to Pass the case passes and the
    # run finishes; a run that is left with a failed case is finished by hand.
    has_unrecorded_step = (
        select(ExecutionStep.id)
        .where(ExecutionStep.test_run_case_id == TestRunCase.id, ExecutionStep.verdict.is_(None))
        .exists()
    )
    open_cases = db.execute(
        select(func.count())
        .select_from(TestRunCase)
        .where(
            TestRunCase.test_run_id == run_id,
            TestRunCase.status != "blocked",
            or_(has_unrecorded_step, TestRunCase.status == "failed"),
        )
    ).scalar_one()
    if open_cases:
        return False
    _finish_run(db, tenant_id, locked, actor_user_id, auto=True, service_token_id=service_token_id)
    return True


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
            select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id.in_(test_case_ids))
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
    db: Session,
    tenant_id: UUID,
    run_id: UUID,
    case: TestCase,
    test_data_row_id: UUID | None = None,
    due_date: date | None = None,
) -> TestRunCase:
    run_case = TestRunCase(
        tenant_id=tenant_id,
        test_run_id=run_id,
        test_case_id=case.id,
        test_case_version_id=case.current_version_id,
        test_data_row_id=test_data_row_id,
        status="pending",
        due_date=due_date,
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
    excluded_quarantined = 0
    if req.exclude_quarantined:
        kept = [c for c in cases if not c.quarantined]
        excluded_quarantined = len(cases) - len(kept)
        cases = kept
        if not cases:
            raise ValidationAppError("Every selected test case is quarantined")

    context = run_context.resolve(
        db,
        tenant_id,
        project_id,
        run_context.RunContext(req.environment_id, req.build_id, req.release_id),
        must_be_complete=run_context.required(db, tenant_id),
    )
    run = TestRun(
        tenant_id=tenant_id,
        project_id=project_id,
        name=req.name,
        run_type=req.run_type,
        executed_by=actor_user_id,
        environment_id=context.environment_id,
        build_id=context.build_id,
        release_id=context.release_id,
    )
    db.add(run)
    db.flush()

    for case in cases:
        _bundle_case_into_run(db, tenant_id, run.id, case, due_date=req.due_date)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.created",
        entity_type="test_run",
        entity_id=run.id,
        metadata={
            "name": run.name,
            "case_count": len(cases),
            "excluded_quarantined": excluded_quarantined,
            "environment_id": str(context.environment_id) if context.environment_id else None,
            "build_id": str(context.build_id) if context.build_id else None,
            "release_id": str(context.release_id) if context.release_id else None,
            **({"due_date": req.due_date.isoformat()} if req.due_date else {}),
        },
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

    changes = req.model_dump(exclude_unset=True)
    context_keys = ("environment_id", "build_id", "release_id")
    wording = {k: v for k, v in changes.items() if k not in context_keys}
    if wording:
        any_started = db.execute(
            select(TestRunCase).where(
                TestRunCase.test_run_id == run.id, TestRunCase.started_at.is_not(None)
            )
        ).first()
        if any_started is not None:
            raise ConflictError("Cannot edit run details after execution has started")

    if "name" in changes:
        run.name = changes["name"]
    if "run_type" in changes:
        run.run_type = changes["run_type"]
    # What the run is run against can be recorded, or corrected, until it is finished.
    if any(key in changes for key in context_keys):
        merged = {key: changes.get(key, getattr(run, key)) for key in context_keys}
        if "build_id" in changes and "release_id" not in changes:
            merged["release_id"] = None  # follows the new build's release, if it has one
        context = run_context.resolve(
            db,
            tenant_id,
            run.project_id,
            run_context.RunContext(**merged),
            must_be_complete=run_context.required(db, tenant_id)
            and any(changes.get(key, 1) is None for key in ("environment_id", "build_id")),
        )
        run.environment_id = context.environment_id
        run.build_id = context.build_id
        run.release_id = context.release_id
        changes = {
            **wording,
            **{key: str(merged[key]) if merged[key] else None for key in context_keys},
        }

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

    # Pass 5 item 2: duplicates are now checked per (test_case_id,
    # test_data_row_id) pair, not just per test_case_id -- the same case
    # can legitimately appear more than once in a run if each appearance
    # is driven by a different data row.
    already_bundled = set(
        db.execute(
            select(TestRunCase.test_case_id, TestRunCase.test_data_row_id).where(
                TestRunCase.test_run_id == run.id
            )
        ).all()
    )

    cases = _validate_bundlable_cases(db, tenant_id, run.project_id, req.test_case_ids)
    if req.exclude_quarantined:
        cases = [c for c in cases if not c.quarantined]
    cases_by_id = {c.id: c for c in cases}

    to_bundle: list[tuple[TestCase, UUID | None]] = []
    duplicates: list[str] = []
    for case_id in req.test_case_ids:
        if case_id not in cases_by_id:
            continue  # excluded as quarantined
        selected = req.data_row_ids.get(case_id)
        row_ids: list[UUID | None] = list(selected) if selected else [None]
        for row_id in row_ids:
            if (case_id, row_id) in already_bundled:
                duplicates.append(f"{case_id}" + (f" (row {row_id})" if row_id else ""))
                continue
            to_bundle.append((cases_by_id[case_id], row_id))

    if duplicates:
        raise ConflictError(f"Test case(s) already in this run: {', '.join(duplicates)}")

    if any(row_id is not None for _, row_id in to_bundle):
        valid_row_ids = {
            r
            for (r,) in db.execute(
                select(TestDataSetRow.id).where(TestDataSetRow.tenant_id == tenant_id)
            )
        }
        bad_rows = [str(r) for _, r in to_bundle if r is not None and r not in valid_row_ids]
        if bad_rows:
            raise ValidationAppError(f"Unknown data row id(s): {', '.join(bad_rows)}")

    for case, row_id in to_bundle:
        _bundle_case_into_run(
            db, tenant_id, run.id, case, test_data_row_id=row_id, due_date=req.due_date
        )

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.cases_added",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"added_count": len(to_bundle)},
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
    *,
    update_assignee: bool = True,
    due_date: date | None = None,
    update_due_date: bool = False,
) -> TestRunCase:
    """ADR-123: assignee and due date are updated independently (`update_assignee`,
    `update_due_date`); a plain call still just (re)assigns."""
    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    run = _authorize_run_case_access(db, tenant_id, role_code, actor_user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot reassign a case on a finished test run")

    if not update_assignee:
        assigned_to = run_case.assigned_to
    if update_due_date:
        run_case.due_date = due_date

    if update_assignee and assigned_to is not None:
        user_exists = db.execute(
            select(User).where(User.tenant_id == tenant_id, User.id == assigned_to)
        ).scalar_one_or_none()
        if user_exists is None:
            raise NotFoundError("Assignee not found in this tenant")

    if update_assignee:
        run_case.assigned_to = assigned_to
    metadata: dict[str, str | None] = {"assigned_to": str(assigned_to) if assigned_to else None}
    if update_due_date:
        metadata["due_date"] = due_date.isoformat() if due_date else None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testruncase.assigned",
        entity_type="test_run_case",
        entity_id=run_case.id,
        metadata=metadata,
    )

    if update_assignee and assigned_to is not None:
        case = db.execute(
            select(TestCase)
            .where(TestCase.id == run_case.test_case_id)
            .execution_options(include_deleted=True)
        ).scalar_one()
        assignee = db.execute(select(User).where(User.id == assigned_to)).scalar_one_or_none()
        if assignee is not None:
            notification_service.notify(
                db,
                tenant_id,
                actor_user_id,
                assigned_to,
                assignee.email,
                "run_case_assigned",
                "A test case execution was assigned to you",
                f'"{case.title}" in run "{run.name}" was assigned to you to execute.',
                "test_run",
                run.id,
            )

    db.commit()
    return run_case


def bulk_assign_run_cases(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    run_id: UUID,
    run_case_ids: list[UUID],
    assigned_to: UUID | None,
    *,
    update_assignee: bool,
    due_date: date | None,
    update_due_date: bool,
) -> int:
    """ADR-154: assignee and/or due date for many cases of one run, all or nothing."""
    run = _get_run_or_404(db, tenant_id, run_id)
    _authorize_run_access(db, tenant_id, role_code, actor_user_id, run)
    if run.finished_at is not None:
        raise ConflictError("Cannot reassign cases on a finished test run")
    wanted = list(dict.fromkeys(run_case_ids))
    cases = list(
        db.execute(
            select(TestRunCase).where(TestRunCase.test_run_id == run.id, TestRunCase.id.in_(wanted))
        ).scalars()
    )
    if len(cases) != len(wanted):
        raise ValidationAppError(
            "Some of those cases are not part of this run",
            fields={"test_run_case_ids": "Some of those cases are not part of this run"},
        )
    assignee: User | None = None
    if update_assignee and assigned_to is not None:
        assignee = db.execute(
            select(User).where(User.tenant_id == tenant_id, User.id == assigned_to)
        ).scalar_one_or_none()
        if assignee is None:
            raise NotFoundError("Assignee not found in this tenant")
    for run_case in cases:
        if update_assignee:
            run_case.assigned_to = assigned_to
        if update_due_date:
            run_case.due_date = due_date
    metadata: dict[str, object] = {"case_count": len(cases)}
    if update_assignee:
        metadata["assigned_to"] = str(assigned_to) if assigned_to else None
    if update_due_date:
        metadata["due_date"] = due_date.isoformat() if due_date else None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.cases_bulk_assigned",
        entity_type="test_run",
        entity_id=run.id,
        metadata=metadata,
    )
    if assignee is not None:
        # One message, not one per case.
        notification_service.notify(
            db,
            tenant_id,
            actor_user_id,
            assignee.id,
            assignee.email,
            "run_case_assigned",
            "Test case executions were assigned to you",
            f'{len(cases)} test case(s) in run "{run.name}" were assigned to you to execute.',
            "test_run",
            run.id,
        )
    db.commit()
    return len(cases)


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


def _run_summaries(db: Session, runs: list[TestRun]) -> list[TestRunSummaryOut]:
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
    names = run_context.names_for(db, runs)
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
            **names.of(run),  # type: ignore[arg-type]
        )
        for run in runs
    ]


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
    return _run_summaries(db, runs)


RUN_DEFAULT_PAGE_SIZE = 50
RUN_MAX_PAGE_SIZE = 100


def list_test_runs_all_projects(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    *,
    project_id: UUID | None = None,
    active_only: bool = False,
    status: str | None = None,
    search: str | None = None,
    run_type: str | None = None,
    page: int = 1,
    page_size: int = RUN_DEFAULT_PAGE_SIZE,
) -> tuple[list[TestRunSummaryOut], int]:
    """ADR-078: one page of runs across every project the caller may see, newest first,
    plus how many match in all. The Test Runs overview used to ask each project for
    all of its runs and page the merge in the browser.

    Visibility is `_require_project_access`'s rule as a filter: Admin and Manager see
    every project in the tenant; anyone else only projects they own or belong to.
    With `project_id`, that project is checked exactly as the per-project list does."""
    query = select(TestRun).where(TestRun.tenant_id == tenant_id)
    if project_id is not None:
        project = _get_project_or_404(db, tenant_id, project_id)
        _require_project_access(db, project, role_code, user_id)
        query = query.where(TestRun.project_id == project_id)
    elif role_code not in ("admin", "manager"):
        owned = select(Project.id).where(
            Project.tenant_id == tenant_id, Project.owner_id == user_id
        )
        member_of = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        query = query.where(or_(TestRun.project_id.in_(owned), TestRun.project_id.in_(member_of)))
    if active_only:
        query = query.where(TestRun.finished_at.is_(None))
    if run_type:
        query = query.where(TestRun.run_type == run_type)
    if search:
        # ILIKE with an escaped needle (not `icontains`, which renders lower(name) LIKE)
        # so the pg_trgm GIN index on test_runs.name can serve it (ADR-113).
        needle = search.strip().replace("/", "//").replace("%", "/%").replace("_", "/_")
        query = query.where(TestRun.name.ilike(f"%{needle}%", escape="/"))
    # Status tabs on the Test Runs list: in_progress (not finished, not paused), paused, finished.
    if status == "finished":
        query = query.where(TestRun.finished_at.is_not(None))
    elif status == "paused":
        query = query.where(TestRun.finished_at.is_(None), TestRun.paused_at.is_not(None))
    elif status == "in_progress":
        query = query.where(TestRun.finished_at.is_(None), TestRun.paused_at.is_(None))

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    page_size = min(max(page_size, 1), RUN_MAX_PAGE_SIZE)
    page = max(page, 1)
    runs = list(
        db.execute(
            query.order_by(TestRun.created_at.desc(), TestRun.id)
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).scalars()
    )
    return _run_summaries(db, runs), total


def to_out(db: Session, run: TestRun) -> TestRunOut:
    # See ARCHITECTURE_DECISIONS.md ADR-007 addendum: re-assert tenant
    # context before any fresh RLS-protected query, in case this is called
    # right after a prior commit in the same request.
    set_tenant_context(db, str(run.tenant_id))

    run_cases = list(
        db.execute(select(TestRunCase).where(TestRunCase.test_run_id == run.id)).scalars()
    )
    # ADR-113: titles and per-case verdict counts for the whole run in two queries
    # (a run can hold thousands of cases; this used to be two queries per case).
    titles = {
        case_id: title
        for case_id, title in db.execute(
            select(TestCase.id, TestCase.title)
            .where(TestCase.id.in_([rc.test_case_id for rc in run_cases]))
            # ADR-116: a soft-deleted case still names its past run cases.
            .execution_options(include_deleted=True)
        )
    }
    verdicts_by_case: dict[UUID, dict[str | None, int]] = {}
    for run_case_id, verdict, count in db.execute(
        select(ExecutionStep.test_run_case_id, ExecutionStep.verdict, func.count())
        .where(ExecutionStep.test_run_case_id.in_([rc.id for rc in run_cases]))
        .group_by(ExecutionStep.test_run_case_id, ExecutionStep.verdict)
    ):
        verdicts_by_case.setdefault(run_case_id, {})[verdict] = count
    case_outs: list[TestRunCaseOut] = []
    for run_case in run_cases:
        verdict_counts = verdicts_by_case.get(run_case.id, {})
        step_count = sum(verdict_counts.values())
        verdict_counts.pop(None, None)
        case_outs.append(
            TestRunCaseOut(
                id=run_case.id,
                test_case_id=run_case.test_case_id,
                test_case_version_id=run_case.test_case_version_id,
                title=titles[run_case.test_case_id],
                status=cast(RunCaseStatus, run_case.status),
                blocked_reason=run_case.blocked_reason,
                assigned_to=run_case.assigned_to,
                due_date=run_case.due_date,
                started_at=run_case.started_at,
                completed_at=run_case.completed_at,
                step_count=step_count,
                passed_count=verdict_counts.get("pass", 0),
                failed_count=verdict_counts.get("fail", 0),
                ignored_count=verdict_counts.get("ignore", 0),
                actual_result=run_case.actual_result,
                executed_by=run_case.executed_by,
                executed_at=run_case.executed_at,
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
        original_run_id=run.original_run_id,
        cases=case_outs,
        **run_context.names_for(db, [run]).of(run),  # type: ignore[arg-type]
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
        actual_result=execution_step.actual_result,
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
    case = db.execute(
        select(TestCase)
        .where(TestCase.id == run_case.test_case_id)
        .execution_options(include_deleted=True)
    ).scalar_one()
    version = db.execute(
        select(TestCaseVersion).where(TestCaseVersion.id == run_case.test_case_version_id)
    ).scalar_one()
    assignee_name = None
    if run_case.assigned_to is not None:
        assignee_name = db.execute(
            select(User.name).where(User.id == run_case.assigned_to)
        ).scalar_one_or_none()

    data_row_name = None
    data_row_values = None
    if run_case.test_data_row_id is not None:
        row = db.execute(
            select(TestDataSetRow).where(TestDataSetRow.id == run_case.test_data_row_id)
        ).scalar_one_or_none()
        if row is not None:
            data_row_name = row.name
            data_row_values = row.data

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
        due_date=run_case.due_date,
        status=cast(RunCaseStatus, run_case.status),
        blocked_reason=run_case.blocked_reason,
        data_row_id=run_case.test_data_row_id,
        data_row_name=data_row_name,
        data_row_values=data_row_values,
    )


def open_step(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, execution_step_id: UUID
) -> ExecutionStep:
    step = _get_execution_step_or_404(db, tenant_id, execution_step_id)
    run_case = db.execute(
        select(TestRunCase).where(TestRunCase.id == step.test_run_case_id)
    ).scalar_one()
    run = _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    _require_execution_rights(role_code, user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot modify steps on a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is paused")
    _require_not_blocked(run_case)

    if step.opened_at is None:
        step.opened_at = datetime.now(UTC)
        if run_case.started_at is None:
            run_case.started_at = step.opened_at
        if run_case.status == "pending":
            run_case.status = "in_progress"

    db.commit()
    return step


def _recompute_run_case_status(
    db: Session,
    run_case: TestRunCase,
    *,
    executed_by: UUID | None = None,
    record_execution: bool = False,
) -> None:
    """ADR-024: recomputed from scratch every time, not tracked incrementally.

    ADR-116: with `record_execution`, a case that lands on a final status (passed or
    failed) is stamped with who executed it and when; the previous values live on in
    the audit trail (from/to). A case that is not final keeps whatever it had."""
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
    if record_execution and new_status in ("passed", "failed"):
        run_case.executed_by = executed_by
        run_case.executed_at = run_case.completed_at


def record_verdict(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    execution_step_id: UUID,
    verdict: str,
    actual_result: str | None = None,
) -> ExecutionStep:
    """Record a step verdict (and, ADR-116, the actual result).

    `actual_result` is optional for pass and ignore. For `fail` it is required when
    the REQUIRE_ACTUAL_RESULT_ON_FAIL setting is on (blocking a case already needs a
    reason). The executor and the execution date are stamped on the run case when the
    case reaches a final status. Re-recording a verdict while the run is open replaces
    the step's current verdict, but the audit event carries the previous and new values
    (verdict, actual result, status), so no earlier result is lost. The test case
    definition is never touched."""
    clean_actual = sanitize_markdown(actual_result) if actual_result is not None else None
    if verdict == "fail" and settings.require_actual_result_on_fail and not clean_actual:
        raise ValidationAppError(
            "An actual result is required when a step fails",
            fields={"actual_result": "Actual result is required when a step fails"},
        )
    step = _get_execution_step_or_404(db, tenant_id, execution_step_id)
    run_case = db.execute(
        select(TestRunCase).where(TestRunCase.id == step.test_run_case_id)
    ).scalar_one()
    run = _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    _require_execution_rights(role_code, user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot modify steps on a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is paused")
    _require_not_blocked(run_case)

    # Row-locked: concurrent verdicts on sibling steps of the same run_case
    # must serialize around the status recompute below. Without this, two
    # transactions can each read the verdicts list before the other's
    # commit, and whichever commits last silently overwrites the correct
    # status with one computed from a stale read (found by a concurrency
    # test, not a reproduced production incident).
    db.execute(
        select(TestRunCase).where(TestRunCase.id == run_case.id).with_for_update()
    ).scalar_one()

    before = {
        "verdict": step.verdict,
        "actual_result": step.actual_result,
        "run_case_status": run_case.status,
    }
    now = datetime.now(UTC)
    if step.opened_at is None:
        # Tolerate a verdict submitted without a prior /open call.
        step.opened_at = now
    step.closed_at = now
    step.duration_ms = int((step.closed_at - step.opened_at).total_seconds() * 1000)
    step.verdict = verdict
    step.executed_by = user_id
    if clean_actual is not None:
        step.actual_result = clean_actual or None

    if run_case.started_at is None:
        run_case.started_at = now

    # SessionLocal uses autoflush=False (app/core/db.py), so the SELECT
    # inside _recompute_run_case_status would otherwise read the step's
    # pre-update verdict from the database, not the value just assigned
    # above in memory -- flush first so the recompute sees it.
    db.flush()
    _recompute_run_case_status(db, run_case, executed_by=user_id, record_execution=True)
    # The run case carries the actual result of the execution: the latest failed
    # step's text for a failed case, otherwise the latest text supplied.
    if run_case.status == "failed":
        failed_text = db.execute(
            select(ExecutionStep.actual_result)
            .where(
                ExecutionStep.test_run_case_id == run_case.id,
                ExecutionStep.verdict == "fail",
                ExecutionStep.actual_result.is_not(None),
            )
            .order_by(ExecutionStep.closed_at.desc().nulls_last())
            .limit(1)
        ).scalar_one_or_none()
        if failed_text:
            run_case.actual_result = failed_text
    elif clean_actual:
        run_case.actual_result = clean_actual
    after = {
        "verdict": step.verdict,
        "actual_result": step.actual_result,
        "run_case_status": run_case.status,
    }

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
            "changes": audit_diff(before, after),
        },
    )
    _auto_finish_if_complete(db, tenant_id, run.id, user_id)
    db.commit()
    return step


# -- CI/CD result ingestion (ADR-059, PV-5/GAP-73) -----------------------
#
# A service token is not a `users` row -- there is no role_code/user_id to
# authorize against here. The token's own tenant+scope binding (checked by
# app/core/service_token_auth.py before this function is ever called) IS
# the authorization; this intentionally does NOT call
# _authorize_run_case_access, which assumes a human actor.
#
# CI tools report one pass/fail/skip per TEST, not per STEP -- there is no
# meaningful way for an external CI job to know this app's internal
# per-step granularity. The documented, deliberate simplification: a CI
# result applies the SAME verdict to every one of that run case's
# not-yet-verdicted steps in one pass, reusing the exact same
# row-locked-recompute logic record_verdict already uses so the status
# rollup stays correct and race-safe under concurrent webhook deliveries.
_CI_STATUS_TO_VERDICT = {"passed": "pass", "failed": "fail", "skipped": "ignore"}


def record_ci_result(
    db: Session,
    tenant_id: UUID,
    test_run_case_id: UUID,
    ci_status: str,
    service_token_id: UUID,
    *,
    environment: str | None = None,
    build: str | None = None,
) -> TestRunCase:
    # Re-assert tenant context: this project's recurring bug class (the RLS
    # GUC resets on COMMIT, not just ROLLBACK) -- the auth dependency's own
    # authenticate() call commits (to persist last_used_at) before this
    # function ever runs, clearing app.current_tenant for any subsequent
    # query on this same session/transaction.
    set_tenant_context(db, str(tenant_id))
    verdict = _CI_STATUS_TO_VERDICT[ci_status]
    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    run = _get_run_or_404(db, tenant_id, run_case.test_run_id)
    if run.finished_at is not None:
        raise ConflictError("Cannot record results on a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is paused")
    _require_not_blocked(run_case)
    run_context.apply_ci_context(
        db, tenant_id, run, environment, build, service_token_id=service_token_id
    )

    # Same row lock record_verdict takes (GAP-49) -- concurrent webhook
    # deliveries for sibling steps of the same run case must serialize
    # around the status recompute below, for the identical reason.
    db.execute(
        select(TestRunCase).where(TestRunCase.id == run_case.id).with_for_update()
    ).scalar_one()

    now = datetime.now(UTC)
    steps = list(
        db.execute(
            select(ExecutionStep).where(
                ExecutionStep.test_run_case_id == run_case.id, ExecutionStep.verdict.is_(None)
            )
        ).scalars()
    )
    for step in steps:
        step.opened_at = step.opened_at or now
        step.closed_at = now
        step.duration_ms = int((step.closed_at - step.opened_at).total_seconds() * 1000)
        step.verdict = verdict
        step.executed_by = None  # no human actor -- attributed via the audit row instead

    if run_case.started_at is None:
        run_case.started_at = now

    db.flush()
    previous_status = run_case.status
    _recompute_run_case_status(db, run_case, executed_by=None, record_execution=True)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=None,
        service_token_id=service_token_id,
        action="executionstep.verdict_recorded_via_ci",
        entity_type="test_run_case",
        entity_id=run_case.id,
        metadata={
            "ci_status": ci_status,
            "verdict": verdict,
            "steps_updated": len(steps),
            "changes": audit_diff(
                {"run_case_status": previous_status},
                {"run_case_status": run_case.status},
            ),
        },
    )
    _auto_finish_if_complete(db, tenant_id, run.id, None, service_token_id)
    db.commit()
    return run_case


def finish_test_run(db: Session, tenant_id: UUID, actor_user_id: UUID, run_id: UUID) -> TestRun:
    run = _get_run_or_404(db, tenant_id, run_id)
    if run.finished_at is not None:
        raise ConflictError("Test run is already finished")

    _finish_run(db, tenant_id, run, actor_user_id, auto=False)
    db.commit()
    return run


def reopen_test_run(db: Session, tenant_id: UUID, actor_user_id: UUID, run_id: UUID) -> TestRun:
    """ADR-075: undo a finish. A finished run is locked, so blocking the last open
    case (which auto-finishes the run) used to leave that case permanently
    blocked, and a run finished by mistake could never be continued. Reopening
    clears `finished_at` and nothing else: case statuses, step verdicts and
    timings are untouched, and the run does not re-finish by itself -- auto-finish
    only runs when a verdict is recorded or a case is blocked, so the tester can
    first unblock a case or continue a step. Same permission as finish/pause/
    resume (`testrun.finish`, checked by the route). The audit trail keeps both
    the original `testrun.finished` event and this `testrun.reopened` one."""
    # Lock the run row so a reopen racing an auto-finish serializes: whichever
    # commits second sees the other's result.
    run = db.execute(
        select(TestRun)
        .where(TestRun.tenant_id == tenant_id, TestRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if run is None:
        raise NotFoundError("Test run not found")
    if run.finished_at is None:
        raise ConflictError("Test run is not finished")

    previous_finished_at = run.finished_at
    run.finished_at = None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.reopened",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"previous_finished_at": previous_finished_at.isoformat()},
    )
    db.commit()
    return run


def block_run_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    test_run_case_id: UUID,
    reason: str,
    actual_result: str | None = None,
) -> TestRunCase:
    """ADR-070 / BRD "Block Case": mark a run case Blocked with a required
    reason. Needs the same rights as recording a verdict (assignee for a
    Tester). Blocked is a manual state the step recompute never produces, and
    verdicts are refused until it is unblocked."""
    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    run = _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    _require_execution_rights(role_code, user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot modify a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is paused")
    if run_case.status == "blocked":
        raise ConflictError("This test case is already blocked")
    clean_reason = reason.strip()
    if len(clean_reason) < 3:
        raise ValidationAppError("A reason of at least 3 characters is required to block a case")

    db.execute(
        select(TestRunCase).where(TestRunCase.id == run_case.id).with_for_update()
    ).scalar_one()
    now = datetime.now(UTC)
    previous_status = run_case.status
    previous_actual = run_case.actual_result
    run_case.status = "blocked"
    run_case.blocked_reason = clean_reason
    run_case.completed_at = now
    if run_case.started_at is None:
        run_case.started_at = now
    # ADR-116: blocking is an execution outcome: who and when are recorded. The
    # reason is the explanation; an actual result may be added.
    run_case.executed_by = user_id
    run_case.executed_at = now
    clean_actual = sanitize_markdown(actual_result) if actual_result else None
    if clean_actual:
        run_case.actual_result = clean_actual

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="testrun.case_blocked",
        entity_type="test_run_case",
        entity_id=run_case.id,
        metadata={
            "reason": clean_reason,
            "previous_status": previous_status,
            "changes": audit_diff(
                {"status": previous_status, "actual_result": previous_actual},
                {"status": "blocked", "actual_result": run_case.actual_result},
            ),
        },
    )
    db.flush()
    _auto_finish_if_complete(db, tenant_id, run.id, user_id)
    db.commit()
    return run_case


def unblock_run_case(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_run_case_id: UUID
) -> TestRunCase:
    """Re-opens a blocked case: status is recomputed from its step verdicts
    (pending / in_progress / passed / failed), exactly as if it had never been
    blocked. Not possible once the run has finished."""
    run_case = _get_run_case_or_404(db, tenant_id, test_run_case_id)
    run = _authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    _require_execution_rights(role_code, user_id, run_case)
    if run.finished_at is not None:
        raise ConflictError("Cannot modify a finished test run")
    if run.paused_at is not None:
        raise ConflictError("Test run is paused")
    if run_case.status != "blocked":
        raise ConflictError("This test case is not blocked")

    db.execute(
        select(TestRunCase).where(TestRunCase.id == run_case.id).with_for_update()
    ).scalar_one()
    previous_reason = run_case.blocked_reason
    run_case.blocked_reason = None
    # No longer an execution outcome; a final status recomputed below re-stamps the
    # executor from the steps (the block itself stays in the audit trail).
    run_case.executed_by = None
    run_case.executed_at = None
    # ADR-075: the step timer does not run while a case is blocked. Blocking stamps
    # `completed_at`, so the time spent blocked is now - completed_at; moving the
    # open step's `opened_at` forward by that much makes both the live elapsed
    # clock and the recorded duration (closed_at - opened_at) exclude it. Steps
    # that already have a verdict keep their recorded times.
    unblocked_at = datetime.now(UTC)
    blocked_for = (
        max(unblocked_at - run_case.completed_at, timedelta(0))
        if run_case.completed_at is not None
        else timedelta(0)
    )
    open_steps = (
        db.execute(
            select(ExecutionStep).where(
                ExecutionStep.test_run_case_id == run_case.id,
                ExecutionStep.opened_at.is_not(None),
                ExecutionStep.verdict.is_(None),
            )
        )
        .scalars()
        .all()
    )
    for open_step_row in open_steps:
        if open_step_row.opened_at is not None:
            open_step_row.opened_at = open_step_row.opened_at + blocked_for
    db.flush()
    _recompute_run_case_status(db, run_case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="testrun.case_unblocked",
        entity_type="test_run_case",
        entity_id=run_case.id,
        metadata={
            "previous_reason": previous_reason,
            "status": run_case.status,
            "changes": audit_diff({"status": "blocked"}, {"status": run_case.status}),
            "blocked_seconds": int(blocked_for.total_seconds()),
        },
    )
    db.commit()
    return run_case


def delete_test_run(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, run_id: UUID
) -> None:
    """ADR-070: soft delete. The run, its run cases and step results stay in
    the database (and in tenant data exports) but disappear from every list,
    count and report. Caller must already hold testrun.delete."""
    run = _get_run_or_404(db, tenant_id, run_id)
    _authorize_run_access(db, tenant_id, role_code, actor_user_id, run)
    run.deleted_at = datetime.now(UTC)
    run.deleted_by = actor_user_id
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.deleted",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"name": run.name, "was_finished": run.finished_at is not None},
    )
    db.commit()


def rerun_failed(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, run_id: UUID
) -> TestRun:
    """ADR-096: new run holding only the failed/blocked run cases of `run_id`.
    Copies name/type/assignee/data row; links back via original_run_id.
    Each case is pinned to its current version if still approved, else to
    the version the original run executed."""
    source = _get_run_or_404(db, tenant_id, run_id)
    _authorize_run_access(db, tenant_id, role_code, actor_user_id, source)
    rerun_cases = list(
        db.execute(
            select(TestRunCase)
            .where(
                TestRunCase.test_run_id == source.id,
                TestRunCase.status.in_(("failed", "blocked")),
            )
            .order_by(TestRunCase.id)
        ).scalars()
    )
    if not rerun_cases:
        raise ConflictError("This run has no failed or blocked test cases to rerun")

    run = TestRun(
        tenant_id=tenant_id,
        project_id=source.project_id,
        name=f"{source.name} (rerun)",
        run_type=source.run_type,
        executed_by=actor_user_id,
        original_run_id=source.id,
        # The same environment, build and release as the run it repeats.
        environment_id=source.environment_id,
        build_id=source.build_id,
        release_id=source.release_id,
    )
    db.add(run)
    db.flush()

    for rc in rerun_cases:
        case = db.execute(
            select(TestCase)
            .where(TestCase.id == rc.test_case_id)
            .execution_options(include_deleted=True)
        ).scalar_one()
        if case.deleted_at is not None:
            continue  # ADR-116: a soft-deleted case is not re-run
        version_id = (
            case.current_version_id
            if case.status == "approved" and case.current_version_id is not None
            else rc.test_case_version_id
        )
        new_rc = TestRunCase(
            tenant_id=tenant_id,
            test_run_id=run.id,
            test_case_id=rc.test_case_id,
            test_case_version_id=version_id,
            test_data_row_id=rc.test_data_row_id,
            status="pending",
            assigned_to=rc.assigned_to,
        )
        db.add(new_rc)
        db.flush()
        for step in db.execute(
            select(TestCaseVersionStep)
            .where(TestCaseVersionStep.test_case_version_id == version_id)
            .order_by(TestCaseVersionStep.step_number)
        ).scalars():
            db.add(
                ExecutionStep(
                    tenant_id=tenant_id,
                    test_run_case_id=new_rc.id,
                    test_case_version_step_id=step.id,
                )
            )

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.rerun_created",
        entity_type="test_run",
        entity_id=run.id,
        metadata={
            "original_run_id": str(source.id),
            "name": run.name,
            "case_count": len(rerun_cases),
        },
    )
    db.commit()
    return run
