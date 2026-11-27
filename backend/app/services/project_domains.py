"""ADR-139: which domains an organization's projects may use."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ValidationAppError
from app.models.tenant import Tenant
from app.schemas.project import DEFAULT_PROJECT_DOMAINS


def domains_of(tenant: Tenant) -> list[str]:
    """The tenant's own list, which may be empty, else the built-in one."""
    if tenant.project_domains is None:
        return list(DEFAULT_PROJECT_DOMAINS)
    return list(tenant.project_domains)


def allowed_domains(db: Session, tenant_id: UUID) -> list[str]:
    return domains_of(db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one())


def check_domain(db: Session, tenant_id: UUID, domain: str) -> None:
    allowed = allowed_domains(db, tenant_id)
    if domain not in allowed:
        choices = ", ".join(allowed) if allowed else "none; your organization uses no domains"
        message = f"'{domain}' is not one of your organization's domains ({choices})"
        raise ValidationAppError(message, fields={"domain": message})
