from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    require_permission,
    require_project_permission,
)
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.requirement import (
    ConfirmLinkRequest,
    LinkTestCaseRequest,
    RequirementCreateRequest,
    RequirementListResponse,
    RequirementStatus,
    RequirementUpdateRequest,
)
from app.services import requirement_service

router = APIRouter(tags=["requirements"])


@router.get("/projects/{project_id}/requirements")
def list_requirements(
    project_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=requirement_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    task_id: UUID | None = Query(default=None, description="Only this task's requirements."),
    include_sub_tasks: bool = Query(default=False, description="With task_id: its sub-tasks too."),
    q: str | None = Query(default=None, max_length=200, description="In the title or id."),
    requirement_type: str | None = Query(default=None, max_length=64),
    status: RequirementStatus | None = None,
    priority: str | None = Query(default=None, max_length=64),
    owner_id: UUID | None = None,
    covered: bool | None = Query(default=None, description="Has at least one test case."),
    needs_review: bool | None = Query(default=None, description="Has a test case to review."),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    items, total = requirement_service.list_requirements(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id,
        page,
        page_size,
        task_id=task_id,
        include_sub_tasks=include_sub_tasks,
        q=q,
        requirement_type=requirement_type,
        status=status,
        priority=priority,
        owner_id=owner_id,
        covered=covered,
        needs_review=needs_review,
    )
    out = requirement_service.to_out_many(db, items)
    return envelope(RequirementListResponse(items=out, total=total).model_dump(mode="json"))


@router.post("/projects/{project_id}/requirements")
def create_requirement(
    project_id: UUID,
    req: RequirementCreateRequest,
    ctx: SessionContext = Depends(require_project_permission("requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    requirement = requirement_service.create_requirement(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(requirement_service.to_out(db, requirement).model_dump(mode="json"))


@router.get("/projects/{project_id}/requirements/coverage")
def coverage_report(
    project_id: UUID,
    summary: bool = Query(False, description="Totals only: `requirements` is left empty."),
    task_id: UUID | None = Query(default=None, description="Only this task requirements."),
    include_sub_tasks: bool = Query(default=False, description="With task_id: its sub-tasks too."),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    report = requirement_service.get_coverage_report(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id,
        summary=summary,
        task_id=task_id,
        include_sub_tasks=include_sub_tasks,
    )
    return envelope(report.model_dump(mode="json"))


@router.get("/requirements/{requirement_id}")
def get_requirement(
    requirement_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    requirement = requirement_service.get_requirement(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id
    )
    return envelope(
        requirement_service.to_detail_out(db, requirement, (ctx.role_code, ctx.user_id)).model_dump(
            mode="json"
        )
    )


@router.get("/requirements/{requirement_id}/history")
def get_requirement_history(
    requirement_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    history = requirement_service.get_requirement_history(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id
    )
    return envelope([h.model_dump(mode="json") for h in history])


@router.get("/requirements/{requirement_id}/versions")
def list_versions(
    requirement_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    versions = requirement_service.list_versions(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id
    )
    return envelope([v.model_dump(mode="json") for v in versions])


@router.patch("/requirements/{requirement_id}")
def update_requirement(
    requirement_id: UUID,
    req: RequirementUpdateRequest,
    ctx: SessionContext = Depends(require_permission("requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    requirement = requirement_service.update_requirement(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id, req
    )
    return envelope(requirement_service.to_out(db, requirement).model_dump(mode="json"))


@router.delete("/requirements/{requirement_id}")
def delete_requirement(
    requirement_id: UUID,
    ctx: SessionContext = Depends(require_permission("requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    requirement_service.delete_requirement(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id
    )
    return envelope({"deleted": True})


@router.post("/requirements/{requirement_id}/test-cases")
def link_test_case(
    requirement_id: UUID,
    req: LinkTestCaseRequest,
    ctx: SessionContext = Depends(require_permission("requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    requirement = requirement_service.link_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id, req.test_case_id
    )
    return envelope(
        requirement_service.to_detail_out(db, requirement, (ctx.role_code, ctx.user_id)).model_dump(
            mode="json"
        )
    )


@router.post("/requirements/{requirement_id}/test-cases/{test_case_id}/confirm")
def confirm_link(
    requirement_id: UUID,
    test_case_id: UUID,
    req: ConfirmLinkRequest,
    ctx: SessionContext = Depends(require_permission("requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    requirement = requirement_service.confirm_link(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        requirement_id,
        test_case_id,
        req.version_number,
    )
    detail = requirement_service.to_detail_out(db, requirement, (ctx.role_code, ctx.user_id))
    return envelope(detail.model_dump(mode="json"))


@router.delete("/requirements/{requirement_id}/test-cases/{test_case_id}")
def unlink_test_case(
    requirement_id: UUID,
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_permission("requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    requirement = requirement_service.unlink_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id, test_case_id
    )
    return envelope(
        requirement_service.to_detail_out(db, requirement, (ctx.role_code, ctx.user_id)).model_dump(
            mode="json"
        )
    )
