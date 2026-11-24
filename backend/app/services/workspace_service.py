"""ADR-125: read and replace the tenant's workspace defaults."""

from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import NotFoundError
from app.models.tenant import Tenant
from app.schemas.workspace import WorkspaceConfig


def _tenant(db: Session, tenant_id: UUID) -> Tenant:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("Tenant not found")
    return tenant


def _load(raw: object) -> WorkspaceConfig:
    """The stored document, or the built-in defaults when unset or no longer valid (a stale
    value must never break the shell for everyone)."""
    if not raw:
        return WorkspaceConfig()
    try:
        return WorkspaceConfig.model_validate(raw)
    except ValidationError:
        return WorkspaceConfig()


def get_workspace(db: Session, tenant_id: UUID) -> WorkspaceConfig:
    return _load(_tenant(db, tenant_id).workspace_config)


def replace_workspace(
    db: Session, tenant_id: UUID, actor_user_id: UUID, config: WorkspaceConfig
) -> WorkspaceConfig:
    tenant = _tenant(db, tenant_id)
    before = _load(tenant.workspace_config)
    # Defaults are stored as NULL so "Reset to defaults" leaves no residue.
    tenant.workspace_config = None if config.is_default() else config.model_dump(mode="json")
    if before != config:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="tenant.workspace_updated",
            entity_type="tenant",
            entity_id=tenant_id,
            metadata={
                "from": before.model_dump(mode="json"),
                "to": config.model_dump(mode="json"),
            },
        )
    db.commit()
    return config
