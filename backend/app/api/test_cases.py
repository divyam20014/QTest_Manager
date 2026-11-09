from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.test_case import (
    TestCaseCreateRequest,
    TestCaseListResponse,
    TestCaseUpdateRequest,
)
from app.services import test_case_service

router = APIRouter(tags=["test-cases"])


@router.get("/projects/{project_id}/test-cases")
def list_test_cases(
    project_id: UUID,
    search: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    status: str | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    sort: str = Query(default="created_at"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=test_case_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    cases, total = test_case_service.list_test_cases(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id,
        search=search,
        priority=priority,
        status=status,
        assignee_id=assignee_id,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    items = [test_case_service.to_out(db, c) for c in cases]
    return envelope(TestCaseListResponse(items=items, total=total).model_dump(mode="json"))


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


@router.get("/test-cases/{test_case_id}/versions/compare")
def compare_versions(
    test_case_id: UUID,
    from_version: int = Query(alias="from"),
    to_version: int = Query(alias="to"),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    result = test_case_service.compare_versions(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, from_version, to_version
    )
    return envelope(result.model_dump(mode="json"))


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


@router.post("/test-cases/{test_case_id}/deprecate")
def deprecate_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.deprecate")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.deprecate_test_case(db, ctx.tenant_id, ctx.user_id, test_case_id)
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.delete("/test-cases/{test_case_id}")
def delete_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    test_case_service.delete_test_case(db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id)
    return envelope({"deleted": True})
