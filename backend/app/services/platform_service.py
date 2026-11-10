from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError
from app.core.security import hash_password
from app.models.identity import Role, User
from app.models.subscription import Plan, Subscription
from app.models.tenant import Tenant
from app.schemas.platform import TenantCreateRequest
from app.services import field_option_service

# Tier 1 / ADR-053: every tenant starts on this plan -- seeded by migration
# c2d3e4f5a6b7, never absent.
_DEFAULT_PLAN_CODE = "trial"


def create_tenant_with_admin(
    db: Session, req: TenantCreateRequest, platform_admin_id: UUID | None = None
) -> tuple[Tenant, User]:
    """Bootstraps a tenant and its first Admin user (ADR-008). Not reachable
    from the ordinary tenant Admin role -- platform-owner-only."""
    # Creating a tenant here is itself the platform admin's approval
    # decision -- there is no separate self-service signup flow that would
    # need a distinct, later review step. "pending" exists for a future
    # self-service path (ADR-032); the only path that exists today is
    # provisioned directly by a platform admin, so it starts approved.
    tenant = Tenant(name=req.tenant_name, status="approved", data_region=req.data_region)
    db.add(tenant)
    db.flush()

    set_tenant_context(db, str(tenant.id))

    admin_role_id = db.execute(select(Role.id).where(Role.code == "admin")).scalar_one()
    admin = User(
        tenant_id=tenant.id,
        email=req.admin_email,
        name=req.admin_name,
        role_id=admin_role_id,
        password_hash=hash_password(req.admin_password),
    )
    db.add(admin)
    db.flush()

    # Tier 1 / ADR-053: every tenant gets a default Trial subscription at
    # creation, not only the migration's one-time backfill of
    # pre-existing tenants -- otherwise every tenant created after that
    # migration would be left without one.
    default_plan_id = db.execute(
        select(Plan.id).where(Plan.code == _DEFAULT_PLAN_CODE)
    ).scalar_one()
    db.add(Subscription(tenant_id=tenant.id, plan_id=default_plan_id, status="trialing"))
    db.flush()

    # Tier 5 / ADR-055: same "every tenant gets this at birth" pattern as
    # the subscription above -- seeds the four severity/priority defaults
    # that used to be hardcoded, so nothing changes unless an admin acts.
    field_option_service.seed_defaults_for_tenant(db, tenant.id)

    record_audit_event(
        db,
        tenant_id=tenant.id,
        user_id=None,
        platform_admin_id=platform_admin_id,
        action="tenant.created",
        entity_type="tenant",
        entity_id=tenant.id,
        metadata={"name": tenant.name},
    )
    record_audit_event(
        db,
        tenant_id=tenant.id,
        user_id=admin.id,
        action="user.created",
        entity_type="user",
        entity_id=admin.id,
        metadata={"email": req.admin_email, "role": "admin", "bootstrap": True},
    )
    db.commit()
    return tenant, admin


def list_tenants(db: Session) -> list[Tenant]:
    return list(db.execute(select(Tenant).order_by(Tenant.created_at)).scalars())


def update_tenant_status(
    db: Session, tenant_id: UUID, status: str, platform_admin_id: UUID | None = None
) -> Tenant:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("Tenant not found")

    tenant.status = status
    set_tenant_context(db, str(tenant.id))
    record_audit_event(
        db,
        tenant_id=tenant.id,
        user_id=None,
        platform_admin_id=platform_admin_id,
        action="tenant.status_changed",
        entity_type="tenant",
        entity_id=tenant.id,
        metadata={"status": status},
    )
    db.commit()
    return tenant


def update_tenant_data_region(
    db: Session, tenant_id: UUID, data_region: str, platform_admin_id: UUID | None = None
) -> Tenant:
    """Tier 4 / ADR-054 (PV-11.6): platform-admin-only, never tenant-admin
    settable -- this is readiness metadata, not a feature a tenant can
    self-service without an actual region-aware deployment behind it."""
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("Tenant not found")

    old_region = tenant.data_region
    tenant.data_region = data_region
    set_tenant_context(db, str(tenant.id))
    record_audit_event(
        db,
        tenant_id=tenant.id,
        user_id=None,
        platform_admin_id=platform_admin_id,
        action="tenant.data_region_changed",
        entity_type="tenant",
        entity_id=tenant.id,
        metadata={"data_region": {"from": old_region, "to": data_region}},
    )
    db.commit()
    return tenant


def clear_ip_allowlist(
    db: Session, tenant_id: UUID, platform_admin_id: UUID | None = None
) -> Tenant:
    """Gap-closure pass (ADR-057): a genuine recovery path for the
    self-lockout risk Tier 4 disclosed (an admin excluding their own
    network has no in-app recovery). Platform admins are a deliberately
    separate, tenant-independent auth plane (ADR-008) -- the natural
    "break glass" authority, since they can act even when every tenant
    user is locked out. Audit-logged distinctly from an ordinary settings
    change since clearing a security control is itself security-relevant."""
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("Tenant not found")

    had_allowlist = bool(tenant.ip_allowlist)
    tenant.ip_allowlist = None
    set_tenant_context(db, str(tenant.id))
    record_audit_event(
        db,
        tenant_id=tenant.id,
        user_id=None,
        platform_admin_id=platform_admin_id,
        action="tenant.ip_allowlist_cleared_by_platform_admin",
        entity_type="tenant",
        entity_id=tenant.id,
        metadata={"had_allowlist": had_allowlist},
    )
    db.commit()
    return tenant
