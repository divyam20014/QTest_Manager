from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.test_suite import (
    CreateRunFromSuiteRequest,
    TestSuiteCaseSetRequest,
    TestSuiteCreateRequest,
    TestSuiteUpdateRequest,
)
from app.services import test_suite_service
from app.services.execution_service import to_out as run_to_out

router = APIRouter(tags=["test-suites"])


@router.get("/projects/{project_id}/test-suites")
def list_suites(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    suites = test_suite_service.list_suites(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope([s.model_dump(mode="json") for s in suites])


@router.post("/projects/{project_id}/test-suites")
def create_suite(
    project_id: UUID,
    req: TestSuiteCreateRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    suite = test_suite_service.create_suite(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(suite.model_dump(mode="json"))


@router.patch("/test-suites/{suite_id}")
def update_suite(
    suite_id: UUID,
    req: TestSuiteUpdateRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    suite = test_suite_service.update_suite(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, suite_id, req
    )
    return envelope(suite.model_dump(mode="json"))


@router.put("/test-suites/{suite_id}/cases")
def set_suite_cases(
    suite_id: UUID,
    req: TestSuiteCaseSetRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    suite = test_suite_service.set_suite_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, suite_id, req
    )
    return envelope(suite.model_dump(mode="json"))


@router.delete("/test-suites/{suite_id}")
def delete_suite(
    suite_id: UUID,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    test_suite_service.delete_suite(db, ctx.tenant_id, ctx.role_code, ctx.user_id, suite_id)
    return envelope({"deleted": True})


@router.post("/test-suites/{suite_id}/create-run")
def create_run_from_suite(
    suite_id: UUID,
    req: CreateRunFromSuiteRequest,
    ctx: SessionContext = Depends(require_permission("testrun.create")),
    db: Session = Depends(get_db),
) -> dict:
    run = test_suite_service.create_run_from_suite(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, suite_id, req
    )
    return envelope(run_to_out(db, run).model_dump(mode="json"))
