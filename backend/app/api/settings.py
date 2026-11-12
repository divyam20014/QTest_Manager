from fastapi import APIRouter, Depends, File, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.errors import NotFoundError, ValidationAppError
from app.core.responses import envelope
from app.schemas.settings import TenantBrandingUpdateRequest, TenantSettingsUpdateRequest
from app.schemas.subscription import SwitchPlanRequest
from app.services import audit_service, settings_service, subscription_service

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


# Pass 2 / ADR-064: self-serve plan browsing/switching, schema+UI only --
# no payment gateway (confirmed scope). Reading the catalog needs no
# special permission beyond being an authenticated tenant member; only
# switching is gated.
@router.get("/subscription/plans")
def list_available_plans(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(
        [p.model_dump(mode="json") for p in subscription_service.list_plans_for_tenant(db)]
    )


@router.get("/subscription/usage")
def get_subscription_usage(
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(subscription_service.get_usage(db, ctx.tenant_id).model_dump())


@router.post("/subscription/switch-plan")
def switch_plan(
    req: SwitchPlanRequest,
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    sub = subscription_service.switch_plan(db, ctx.tenant_id, ctx.user_id, req.plan_code)
    return envelope(sub.model_dump(mode="json"))


@router.get("/subscription/history")
def get_subscription_history(
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    logs = audit_service.list_audit_logs(
        db, ctx.tenant_id, entity_type="subscription", limit=50
    )
    return envelope([log.model_dump(mode="json") for log in logs])


# Tier 4 / ADR-054: tenant branding (PV-11.4). Reading branding is open to
# any authenticated tenant member (the app shell needs it to render the
# header for every user, not just admins) -- only mutating it is gated.
@router.get("/branding")
def get_branding(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(settings_service.get_branding(db, ctx.tenant_id).model_dump())


@router.put("/branding")
def update_branding(
    req: TenantBrandingUpdateRequest,
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    updated = settings_service.update_branding(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(updated.model_dump())


@router.post("/branding/logo")
async def upload_logo(
    file: UploadFile = File(...),
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    contents = await file.read()
    if not file.content_type:
        raise ValidationAppError("A content type is required for the logo upload")
    updated = settings_service.upload_logo(
        db, ctx.tenant_id, ctx.user_id, contents, file.content_type
    )
    return envelope(updated.model_dump())


@router.get("/branding/logo")
def get_logo(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> Response:
    result = settings_service.get_logo(db, ctx.tenant_id)
    if result is None:
        raise NotFoundError("No logo has been uploaded for this organization")
    contents, mime_type = result
    return Response(content=contents, media_type=mime_type)
