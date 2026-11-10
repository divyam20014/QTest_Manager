from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.requirement import (
    LinkTestCaseRequest,
    RequirementCreateRequest,
    RequirementListResponse,
    RequirementUpdateRequest,
)
from app.services import requirement_service

router = APIRouter(tags=["requirements"])


@router.get("/projects/{project_id}/requirements")
def list_requirements(
    project_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=requirement_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    items, total = requirement_service.list_requirements(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, page, page_size
    )
    out = [requirement_service.to_out(db, r) for r in items]
    return envelope(RequirementListResponse(items=out, total=total).model_dump(mode="json"))


@router.post("/projects/{project_id}/requirements")
def create_requirement(
    project_id: UUID,
    req: RequirementCreateRequest,
    ctx: SessionContext = Depends(require_permission("requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    requirement = requirement_service.create_requirement(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(requirement_service.to_out(db, requirement).model_dump(mode="json"))


@router.get("/projects/{project_id}/requirements/coverage")
def coverage_report(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    report = requirement_service.get_coverage_report(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
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
    return envelope(requirement_service.to_detail_out(db, requirement).model_dump(mode="json"))


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
    return envelope(requirement_service.to_detail_out(db, requirement).model_dump(mode="json"))


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
    return envelope(requirement_service.to_detail_out(db, requirement).model_dump(mode="json"))
