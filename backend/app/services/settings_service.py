from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.crypto import encrypt_secret
from app.core.errors import NotFoundError, ValidationAppError
from app.core.storage import get_storage_backend
from app.models.tenant import Tenant
from app.schemas.settings import (
    TenantBrandingOut,
    TenantBrandingUpdateRequest,
    TenantSettingsOut,
    TenantSettingsUpdateRequest,
)


def _get_tenant_or_404(db: Session, tenant_id: UUID) -> Tenant:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("Tenant not found")
    return tenant


def to_out(tenant: Tenant) -> TenantSettingsOut:
    return TenantSettingsOut(
        default_currency_code=tenant.default_currency_code,
        default_timezone=tenant.default_timezone,
        ai_enabled=tenant.ai_enabled,
        ai_provider=tenant.ai_provider,
        ai_api_key_configured=tenant.ai_api_key_encrypted is not None,
        ip_allowlist=tenant.ip_allowlist or [],
    )


def get_settings(db: Session, tenant_id: UUID) -> TenantSettingsOut:
    return to_out(_get_tenant_or_404(db, tenant_id))


def update_settings(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: TenantSettingsUpdateRequest
) -> TenantSettingsOut:
    tenant = _get_tenant_or_404(db, tenant_id)

    changes: dict[str, dict[str, object]] = {}
    new_currency = req.default_currency_code
    if new_currency is not None and new_currency != tenant.default_currency_code:
        changes["default_currency_code"] = {
            "from": tenant.default_currency_code,
            "to": new_currency,
        }
        tenant.default_currency_code = new_currency
    new_timezone = req.default_timezone
    if new_timezone is not None and new_timezone != tenant.default_timezone:
        changes["default_timezone"] = {"from": tenant.default_timezone, "to": new_timezone}
        tenant.default_timezone = new_timezone

    if req.ai_api_key is not None:
        was_configured = tenant.ai_api_key_encrypted is not None
        if req.ai_api_key == "":
            tenant.ai_api_key_encrypted = None
        else:
            tenant.ai_api_key_encrypted = encrypt_secret(req.ai_api_key)
        is_configured = tenant.ai_api_key_encrypted is not None
        if is_configured != was_configured:
            # Never log the raw key -- only whether one is now configured.
            changes["ai_api_key_configured"] = {"from": was_configured, "to": is_configured}
        if not is_configured and tenant.ai_enabled and req.ai_enabled is None:
            # Clearing the only key AI generation can use: auto-disable
            # rather than leave the tenant in an "enabled but unusable"
            # state (unless this same request explicitly sets ai_enabled).
            changes["ai_enabled"] = {"from": True, "to": False}
            tenant.ai_enabled = False

    if req.ai_enabled is not None and req.ai_enabled != tenant.ai_enabled:
        if req.ai_enabled and tenant.ai_api_key_encrypted is None:
            raise ValidationAppError(
                "An AI provider API key must be configured before enabling AI."
            )
        changes["ai_enabled"] = {"from": tenant.ai_enabled, "to": req.ai_enabled}
        tenant.ai_enabled = req.ai_enabled

    if req.ip_allowlist is not None:
        new_allowlist = req.ip_allowlist or None
        if new_allowlist != (tenant.ip_allowlist or None):
            changes["ip_allowlist"] = {"from": tenant.ip_allowlist, "to": new_allowlist}
            tenant.ip_allowlist = new_allowlist

    if changes:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="tenant.settings_updated",
            entity_type="tenant",
            entity_id=tenant_id,
            metadata=changes,
        )
        db.commit()

    return to_out(tenant)


# Tier 4 / ADR-054: tenant branding (PV-11.4), reusing this same
# tenant-settings mechanism and Tier 1's storage abstraction for the logo
# -- not a parallel upload path.


def get_branding(db: Session, tenant_id: UUID) -> TenantBrandingOut:
    tenant = _get_tenant_or_404(db, tenant_id)
    return TenantBrandingOut(
        display_name=tenant.brand_display_name,
        primary_color=tenant.brand_primary_color,
        has_logo=tenant.brand_logo_ref is not None,
    )


def update_branding(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: TenantBrandingUpdateRequest
) -> TenantBrandingOut:
    tenant = _get_tenant_or_404(db, tenant_id)
    changes: dict[str, dict[str, object]] = {}
    if req.display_name is not None and req.display_name != tenant.brand_display_name:
        changes["brand_display_name"] = {"from": tenant.brand_display_name, "to": req.display_name}
        tenant.brand_display_name = req.display_name or None
    if req.primary_color != tenant.brand_primary_color:
        changes["brand_primary_color"] = {
            "from": tenant.brand_primary_color,
            "to": req.primary_color,
        }
        tenant.brand_primary_color = req.primary_color

    if changes:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="tenant.branding_updated",
            entity_type="tenant",
            entity_id=tenant_id,
            metadata=changes,
        )
        db.commit()

    return get_branding(db, tenant_id)


_LOGO_MAX_BYTES = 2 * 1024 * 1024
_LOGO_ALLOWED_MIME_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}


def upload_logo(
    db: Session, tenant_id: UUID, actor_user_id: UUID, contents: bytes, mime_type: str
) -> TenantBrandingOut:
    if mime_type not in _LOGO_ALLOWED_MIME_TYPES:
        raise ValidationAppError(f"Unsupported logo image type: {mime_type}")
    if len(contents) > _LOGO_MAX_BYTES:
        raise ValidationAppError("Logo image exceeds the 2MB size limit")

    tenant = _get_tenant_or_404(db, tenant_id)
    storage = get_storage_backend()
    old_ref = tenant.brand_logo_ref
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp"}[
        mime_type
    ]
    new_ref = storage.save(f"tenants/{tenant_id}/branding/logo.{ext}", contents)
    tenant.brand_logo_ref = new_ref
    tenant.brand_logo_mime_type = mime_type

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="tenant.branding_updated",
        entity_type="tenant",
        entity_id=tenant_id,
        metadata={"brand_logo": {"from": old_ref is not None, "to": True}},
    )
    db.commit()
    if old_ref and old_ref != new_ref:
        storage.delete(old_ref)
    return get_branding(db, tenant_id)


def get_logo(db: Session, tenant_id: UUID) -> tuple[bytes, str] | None:
    tenant = _get_tenant_or_404(db, tenant_id)
    if tenant.brand_logo_ref is None:
        return None
    storage = get_storage_backend()
    mime_type = tenant.brand_logo_mime_type or "image/png"
    return storage.read(tenant.brand_logo_ref), mime_type
