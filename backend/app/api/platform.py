from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.platform_auth import require_platform_admin
from app.core.responses import envelope
from app.models.identity import PlatformAdmin
from app.schemas.platform import (
    TenantCreateRequest,
    TenantCreateResponse,
    TenantOut,
    TenantStatusUpdateRequest,
)
from app.schemas.subscription import SubscriptionAssignRequest
from app.services import platform_service, subscription_service

router = APIRouter(prefix="/platform", tags=["platform"])


@router.post("/tenants")
def create_tenant(
    req: TenantCreateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant, created_admin = platform_service.create_tenant_with_admin(db, req, admin.id)
    return envelope(
        TenantCreateResponse(
            tenant=TenantOut.model_validate(tenant), admin_user_id=created_admin.id
        ).model_dump()
    )


@router.get("/tenants")
def list_tenants(
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenants = platform_service.list_tenants(db)
    return envelope([TenantOut.model_validate(t).model_dump() for t in tenants])


@router.patch("/tenants/{tenant_id}/status")
def update_tenant_status(
    tenant_id: UUID,
    req: TenantStatusUpdateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant = platform_service.update_tenant_status(db, tenant_id, req.status, admin.id)
    return envelope(TenantOut.model_validate(tenant).model_dump())


# Tier 1 / ADR-053: subscription schema + platform-admin assignment only --
# no payment gateway, no billing engine (SR-3, SAAS-GAP-1).
@router.get("/plans")
def list_plans(
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    return envelope([p.model_dump(mode="json") for p in subscription_service.list_plans(db)])


@router.get("/tenants/{tenant_id}/subscription")
def get_tenant_subscription(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    sub = subscription_service.get_tenant_subscription_as_platform_admin(db, tenant_id)
    return envelope(sub.model_dump(mode="json"))


@router.put("/tenants/{tenant_id}/subscription")
def assign_tenant_subscription(
    tenant_id: UUID,
    req: SubscriptionAssignRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    sub = subscription_service.assign_subscription(db, tenant_id, req, admin.id)
    return envelope(sub.model_dump(mode="json"))
