import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin, TenantScopedMixin


class IdempotencyKey(Base, TenantScopedMixin, CreatedAtMixin):
    """Reliability hardening (GAP-67): maps a client-supplied
    `Idempotency-Key` header, scoped to tenant+user+operation, to the
    entity it created -- so a retried or accidentally duplicated create
    request returns the original entity instead of creating a duplicate.
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "scope", "key", name="uq_idempotency_key"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    scope: Mapped[str] = mapped_column(String, nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
