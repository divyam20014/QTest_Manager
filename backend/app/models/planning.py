"""Phase 2: what a project's work is planned into."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin, TenantScopedMixin


class Milestone(Base, TenantScopedMixin, CreatedAtMixin):
    """ADR-145: a dated goal of one project that tasks can belong to."""

    __tablename__ = "milestones"
    __table_args__ = (
        UniqueConstraint("id", "project_id", name="uq_milestones_id_project"),
        Index("uq_milestones_project_name_ci", "project_id", text("lower(name)"), unique=True),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Sprint(Base, TenantScopedMixin, CreatedAtMixin):
    """ADR-146: a time box of one project. planned -> active -> closed, one active at a time."""

    __tablename__ = "sprints"
    __table_args__ = (
        UniqueConstraint("id", "project_id", name="uq_sprints_id_project"),
        CheckConstraint("start_date <= end_date", name="ck_sprints_date_order"),
        CheckConstraint("state in ('planned','active','closed')", name="ck_sprints_state"),
        Index("uq_sprints_project_name_ci", "project_id", text("lower(name)"), unique=True),
        Index(
            "uq_sprints_one_active_per_project",
            "project_id",
            unique=True,
            postgresql_where=text("state = 'active'"),
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    state: Mapped[str] = mapped_column(String(10), nullable=False, server_default="planned")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SprintTaskHistory(Base, TenantScopedMixin):
    """What a started sprint held: one row per task, kept after the task leaves. A sprint that
    has not started has no rows; its tasks are those whose `sprint_id` points at it."""

    __tablename__ = "sprint_task_history"
    __table_args__ = (
        UniqueConstraint("sprint_id", "task_id", name="uq_sprint_history_sprint_task"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    sprint_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sprints.id"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False
    )
    added_after_start: Mapped[bool] = mapped_column(Boolean, nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    estimate_at_add: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)
    # The estimate when the task left the sprint, or when the sprint closed.
    estimate_at_end: Mapped[Decimal | None] = mapped_column(Numeric(7, 2), nullable=True)
    done_at_close: Mapped[bool | None] = mapped_column(Boolean, nullable=True)


class TaskDependency(Base, TenantScopedMixin, CreatedAtMixin):
    """ADR-147: `depends_on_task_id` should finish before `task_id` starts. It warns; it does
    not block. The database keeps both in one project and refuses circles."""

    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint("task_id", "depends_on_task_id", name="uq_task_dependencies_pair"),
        CheckConstraint("task_id <> depends_on_task_id", name="ck_task_dependencies_not_self"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False
    )
    depends_on_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
