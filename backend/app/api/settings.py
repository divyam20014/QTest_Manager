from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.settings import TenantSettingsUpdateRequest
from app.services import settings_service, subscription_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def get_settings(
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(settings_service.get_settings(db, ctx.tenant_id).model_dump())


@router.patch("")
def update_settings(
    req: TenantSettingsUpdateRequest,
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    updated = settings_service.update_settings(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(updated.model_dump())


# Tier 1 / ADR-053: tenant-facing, read-only (assignment is platform-admin
# only, via /platform/tenants/{id}/subscription).
@router.get("/subscription")
def get_subscription(
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    sub = subscription_service.get_tenant_subscription(db, ctx.tenant_id)
    return envelope(sub.model_dump(mode="json"))
