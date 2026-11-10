from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.crypto import encrypt_secret
from app.core.errors import NotFoundError, ValidationAppError
from app.models.tenant import Tenant
from app.schemas.settings import TenantSettingsOut, TenantSettingsUpdateRequest


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
