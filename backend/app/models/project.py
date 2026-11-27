import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class Project(Base, TenantScopedMixin):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(
            "status in ('On Track','At Risk','Delayed','Completed')", name="ck_projects_status"
        ),
        CheckConstraint(
            "priority in ('Low','Medium','High','Critical')", name="ck_projects_priority"
        ),
        CheckConstraint("end_date >= start_date", name="ck_projects_date_order"),
        CheckConstraint("budget >= 0", name="ck_projects_budget_non_negative"),
        Index("uq_projects_tenant_name_ci", "tenant_id", text("lower(name)"), unique=True),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    # ADR-139: one of the organization's domains, checked by the service. Optional, like
    # the other details below.
    domain: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[str] = mapped_column(String, nullable=False)
    manager_name: Mapped[str | None] = mapped_column(String, nullable=True)
    manager_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    budget: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    region: Mapped[str | None] = mapped_column(String, nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Optimistic concurrency control (GAP-68): incremented on every update.
    # A caller may pass ProjectUpdateRequest.expected_version to detect a
    # concurrent edit (409) instead of silently losing their write.
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    # ADR-140: set while archived. The database refuses writes to the project's records.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # ADR-122: optional project-tab order and hidden tabs, `{"order": [...], "hidden": [...]}`,
    # validated against an allowlist by ProjectUpdateRequest. NULL = the default tab set.
    nav_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ProjectMember(Base):
    __tablename__ = "project_members"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Project-scoped role override (RBAC Phase 1): null (the default, every
    # pre-existing row) means the member's permissions on this project are
    # exactly their tenant-wide role's permissions, unchanged. When set,
    # this role's permissions apply INSTEAD, but only for actions scoped to
    # this one project -- see app.core.auth.get_effective_permissions_for_project.
    # ON DELETE SET NULL: deleting the role a member was overridden to
    # silently reverts them to their tenant-wide role rather than erroring.
    role_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
