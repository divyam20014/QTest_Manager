from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError
from app.core.security import hash_password
from app.models.identity import Role, User
from app.models.tenant import Tenant
from app.schemas.platform import TenantCreateRequest


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
    tenant = Tenant(name=req.tenant_name, status="approved")
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
