from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.execution import (
    TestRunCaseAddRequest,
    TestRunCaseAssignRequest,
    TestRunCreateRequest,
    TestRunUpdateRequest,
    VerdictRequest,
)
from app.services import execution_service

router = APIRouter(tags=["execution"])


@router.post("/projects/{project_id}/test-runs")
def create_test_run(
    project_id: UUID,
    req: TestRunCreateRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.create_test_run(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


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


@router.post("/test-runs/{run_id}/finish")
def finish_test_run(
    run_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.finish")),
    db: Session = Depends(get_db),
) -> dict:
    run = execution_service.finish_test_run(db, ctx.tenant_id, ctx.user_id, run_id)
    return envelope(execution_service.to_out(db, run).model_dump(mode="json"))


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
    ctx: SessionContext = Depends(require_permission("executionstep.record")),
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
    ctx: SessionContext = Depends(require_permission("executionstep.record")),
    db: Session = Depends(get_db),
) -> dict:
    step = execution_service.record_verdict(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, execution_step_id, req.verdict
    )
    return envelope(execution_service.step_to_out(db, step).model_dump(mode="json"))
