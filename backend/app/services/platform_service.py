from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, NotFoundError
from app.core.logging import logger
from app.core.security import hash_password
from app.models.identity import PlatformAdmin, Role, User
from app.models.identity import Session as SessionModel
from app.models.subscription import Plan, Subscription
from app.models.tenant import Tenant
from app.schemas.platform import PlatformAdminCreateRequest, TenantCreateRequest
from app.services import field_option_service

# Tier 1 / ADR-053: every tenant starts on this plan -- seeded by migration
# c2d3e4f5a6b7, never absent.
_DEFAULT_PLAN_CODE = "trial"

# Platform Admin UI/UX pass: statuses that must immediately kick out any
# already-logged-in users at that tenant, not just block future logins.
_SESSION_REVOKING_STATUSES = {"suspended", "inactive"}

DEFAULT_PAGE_SIZE = 25


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


def list_tenants(
    db: Session,
    search: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[Tenant], int]:
    query = select(Tenant)
    count_query = select(func.count()).select_from(Tenant)

    if search:
        like = f"%{search}%"
        # Matches by name or by id-as-text, so a pasted UUID still finds
        # the row -- the UI shows both fields in the same cell.
        name_or_id = or_(Tenant.name.ilike(like), cast(Tenant.id, String).ilike(like))
        query = query.where(name_or_id)
        count_query = count_query.where(name_or_id)
    if status:
        query = query.where(Tenant.status == status)
        count_query = count_query.where(Tenant.status == status)

    total = db.execute(count_query).scalar_one()
    tenants = list(
        db.execute(
            query.order_by(Tenant.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        ).scalars()
    )
    return tenants, total


def update_tenant_status(
    db: Session, tenant_id: UUID, status: str, platform_admin_id: UUID | None = None
) -> Tenant:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("Tenant not found")

    old_status = tenant.status
    tenant.status = status
    set_tenant_context(db, str(tenant.id))

    sessions_revoked = 0
    if status in _SESSION_REVOKING_STATUSES and old_status != status:
        # Closes a real gap: suspending/deactivating a tenant previously
        # only blocked *future* logins -- anyone already signed in stayed
        # signed in until their session naturally expired.
        now = datetime.now(UTC)
        result = db.execute(
            select(SessionModel).where(
                SessionModel.tenant_id == tenant_id, SessionModel.revoked_at.is_(None)
            )
        )
        for session_row in result.scalars():
            session_row.revoked_at = now
            sessions_revoked += 1

    record_audit_event(
        db,
        tenant_id=tenant.id,
        user_id=None,
        platform_admin_id=platform_admin_id,
        action="tenant.status_changed",
        entity_type="tenant",
        entity_id=tenant.id,
        metadata={
            "status": {"from": old_status, "to": status},
            "sessions_revoked": sessions_revoked,
        },
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


# Platform Admin UI/UX pass: platform-admin self-management, closing the
# gap where the only way to provision/deactivate one was the out-of-band
# scripts/seed_platform_admin.py script. That script's own create/update
# logic is reused here (via `upsert_platform_admin`) rather than
# duplicated, so the CLI and this API path can never drift apart.
#
# Note: PlatformAdmin actions here are NOT written to audit_logs.
# audit_logs.tenant_id is NOT NULL (every row belongs to exactly one
# tenant, ADR-007's TenantScopedMixin) and platform-admin self-management
# has no tenant to attribute to -- same limitation already noted for
# POST /auth/identify in ADR-067. These events are recorded via the
# existing `logger` security_event convention instead (see
# app/core/platform_auth.py for the same pattern).


def list_platform_admins(
    db: Session, page: int = 1, page_size: int = DEFAULT_PAGE_SIZE
) -> tuple[list[PlatformAdmin], int]:
    total = db.execute(select(func.count()).select_from(PlatformAdmin)).scalar_one()
    admins = list(
        db.execute(
            select(PlatformAdmin)
            .order_by(PlatformAdmin.created_at)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).scalars()
    )
    return admins, total


def upsert_platform_admin(db: Session, email: str, password: str) -> PlatformAdmin:
    """Shared by scripts/seed_platform_admin.py and POST /platform/admins --
    one implementation, so the CLI bootstrap path and the API path can
    never silently diverge."""
    existing = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == email)
    ).scalar_one_or_none()
    if existing is not None:
        existing.password_hash = hash_password(password)
        existing.is_active = True
        existing.failed_login_count = 0
        existing.locked_until = None
        db.commit()
        return existing

    admin = PlatformAdmin(email=email, password_hash=hash_password(password))
    db.add(admin)
    db.commit()
    return admin


def create_platform_admin(
    db: Session, req: PlatformAdminCreateRequest, actor_admin_id: UUID
) -> PlatformAdmin:
    admin = upsert_platform_admin(db, req.email, req.password)
    logger.warning(
        "security_event=platform_admin_created email=%s actor_admin_id=%s",
        req.email,
        actor_admin_id,
    )
    return admin


def update_platform_admin_active(
    db: Session, admin_id: UUID, is_active: bool, actor_admin_id: UUID
) -> PlatformAdmin:
    if admin_id == actor_admin_id and not is_active:
        raise ConflictError("You cannot deactivate your own platform admin account")

    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.id == admin_id)
    ).scalar_one_or_none()
    if admin is None:
        raise NotFoundError("Platform admin not found")

    admin.is_active = is_active
    db.commit()
    logger.warning(
        "security_event=platform_admin_%s email=%s actor_admin_id=%s",
        "activated" if is_active else "deactivated",
        admin.email,
        actor_admin_id,
    )
    return admin
