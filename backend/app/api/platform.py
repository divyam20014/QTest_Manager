from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.platform_auth import require_platform_admin
from app.core.responses import envelope
from app.schemas.platform import (
    TenantCreateRequest,
    TenantCreateResponse,
    TenantOut,
    TenantStatusUpdateRequest,
)
from app.services import platform_service

router = APIRouter(
    prefix="/platform", tags=["platform"], dependencies=[Depends(require_platform_admin)]
)


@router.post("/tenants")
def create_tenant(req: TenantCreateRequest, db: Session = Depends(get_db)) -> dict:
    tenant, admin = platform_service.create_tenant_with_admin(db, req)
    return envelope(
        TenantCreateResponse(
            tenant=TenantOut.model_validate(tenant), admin_user_id=admin.id
        ).model_dump()
    )


@router.get("/tenants")
def list_tenants(db: Session = Depends(get_db)) -> dict:
    tenants = platform_service.list_tenants(db)
    return envelope([TenantOut.model_validate(t).model_dump() for t in tenants])


@router.patch("/tenants/{tenant_id}/status")
def update_tenant_status(
    tenant_id: UUID, req: TenantStatusUpdateRequest, db: Session = Depends(get_db)
) -> dict:
    tenant = platform_service.update_tenant_status(db, tenant_id, req.status)
    return envelope(TenantOut.model_validate(tenant).model_dump())
