from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.shared_step import SharedStepCreateRequest, SharedStepUpdateRequest
from app.services import shared_step_service

router = APIRouter(tags=["shared-steps"])


@router.get("/projects/{project_id}/shared-steps")
def list_shared_steps(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    steps = shared_step_service.list_shared_steps(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope([s.model_dump(mode="json") for s in steps])


@router.post("/projects/{project_id}/shared-steps")
def create_shared_step(
    project_id: UUID,
    req: SharedStepCreateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    step = shared_step_service.create_shared_step(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(step.model_dump(mode="json"))


@router.patch("/shared-steps/{shared_step_id}")
def update_shared_step(
    shared_step_id: UUID,
    req: SharedStepUpdateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    step = shared_step_service.update_shared_step(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, shared_step_id, req
    )
    return envelope(step.model_dump(mode="json"))


@router.delete("/shared-steps/{shared_step_id}")
def delete_shared_step(
    shared_step_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    shared_step_service.delete_shared_step(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, shared_step_id
    )
    return envelope({"deleted": True})
