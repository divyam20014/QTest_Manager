import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class AuditLog(Base, TenantScopedMixin):
    """Insert-only, hash-chained (ADR-006). No service method may UPDATE or
    DELETE a row; DB grants additionally revoke those privileges for the
    application role."""

    __tablename__ = "audit_logs"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # Tier 0 / ADR-052: platform-admin actions (tenant provisioning/status
    # changes) previously recorded user_id=None with no individual
    # attribution at all, since PlatformAdmin isn't a `users` row. Separate
    # nullable FK rather than widening user_id's FK target, since the two
    # identities are deliberately distinct planes (ADR-008) and a row is
    # attributed to exactly one of them, never both.
    platform_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_admins.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    prev_hash: Mapped[str] = mapped_column(String, nullable=False)
    record_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
