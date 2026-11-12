from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.test_data_set import (
    TestDataSetCreateRequest,
    TestDataSetRowCreateRequest,
)
from app.services import test_data_set_service

router = APIRouter(tags=["test-data-sets"])


@router.get("/test-cases/{test_case_id}/data-sets")
def list_data_sets(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    sets = test_data_set_service.list_data_sets(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope([s.model_dump(mode="json") for s in sets])


@router.post("/test-cases/{test_case_id}/data-sets")
def create_data_set(
    test_case_id: UUID,
    req: TestDataSetCreateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    ds = test_data_set_service.create_data_set(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, req
    )
    return envelope(ds.model_dump(mode="json"))


@router.delete("/data-sets/{data_set_id}")
def delete_data_set(
    data_set_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    test_data_set_service.delete_data_set(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, data_set_id
    )
    return envelope({"deleted": True})


@router.post("/data-sets/{data_set_id}/rows")
def add_row(
    data_set_id: UUID,
    req: TestDataSetRowCreateRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    ds = test_data_set_service.add_row(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, data_set_id, req
    )
    return envelope(ds.model_dump(mode="json"))


@router.delete("/data-set-rows/{row_id}")
def delete_row(
    row_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    test_data_set_service.delete_row(db, ctx.tenant_id, ctx.role_code, ctx.user_id, row_id)
    return envelope({"deleted": True})
