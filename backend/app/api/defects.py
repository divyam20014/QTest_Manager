from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.defect import (
    DefectCreateRequest,
    DefectLinkCreateRequest,
    DefectStatusUpdateRequest,
)
from app.services import defect_service

router = APIRouter(prefix="/defects", tags=["defects"])


@router.get("")
def list_defects(
    project_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    test_run_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defects = defect_service.list_defects(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, status, severity, test_run_id
    )
    return envelope([defect_service.to_out(db, d).model_dump(mode="json") for d in defects])


@router.post("")
def create_defect(
    req: DefectCreateRequest,
    ctx: SessionContext = Depends(require_permission("defect.create")),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.create_defect(db, ctx.tenant_id, ctx.role_code, ctx.user_id, req)
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.get("/{defect_id}")
def get_defect(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.get_defect(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id)
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.patch("/{defect_id}/status")
def update_status(
    defect_id: UUID,
    req: DefectStatusUpdateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.update_status(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, req.status
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.post("/{defect_id}/links")
def add_link(
    defect_id: UUID,
    req: DefectLinkCreateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.add_link(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, req)
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))
