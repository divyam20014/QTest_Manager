from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.test_module import (
    BulkAssignModuleRequest,
    TestModuleCreateRequest,
    TestModuleUpdateRequest,
)
from app.services import test_module_service

router = APIRouter(tags=["test-modules"])


class AssignModuleRequest(BaseModel):
    module_id: UUID | None = None


@router.get("/projects/{project_id}/modules")
def list_modules(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    modules = test_module_service.list_modules(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope([m.model_dump(mode="json") for m in modules])


@router.post("/projects/{project_id}/modules")
def create_module(
    project_id: UUID,
    req: TestModuleCreateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    module = test_module_service.create_module(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(module.model_dump(mode="json"))


@router.patch("/modules/{module_id}")
def update_module(
    module_id: UUID,
    req: TestModuleUpdateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    module = test_module_service.update_module(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, module_id, req
    )
    return envelope(module.model_dump(mode="json"))


@router.delete("/modules/{module_id}")
def delete_module(
    module_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    test_module_service.delete_module(db, ctx.tenant_id, ctx.role_code, ctx.user_id, module_id)
    return envelope({"deleted": True})


@router.post("/test-cases/{test_case_id}/module")
def assign_module(
    test_case_id: UUID,
    req: AssignModuleRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    test_module_service.assign_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, req.module_id
    )
    return envelope({"assigned": True})


@router.post("/test-cases/bulk-assign-module")
def bulk_assign_module(
    req: BulkAssignModuleRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    count = test_module_service.bulk_assign_test_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, req.test_case_ids, req.module_id
    )
    return envelope({"reassigned": count})
