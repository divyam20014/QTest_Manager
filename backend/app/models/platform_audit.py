import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import UUIDPKMixin


class PlatformAuditEvent(Base, UUIDPKMixin):
    """ADR-082: insert-only, hash-chained audit trail for the Platform Admin
    plane. Platform-level (no tenant, no RLS), so it is a separate single chain
    from the per-tenant `audit_logs`. The app role has SELECT + INSERT only.
    No password, code, secret, code hash or session token is ever stored."""

    __tablename__ = "platform_audit_events"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    # No FK on purpose: the trail must outlive (and never block) admin changes.
    actor_admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String, nullable=True)
    target_admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    outcome: Mapped[str] = mapped_column(String, nullable=False)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    prev_hash: Mapped[str] = mapped_column(String, nullable=False)
    record_hash: Mapped[str] = mapped_column(String, nullable=False)
