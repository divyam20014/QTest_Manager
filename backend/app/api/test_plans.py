from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.test_plan import (
    TestPlanCreateRequest,
    TestPlanRunSetRequest,
    TestPlanUpdateRequest,
)
from app.services import test_plan_service

router = APIRouter(tags=["test-plans"])


@router.get("/projects/{project_id}/test-plans")
def list_plans(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    plans = test_plan_service.list_plans(db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id)
    return envelope([p.model_dump(mode="json") for p in plans])


@router.post("/projects/{project_id}/test-plans")
def create_plan(
    project_id: UUID,
    req: TestPlanCreateRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    plan = test_plan_service.create_plan(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(plan.model_dump(mode="json"))


@router.patch("/test-plans/{plan_id}")
def update_plan(
    plan_id: UUID,
    req: TestPlanUpdateRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    plan = test_plan_service.update_plan(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, plan_id, req
    )
    return envelope(plan.model_dump(mode="json"))


@router.put("/test-plans/{plan_id}/runs")
def set_plan_runs(
    plan_id: UUID,
    req: TestPlanRunSetRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    plan = test_plan_service.set_plan_runs(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, plan_id, req
    )
    return envelope(plan.model_dump(mode="json"))


@router.delete("/test-plans/{plan_id}")
def delete_plan(
    plan_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    test_plan_service.delete_plan(db, ctx.tenant_id, ctx.role_code, ctx.user_id, plan_id)
    return envelope({"deleted": True})


@router.get("/test-plans/{plan_id}/rollup")
def get_plan_rollup(
    plan_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    rollup = test_plan_service.get_plan_rollup(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, plan_id
    )
    return envelope(rollup.model_dump(mode="json"))
