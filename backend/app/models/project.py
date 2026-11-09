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
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class Project(Base, TenantScopedMixin):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(
            "domain in ('Motor','Health','Travel','Life','Property')", name="ck_projects_domain"
        ),
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
    domain: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[str] = mapped_column(String, nullable=False)
    manager_name: Mapped[str] = mapped_column(String, nullable=False)
    manager_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    budget: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    region: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Optimistic concurrency control (GAP-68): incremented on every update.
    # A caller may pass ProjectUpdateRequest.expected_version to detect a
    # concurrent edit (409) instead of silently losing their write.
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))


class ProjectMember(Base):
    __tablename__ = "project_members"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
