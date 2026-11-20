import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class AccessRule(Base, TenantScopedMixin):
    """RBAC Phase 4 (ADR-092): a tenant-configured time/environment rule that
    blocks matching mutating actions for non-exempt roles. Off by default: a
    tenant with no rows here behaves exactly as before. RLS-protected like
    every tenant table.
    """

    __tablename__ = "access_rules"
    __table_args__ = (
        CheckConstraint(
            "rule_type IN ('freeze_window','environment_restriction')",
            name="ck_access_rules_rule_type",
        ),
        Index("ix_access_rules_tenant_enabled", "tenant_id", "enabled"),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    rule_type: Mapped[str] = mapped_column(String, nullable=False)
    # NULL = tenant-wide; otherwise only actions resolved to this project.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True
    )
    # environment_restriction only: case-insensitive environment name.
    environment: Mapped[str | None] = mapped_column(String, nullable=True)
    # freeze_window: the blocked window. environment_restriction: the optional
    # ALLOWED window (outside it the environment is restricted). UTC.
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    blocked_actions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    exempt_roles: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default=text("ARRAY['admin']::varchar[]")
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
