from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.identity import User
from app.models.tenant import Tenant


def resolve_tenants_for_email(db: Session, email: str) -> list[tuple[UUID, str]]:
    """Tenant-less login (ADR-067): finds which tenant(s) an email belongs
    to, before any tenant_id is known.

    `db` MUST be a session bound to the `qtesthub_identify` engine
    (app.core.db.get_identify_db), never the ordinary RLS-scoped app
    session -- `users` is tenant-isolated by Postgres RLS, so there is no
    way to answer this question through the normal app connection.

    Returns a list of (tenant_id, tenant_name) pairs, empty if no match.
    Mirrors start_login's own matching conditions (email, is_active) so
    this never surfaces a tenant that the ordinary login flow would
    already refuse via its generic invalid-credentials error -- a
    deactivated user's tenant(s) are not revealed here either.
    """
    rows = db.execute(
        select(Tenant.id, Tenant.name, Tenant.brand_display_name)
        .join(User, User.tenant_id == Tenant.id)
        .where(User.email == email, User.is_active.is_(True))
    ).all()
    return [(tenant_id, brand_name or name) for tenant_id, name, brand_name in rows]
