import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin, UUIDPKMixin


class Plan(Base, UUIDPKMixin):
    """Tier 1 / ADR-053: subscription-plan catalog (SR-3, SAAS-GAP-1).

    Platform-wide, not tenant-owned -- no tenant_id, no RLS, same category
    as Role/Permission. Schema/admin-assignment only: no payment gateway,
    no billing engine. Limits are nullable = unlimited.
    """

    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    seat_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_limit_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_monthly_request_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Subscription(Base, TenantScopedMixin):
    """One row per tenant (Tier 1 / ADR-053). Platform-admin-assigned only;
    the tenant side is read-only (GET /settings/subscription)."""

    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(
            "status in ('trialing','active','past_due','canceled')", name="ck_subscriptions_status"
        ),
        UniqueConstraint("tenant_id", name="uq_subscriptions_tenant_id"),
    )

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plans.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="trialing", server_default="trialing"
    )
    seat_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    current_period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
