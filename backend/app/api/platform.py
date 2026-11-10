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
    TenantDataRegionUpdateRequest,
    TenantOut,
    TenantStatusUpdateRequest,
)
from app.schemas.subscription import (
    PlanCreateRequest,
    PlanUpdateRequest,
    SubscriptionAssignRequest,
)
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


# Tier 4 / ADR-054: data residency readiness (PV-11.6) -- metadata only,
# platform-admin-only (see platform_service.update_tenant_data_region).
@router.patch("/tenants/{tenant_id}/data-region")
def update_tenant_data_region(
    tenant_id: UUID,
    req: TenantDataRegionUpdateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant = platform_service.update_tenant_data_region(db, tenant_id, req.data_region, admin.id)
    return envelope(TenantOut.model_validate(tenant).model_dump())


# Gap-closure pass / ADR-057: break-glass recovery for the IP-allowlist
# self-lockout risk disclosed in Tier 4 -- see ADMINISTRATOR_GUIDE.md.
@router.post("/tenants/{tenant_id}/clear-ip-allowlist")
def clear_tenant_ip_allowlist(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant = platform_service.clear_ip_allowlist(db, tenant_id, admin.id)
    return envelope(TenantOut.model_validate(tenant).model_dump())


# Tier 1 / ADR-053: subscription schema + platform-admin assignment only --
# no payment gateway, no billing engine (SR-3, SAAS-GAP-1).
@router.get("/plans")
def list_plans(
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    return envelope([p.model_dump(mode="json") for p in subscription_service.list_plans(db)])


@router.post("/plans")
def create_plan(
    req: PlanCreateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    return envelope(subscription_service.create_plan(db, req).model_dump(mode="json"))


@router.patch("/plans/{plan_code}")
def update_plan(
    plan_code: str,
    req: PlanUpdateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    return envelope(subscription_service.update_plan(db, plan_code, req).model_dump(mode="json"))


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
