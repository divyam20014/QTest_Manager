from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.test_case import TestCaseCreateRequest, TestCaseUpdateRequest
from app.services import test_case_service

router = APIRouter(tags=["test-cases"])


@router.get("/projects/{project_id}/test-cases")
def list_test_cases(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    cases = test_case_service.list_test_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope([test_case_service.to_out(db, c).model_dump(mode="json") for c in cases])


@router.post("/projects/{project_id}/test-cases")
def create_test_case(
    project_id: UUID,
    req: TestCaseCreateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.create")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.create_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.get("/test-cases/{test_case_id}")
def get_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.get_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.get("/test-cases/{test_case_id}/versions")
def list_versions(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    versions = test_case_service.list_versions(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope([v.model_dump(mode="json") for v in versions])


@router.patch("/test-cases/{test_case_id}")
def update_test_case(
    test_case_id: UUID,
    req: TestCaseUpdateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.update_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, req
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/submit-review")
def submit_for_review(
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.submit_for_review(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/approve")
def approve_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.approve")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.approve_test_case(db, ctx.tenant_id, ctx.user_id, test_case_id)
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.delete("/test-cases/{test_case_id}")
def delete_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    test_case_service.delete_test_case(db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id)
    return envelope({"deleted": True})
