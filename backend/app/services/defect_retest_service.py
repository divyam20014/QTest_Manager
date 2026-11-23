"""ADR-118: defects raised from executions, and the retest workflow.

* `build_defect_draft`: a prefilled defect for a failed run case.
* `link_defect_to_run_case`: link an existing defect to a run case.
* `start_retest`: a new test run of type 'Retest' with the defect's linked test cases.
* `record_retest_result`: the outcome of that retest moves the defect on (pass: Closed,
  or Verified when the caller may not close; fail: Reopened). Every retest is a new run
  case, so earlier executions are never overwritten and the history stays complete.
"""

from collections.abc import Collection
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ValidationAppError
from app.core.field_standards import CONTENT_TEXT_MAX
from app.core.text_sanitize import sanitize_markdown
from app.models.audit import AuditLog
from app.models.defect import Defect, DefectLink
from app.models.execution import TestRun, TestRunCase
from app.models.identity import User
from app.models.test_case import Attachment, TestCase
from app.schemas.defect import (
    DefectDraftOut,
    DefectRetestOut,
    DefectRetestRequest,
    DefectRetestResultOut,
    DefectRetestResultRequest,
    DefectStatus,
    DraftEvidenceOut,
    DraftStepOut,
    LinkedDefectForCaseOut,
    RetestEntryOut,
)
from app.services import (
    defect_service,
    execution_service,
    lookups,
    notification_service,
    test_case_service,
    tester_visibility,
)
from app.services.project_service import is_assigned


def _run_case_or_404(db: Session, tenant_id: UUID, run_case_id: UUID) -> TestRunCase:
    return execution_service._get_run_case_or_404(db, tenant_id, run_case_id)


def _defects_of_run_case(db: Session, run_case_id: UUID) -> list[Defect]:
    linked = select(DefectLink.defect_id).where(
        DefectLink.linkable_type == "test_run_case", DefectLink.linkable_id == run_case_id
    )
    return list(
        db.execute(
            select(Defect)
            .where(or_(Defect.test_run_case_id == run_case_id, Defect.id.in_(linked)))
            .order_by(Defect.created_at)
        ).scalars()
    )


def build_defect_draft(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, run_case_id: UUID
) -> DefectDraftOut:
    """`GET /test-run-cases/{id}/defect-draft`: nothing is stored. Title
    'TC_000012 – <title> failed'; module, preconditions and the steps (up to and
    including the failing one, which is flagged) come from the case version the run
    case is pinned to; expected = failing step's expected result (else the case's);
    actual = the execution's actual result; environment = the case's environment (a run
    has no environment or build of its own); tester = whoever executed it; the evidence
    is the attachments of the execution's steps."""
    run_case = _run_case_or_404(db, tenant_id, run_case_id)
    run = execution_service._authorize_run_case_access(db, tenant_id, role_code, user_id, run_case)
    set_tenant_context(db, str(tenant_id))
    origin = defect_service.origin_from_run_case(db, run_case)
    paths = test_case_service._module_paths(db, {origin.module_id} if origin.module_id else set())
    module_name, module_path = paths.get(origin.module_id, (None, None))  # type: ignore[arg-type]
    tester_id = origin.executed_by or run_case.assigned_to
    tester_name = (
        db.execute(select(User.name).where(User.id == tester_id)).scalar_one_or_none()
        if tester_id
        else None
    )
    evidence = [
        DraftEvidenceOut(
            attachment_id=a.id,
            file_name=a.file_name,
            size_bytes=a.size_bytes,
            execution_step_id=a.owner_id,
        )
        for a in db.execute(
            select(Attachment)
            .where(
                Attachment.owner_type == "execution_step",
                Attachment.owner_id.in_(origin.evidence_step_ids or [UUID(int=0)]),
            )
            .order_by(Attachment.uploaded_at)
        ).scalars()
    ]
    existing = _defects_of_run_case(db, run_case.id)
    names = lookups.value_map(db, User.id, User.name, (d.assigned_to for d in existing))
    return DefectDraftOut(
        project_id=run.project_id,
        test_run_case_id=run_case.id,
        test_run_id=run.id,
        test_run_name=run.name,
        test_case_id=cast(UUID, origin.test_case_id),
        test_case_display_id=origin.test_case_display_id,
        test_case_title=cast(str, origin.test_case_title),
        test_case_version_number=cast(int, origin.version_number),
        title=cast(str, origin.title),
        description=cast(str, origin.description),
        module_id=origin.module_id,
        module_name=module_name,
        module_path=module_path,
        preconditions=origin.preconditions,
        repro_steps=[
            DraftStepOut(
                step_no=i,
                action=s.action,
                test_data=s.test_data,
                expected_result=s.expected_result,
                failed=s.failed,
            )
            for i, s in enumerate(origin.steps, start=1)
        ],
        failing_step_no=origin.failing_step_number,
        failing_execution_step_id=origin.failing_exec_step_id,
        expected_result=origin.expected,
        actual_result=origin.actual,
        environment=origin.environment,
        build_found=None,
        tester_id=tester_id,
        tester_name=tester_name,
        executed_at=origin.executed_at,
        run_case_status=run_case.status,
        evidence=evidence,
        existing_defects=[
            LinkedDefectForCaseOut(
                id=d.id,
                display_id=d.display_id,
                title=d.title,
                status=cast(DefectStatus, d.status),
                severity=d.severity,
                priority=d.priority,
                assigned_to=d.assigned_to,
                assigned_to_name=names.get(d.assigned_to),
            )
            for d in existing
        ],
    )


def link_defect_to_run_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    run_case_id: UUID,
    defect_id: UUID,
) -> tuple[Defect, bool]:
    """`POST /test-run-cases/{id}/defects/{defect_id}`: link an existing defect to this
    execution (and its test case). Same project only; idempotent; audited."""
    run_case = _run_case_or_404(db, tenant_id, run_case_id)
    run = execution_service._authorize_run_case_access(
        db, tenant_id, role_code, actor_user_id, run_case
    )
    defect = defect_service.get_defect(db, tenant_id, role_code, actor_user_id, defect_id)
    if defect.project_id != run.project_id:
        raise ValidationAppError(
            "The defect and the test run must belong to the same project",
            fields={"defect_id": "Defect belongs to a different project"},
        )
    _link, created = defect_service.insert_link(
        db, tenant_id, defect.id, "test_run_case", run_case.id
    )
    case_linked = run_case.test_case_id in defect_service.case_ids_of_defect(db, defect)
    if not case_linked:
        defect_service.insert_link(db, tenant_id, defect.id, "test_case", run_case.test_case_id)
    if created:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="defect.link_added",
            entity_type="defect",
            entity_id=defect.id,
            metadata={
                "linkable_type": "test_run_case",
                "linkable_id": str(run_case.id),
                "link_type": "relates_to",
                "test_run_id": str(run.id),
                "changes": {"links": {"from": None, "to": f"test_run_case:{run_case.id}"}},
            },
        )
    db.commit()
    return defect, created


# --- retest -----------------------------------------------------------------------------


def _check_tester(db: Session, tenant_id: UUID, defect: Defect, tester_id: UUID) -> User:
    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == tester_id)
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise ValidationAppError(
            "The tester must be an active user in this tenant",
            fields={"tester_id": "Not an active user in this tenant"},
        )
    project = defect_service._get_project_or_404(db, tenant_id, defect.project_id)
    if not is_assigned(db, project, tester_id):
        raise ValidationAppError(
            "The tester must be a member of the defect's project",
            fields={"tester_id": "Not a member of the defect's project"},
        )
    return user


def start_retest(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    req: DefectRetestRequest,
) -> DefectRetestOut:
    """`POST /defects/{id}/retest`: creates a test run of type 'Retest' holding the
    defect's linked test cases (their current versions), assigned to the reporter or the
    chosen tester, and links the defect to each run case. A Fixed defect moves to Retest
    on the way (the transition table allows it)."""
    defect = defect_service.get_defect(db, tenant_id, role_code, actor_user_id, defect_id)
    if defect.status not in ("Fixed", "Retest"):
        raise ConflictError(
            f"A retest can only be started for a defect that is Fixed or already in Retest, "
            f"not '{defect.status}'"
        )
    case_ids = defect_service.case_ids_of_defect(db, defect)
    query = select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id.in_(case_ids))
    query = tester_visibility.scope_case_query(db, tenant_id, role_code, actor_user_id, query)
    found = {c.id: c for c in db.execute(query).scalars()}
    cases = [found[c] for c in case_ids if c in found]
    if not cases:
        raise ValidationAppError(
            "Link at least one test case to the defect before starting a retest",
            fields={"test_case_ids": "The defect has no linked test case"},
        )
    tester_id = req.tester_id or defect.reported_by
    tester = _check_tester(db, tenant_id, defect, tester_id)

    label = defect.display_id or str(defect.id)[:8]
    run = TestRun(
        tenant_id=tenant_id,
        project_id=defect.project_id,
        name=(req.name or f"Retest {label}: {defect.title}")[:200],
        run_type="Retest",
        executed_by=actor_user_id,
    )
    db.add(run)
    db.flush()
    run_cases: list[TestRunCase] = []
    for case_ in cases:
        rc = execution_service._bundle_case_into_run(db, tenant_id, run.id, case_)
        rc.assigned_to = tester_id
        run_cases.append(rc)
        defect_service.insert_link(db, tenant_id, defect.id, "test_run_case", rc.id)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testrun.created",
        entity_type="test_run",
        entity_id=run.id,
        metadata={"name": run.name, "case_count": len(cases), "retest_of_defect": str(defect.id)},
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.retest_started",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "test_run_id": str(run.id),
            "run_case_ids": [str(rc.id) for rc in run_cases],
            "tester_id": str(tester_id),
            "comment": (req.comment or "")[:300] or None,
            "changes": {"retest_run": {"from": None, "to": run.name}},
        },
    )
    if defect.status == "Fixed":
        defect_service.apply_transition(
            db,
            defect,
            "Retest",
            actor_user_id=actor_user_id,
            comment=req.comment,
            extra_metadata={"test_run_id": str(run.id)},
        )
    notification_service.notify(
        db,
        tenant_id,
        actor_user_id,
        tester.id,
        tester.email,
        "run_case_assigned",
        "A retest was assigned to you",
        f'Retest "{run.name}" for defect "{defect.title}" was assigned to you.',
        "test_run",
        run.id,
    )
    db.commit()
    return DefectRetestOut(
        defect_id=defect.id,
        status=cast(DefectStatus, defect.status),
        test_run_id=run.id,
        test_run_name=run.name,
        run_case_ids=[rc.id for rc in run_cases],
        test_case_ids=[c.id for c in cases],
    )


def record_retest_result(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    req: DefectRetestResultRequest,
    *,
    permissions: Collection[str] | None = None,
) -> DefectRetestResultOut:
    """`POST /defects/{id}/retest-result`: the outcome of one retest run case.

    pass: Retest -> Closed (resolution Fixed) when the caller may close defects
    (`defect.close`, Admin / Manager), otherwise Retest -> Verified (the legacy "retest
    passed, awaiting close" status). fail: Retest -> Reopened (reopened_count + 1, the
    assignee and reporter are notified, the failure text is appended to the actual
    result). The run case must belong to a Retest run of this defect and show the
    matching status; the run case itself is never modified."""
    defect = defect_service.get_defect(db, tenant_id, role_code, actor_user_id, defect_id)
    if defect.status != "Retest":
        raise ConflictError(
            f"A retest result can only be recorded for a defect in Retest, not '{defect.status}'"
        )
    run_case = _run_case_or_404(db, tenant_id, req.run_case_id)
    linked = db.execute(
        select(DefectLink.id).where(
            DefectLink.defect_id == defect.id,
            DefectLink.linkable_type == "test_run_case",
            DefectLink.linkable_id == run_case.id,
        )
    ).first()
    run = db.execute(select(TestRun).where(TestRun.id == run_case.test_run_id)).scalar_one_or_none()
    if linked is None or run is None or run.run_type != "Retest":
        raise ValidationAppError(
            "run_case_id must be a run case of a Retest run linked to this defect",
            fields={"run_case_id": "Not a retest run case of this defect"},
        )
    expected_status = "passed" if req.result == "pass" else "failed"
    if run_case.status != expected_status:
        raise ConflictError(
            f"The run case is '{run_case.status}'; execute it so that it is '{expected_status}' "
            f"before recording a {req.result} result"
        )
    comment = sanitize_markdown(req.comment) if req.comment else None
    before_status = defect.status

    if req.result == "pass":
        closed = defect_service.can_close(role_code, permissions)
        defect_service.apply_transition(
            db,
            defect,
            "Closed" if closed else "Verified",
            actor_user_id=actor_user_id,
            resolution="Fixed",
            comment=comment,
            extra_metadata={"retest_run_case_id": str(run_case.id), "test_run_id": str(run.id)},
        )
    else:
        closed = False
        text = comment or run_case.actual_result or "The retest did not pass."
        stamp = f'\n\n--- Retest failed {datetime.now(UTC):%Y-%m-%d} (run "{run.name}") ---\n{text}'
        combined = (defect.actual_result or "") + stamp
        before_actual = defect.actual_result
        defect.actual_result = combined[-CONTENT_TEXT_MAX:]
        defect_service.apply_transition(
            db,
            defect,
            "Reopened",
            actor_user_id=actor_user_id,
            comment=comment,
            extra_metadata={
                "retest_run_case_id": str(run_case.id),
                "test_run_id": str(run.id),
                "changes": {
                    **audit_diff(
                        {"status": before_status, "resolution": defect.resolution},
                        {"status": "Reopened", "resolution": None},
                    ),
                    **audit_diff(
                        {"actual_result": before_actual}, {"actual_result": defect.actual_result}
                    ),
                },
            },
        )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.retest_result",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "result": req.result,
            "run_case_id": str(run_case.id),
            "test_run_id": str(run.id),
            "comment": (comment or "")[:300] or None,
            "changes": {"status": {"from": before_status, "to": defect.status}},
        },
    )
    db.commit()
    return DefectRetestResultOut(
        defect_id=defect.id,
        result=req.result,
        status=cast(DefectStatus, defect.status),
        closed=defect.status == "Closed",
        reopened_count=defect.reopened_count,
    )


def list_retests(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, defect_id: UUID
) -> list[RetestEntryOut]:
    """`GET /defects/{id}/retests`: every retest of the defect (one entry per run case of
    a Retest run), newest first, with the recorded result where there is one."""
    defect = defect_service.get_defect(db, tenant_id, role_code, user_id, defect_id)
    set_tenant_context(db, str(tenant_id))
    rows = db.execute(
        select(TestRunCase, TestRun, TestCase.display_id, TestCase.title)
        .join(DefectLink, DefectLink.linkable_id == TestRunCase.id)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(TestCase, TestCase.id == TestRunCase.test_case_id)
        .where(
            DefectLink.defect_id == defect.id,
            DefectLink.linkable_type == "test_run_case",
            TestRun.run_type == "Retest",
        )
        .order_by(TestRun.created_at.desc(), TestRunCase.id)
        .execution_options(include_deleted=True)
    ).all()
    results: dict[str, Any] = {}
    for log in db.execute(
        select(AuditLog)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "defect",
            AuditLog.entity_id == defect.id,
            AuditLog.action == "defect.retest_result",
        )
        .order_by(AuditLog.created_at)
    ).scalars():
        meta = log.event_metadata or {}
        results[str(meta.get("run_case_id"))] = (meta.get("result"), log.created_at)
    names = lookups.value_map(
        db,
        User.id,
        User.name,
        [rc.assigned_to for rc, *_ in rows] + [rc.executed_by for rc, *_ in rows],
    )
    return [
        RetestEntryOut(
            test_run_id=run.id,
            test_run_name=run.name,
            test_run_case_id=rc.id,
            test_case_id=rc.test_case_id,
            test_case_display_id=display_id,
            test_case_title=title,
            run_case_status=rc.status,
            assigned_to=rc.assigned_to,
            assigned_to_name=names.get(rc.assigned_to),
            executed_by=rc.executed_by,
            executed_by_name=names.get(rc.executed_by),
            executed_at=rc.executed_at,
            result=results.get(str(rc.id), (None, None))[0],
            result_recorded_at=results.get(str(rc.id), (None, None))[1],
            created_at=run.created_at,
        )
        for rc, run, display_id, title in rows
    ]
