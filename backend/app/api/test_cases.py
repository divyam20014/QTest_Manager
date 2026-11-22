from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    get_effective_permissions_for_project,
    require_project_permission,
    require_resource_permission,
)
from app.core.db import get_db
from app.core.idempotency import with_idempotency
from app.core.responses import envelope
from app.schemas.test_case import (
    QuarantineRequest,
    RequestChangesRequest,
    SubmitForReviewRequest,
    TestCaseBulkUpdateRequest,
    TestCaseCreateRequest,
    TestCaseListResponse,
    TestCaseUpdateRequest,
)
from app.services import test_case_service

router = APIRouter(tags=["test-cases"])


@router.get("/test-cases")
def list_test_cases_all_projects(
    search: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    status: str | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    module_id: UUID | None = Query(default=None),
    quarantined: Literal["any", "only", "exclude"] = Query(default="any"),
    sort: str = Query(default="created_at"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=test_case_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-077: the same listing as `/projects/{id}/test-cases`, across every project
    the caller may see. Each item carries its `project_id`."""
    cases, total = test_case_service.list_test_cases_all_projects(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        search=search,
        priority=priority,
        status=status,
        assignee_id=assignee_id,
        module_id=module_id,
        quarantined=quarantined,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    items = [test_case_service.to_out(db, c) for c in cases]
    return envelope(TestCaseListResponse(items=items, total=total).model_dump(mode="json"))


@router.get("/projects/{project_id}/test-cases")
def list_test_cases(
    project_id: UUID,
    search: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    status: str | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    module_id: UUID | None = Query(default=None),
    quarantined: Literal["any", "only", "exclude"] = Query(default="any"),
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
        module_id=module_id,
        quarantined=quarantined,
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
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ctx: SessionContext = Depends(require_project_permission("testcase.create")),
    db: Session = Depends(get_db),
) -> dict:
    case = with_idempotency(
        db,
        ctx.tenant_id,
        ctx.user_id,
        "testcase.create",
        idempotency_key,
        create=lambda: test_case_service.create_test_case(
            db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
        ),
        get_by_id=lambda eid: test_case_service.get_test_case(
            db, ctx.tenant_id, ctx.role_code, ctx.user_id, eid
        ),
        entity_id_of=lambda c: c.id,
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


@router.get("/test-cases/{test_case_id}/requirements")
def list_linked_requirements(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(
        test_case_service.list_linked_requirements(
            db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
        )
    )


@router.get("/test-cases/{test_case_id}/history")
def get_test_case_history(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    history = test_case_service.get_test_case_history(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope([h.model_dump(mode="json") for h in history])


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


@router.post("/test-cases/bulk-update")
def bulk_update_test_cases(
    req: TestCaseBulkUpdateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-070: bulk priority/assignee change (metadata only -- never forks a
    version). Per-item results; `testcase.edit` is checked per item against
    that item's project (project-scoped role overrides apply)."""
    result = test_case_service.bulk_update_metadata(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        req,
        can_edit=lambda project_id: "testcase.edit"
        in get_effective_permissions_for_project(db, ctx, project_id),
    )
    return envelope(result.model_dump(mode="json"))


@router.patch("/test-cases/{test_case_id}")
def update_test_case(
    test_case_id: UUID,
    req: TestCaseUpdateRequest,
    ctx: SessionContext = Depends(require_resource_permission("testcase.edit", "test_case")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.update_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, req
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/submit-review")
def submit_for_review(
    test_case_id: UUID,
    req: SubmitForReviewRequest = SubmitForReviewRequest(),
    ctx: SessionContext = Depends(require_resource_permission("testcase.edit", "test_case")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.submit_for_review(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, reviewer_id=req.reviewer_id
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/approve")
def approve_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_resource_permission("testcase.approve", "test_case")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.approve_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/request-changes")
def request_changes(
    test_case_id: UUID,
    req: RequestChangesRequest,
    ctx: SessionContext = Depends(require_resource_permission("testcase.approve", "test_case")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.request_changes_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, req.comment
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/deprecate")
def deprecate_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_resource_permission("testcase.deprecate", "test_case")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.deprecate_test_case(db, ctx.tenant_id, ctx.user_id, test_case_id)
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/quarantine")
def quarantine_test_case(
    test_case_id: UUID,
    req: QuarantineRequest,
    ctx: SessionContext = Depends(require_resource_permission("testcase.approve", "test_case")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.quarantine_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, req.reason
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/unquarantine")
def unquarantine_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_resource_permission("testcase.approve", "test_case")),
    db: Session = Depends(get_db),
) -> dict:
    case = test_case_service.unquarantine_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope(test_case_service.to_out(db, case).model_dump(mode="json"))


@router.delete("/test-cases/{test_case_id}")
def delete_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    test_case_service.delete_test_case(db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id)
    return envelope({"deleted": True})
