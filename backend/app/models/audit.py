import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin, UUIDPKMixin


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
    # Item 2 of the post-gap-closure pass: a third distinct actor plane
    # (service tokens / CI webhooks), same reasoning as platform_admin_id
    # above -- a row is attributed to exactly one of the three, never more
    # than one.
    service_token_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service_tokens.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    prev_hash: Mapped[str] = mapped_column(String, nullable=False)
    record_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditChainCheckpoint(Base, UUIDPKMixin):
    """ADR-085: an HMAC-signed anchor over the head of one hash chain
    (scope 'platform' or 'tenant:<uuid>'). Insert-only for the app role. It holds
    only ids, counts and hashes -- never audit content -- so it has no RLS;
    the API filters by scope. No FK to tenants: it outlives its tenant."""

    __tablename__ = "audit_chain_checkpoints"

    scope: Mapped[str] = mapped_column(String, nullable=False)
    last_record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    last_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, nullable=False)
    head_hash: Mapped[str] = mapped_column(String, nullable=False)
    prev_checkpoint_hash: Mapped[str] = mapped_column(String, nullable=False)
    checkpoint_hash: Mapped[str] = mapped_column(String, nullable=False)
    signature: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
