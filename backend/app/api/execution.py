from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    require_any_permission,
    require_permission,
    require_project_permission,
    require_resource_permission,
)
from app.core.db import get_db
from app.core.errors import ForbiddenError
from app.core.policy import apply_access_rules
from app.core.responses import envelope
from app.schemas.execution import (
    BlockRunCaseRequest,
    TestRunCaseAddRequest,
    TestRunCaseAssignRequest,
    TestRunCreateRequest,
    TestRunSummaryListResponse,
    TestRunUpdateRequest,
    VerdictRequest,
)
from app.services import defect_retest_service, defect_service, execution_service

router = APIRouter(tags=["execution"])


def require_execute_permission(
    request: Request,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> SessionContext:
    """ADR-116: recording execution results needs `executionstep.record` OR the new
    `testcase.execute` (granted to the same roles), so nobody loses access. Access
    rules (freezes) are always evaluated against the canonical action."""
    if "executionstep.record" not in ctx.permissions and "testcase.execute" not in ctx.permissions:
        raise ForbiddenError("Missing permission: executionstep.record")
    apply_access_rules(ctx, request, db, "executionstep.record")
    return ctx


@router.post("/projects/{project_id}/test-runs")
def create_test_run(
    project_id: UUID,
    req: TestRunCreateRequest,
    ctx: SessionContext = Depends(require_project_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.create_test_run(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.get("/test-runs")
def list_test_runs_all_projects(
    project_id: UUID | None = Query(default=None),
    active_only: bool = Query(default=False),
    status: Literal["in_progress", "paused", "finished"] | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(
        default=execution_service.RUN_DEFAULT_PAGE_SIZE,
        ge=1,
        le=execution_service.RUN_MAX_PAGE_SIZE,
    ),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-078: one page of runs across every project the caller may see, newest first."""
    items, total = execution_service.list_test_runs_all_projects(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id=project_id,
        active_only=active_only,
        status=status,
        search=search,
        page=page,
        page_size=page_size,
    )
    return envelope(TestRunSummaryListResponse(items=items, total=total).model_dump(mode="json"))


@router.get("/projects/{project_id}/test-runs")
def list_test_runs(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    runs = execution_service.list_test_runs(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope([r.model_dump(mode="json") for r in runs])


@router.get("/test-runs/{run_id}")
def get_test_run(
    run_id: UUID, ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> dict:
    run = execution_service.get_test_run(db, ctx.tenant_id, ctx.role_code, ctx.user_id, run_id)
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.patch("/test-runs/{run_id}")
def update_test_run(
    run_id: UUID,
    req: TestRunUpdateRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.update_test_run(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, run_id, req
    )
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.post("/test-runs/{run_id}/cases")
def add_test_run_cases(
    run_id: UUID,
    req: TestRunCaseAddRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.add_test_run_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, run_id, req
    )
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.delete("/test-runs/{run_id}/cases/{test_run_case_id}")
def remove_test_run_case(
    run_id: UUID,
    test_run_case_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.remove_test_run_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, run_id, test_run_case_id
    )
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.patch("/test-run-cases/{test_run_case_id}/assign")
def assign_run_case(
    test_run_case_id: UUID,
    req: TestRunCaseAssignRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    run_case = execution_service.assign_run_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_run_case_id, req.assigned_to
    )
    assigned_to = str(run_case.assigned_to) if run_case.assigned_to else None
    return envelope({"id": str(run_case.id), "assigned_to": assigned_to})


@router.post("/test-runs/{run_id}/pause")
def pause_test_run(
    run_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.finish")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.pause_test_run(db, ctx.tenant_id, ctx.user_id, run_id)
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.post("/test-runs/{run_id}/resume")
def resume_test_run(
    run_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.finish")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.resume_test_run(db, ctx.tenant_id, ctx.user_id, run_id)
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.post("/test-runs/{run_id}/reopen")
def reopen_test_run(
    run_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.finish")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.reopen_test_run(db, ctx.tenant_id, ctx.user_id, run_id)
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.post("/test-runs/{run_id}/rerun-failed")
def rerun_failed_test_run(
    run_id: UUID,
    ctx: SessionContext = Depends(
        require_resource_permission("testrun.create", "test_run", id_param="run_id")
    ),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-096: create a new run from the failed/blocked cases of this one."""
    run = execution_service.rerun_failed(db, ctx.tenant_id, ctx.role_code, ctx.user_id, run_id)
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.post("/test-runs/{run_id}/finish")
def finish_test_run(
    run_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.finish")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.finish_test_run(db, ctx.tenant_id, ctx.user_id, run_id)
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


@router.delete("/test-runs/{run_id}")
def delete_test_run(
    run_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.delete")),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-070: soft delete -- the run disappears from lists/reports but its
    data is retained (and included in tenant exports)."""
    execution_service.delete_test_run(db, ctx.tenant_id, ctx.role_code, ctx.user_id, run_id)
    return envelope({"id": str(run_id), "deleted": True})


@router.post("/test-run-cases/{test_run_case_id}/block")
def block_run_case(
    test_run_case_id: UUID,
    req: BlockRunCaseRequest,
    ctx: SessionContext = Depends(require_execute_permission),
    db: Session = Depends(get_db),
) -> dict:
    run_case = execution_service.block_run_case(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        test_run_case_id,
        req.reason,
        actual_result=req.actual_result,
    )
    return envelope(
        {
            "id": str(run_case.id),
            "status": run_case.status,
            "blocked_reason": run_case.blocked_reason,
        }
    )


@router.post("/test-run-cases/{test_run_case_id}/unblock")
def unblock_run_case(
    test_run_case_id: UUID,
    ctx: SessionContext = Depends(require_execute_permission),
    db: Session = Depends(get_db),
) -> dict:
    run_case = execution_service.unblock_run_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_run_case_id
    )
    return envelope({"id": str(run_case.id), "status": run_case.status, "blocked_reason": None})


@router.get("/test-run-cases/{test_run_case_id}/context")
def get_run_case_context(
    test_run_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    context = execution_service.get_run_case_context(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_run_case_id
    )
    return envelope(context.model_dump(mode="json"))


@router.get("/test-run-cases/{test_run_case_id}/steps")
def list_steps(
    test_run_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    steps = execution_service.list_steps_for_run_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_run_case_id
    )
    return envelope([s.model_dump(mode="json") for s in steps])


@router.post("/execution-steps/{execution_step_id}/open")
def open_step(
    execution_step_id: UUID,
    ctx: SessionContext = Depends(require_execute_permission),
    db: Session = Depends(get_db),
) -> dict:
    step = execution_service.open_step(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, execution_step_id
    )
    return envelope(execution_service.step_to_out(db, step).model_dump(mode="json"))


@router.post("/execution-steps/{execution_step_id}/verdict")
def record_verdict(
    execution_step_id: UUID,
    req: VerdictRequest,
    ctx: SessionContext = Depends(require_execute_permission),
    db: Session = Depends(get_db),
) -> dict:
    step = execution_service.record_verdict(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        execution_step_id,
        req.verdict,
        actual_result=req.actual_result,
    )
    return envelope(execution_service.step_to_out(db, step).model_dump(mode="json"))


@router.get("/test-run-cases/{test_run_case_id}/defect-draft")
def get_defect_draft(
    test_run_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-118: a prefilled defect for this execution (title 'TC_000012 - <title>
    failed', module, steps with the failing one flagged, expected, actual, environment,
    tester, evidence). Nothing is stored; `POST /defects` with `test_run_case_id` creates
    it (and links it to the case and this run case)."""
    draft = defect_retest_service.build_defect_draft(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_run_case_id
    )
    return envelope(draft.model_dump(mode="json"))


@router.post("/test-run-cases/{test_run_case_id}/defects/{defect_id}")
def link_existing_defect(
    test_run_case_id: UUID,
    defect_id: UUID,
    ctx: SessionContext = Depends(require_any_permission("defect.edit", "defect.create")),
    db: Session = Depends(get_db),
) -> dict:
    """Link an existing defect of the same project to this run case (idempotent)."""
    defect, created = defect_retest_service.link_defect_to_run_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_run_case_id, defect_id
    )
    out = defect_service.to_out(db, defect).model_dump(mode="json")
    out["link_created"] = created
    return envelope(out)
