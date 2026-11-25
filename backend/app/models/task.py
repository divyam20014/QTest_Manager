"""ADR-127: Task / sub-task layer between Project and its artifacts.

Hierarchy rules (enforced in the database where possible, mirrored by the service):
  * a task belongs to exactly one project; a sub-task must live in its parent's project
    (composite FK ``(parent_task_id, project_id) -> tasks(id, project_id)``);
  * ``depth`` is 0 for a root task and parent.depth + 1 for a sub-task, capped at
    ``MAX_TASK_DEPTH`` (CHECK + trigger) -- a strictly increasing depth also rules out cycles;
  * a task cannot be its own parent;
  * tasks are soft-deleted (``deleted_at``) like defects and test cases.
Requirements and defects reference a task through a nullable ``task_id`` (same-project
composite FK); test cases are shared across tasks through ``task_test_case_links``.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.field_standards import MAX_TASK_DEPTH
from app.models.mixins import TenantScopedMixin


class TaskStatus(Base, TenantScopedMixin):
    """Tenant-configurable task workflow status. ``category`` is the fixed, code-known
    meaning (todo / in_progress / done) that rollups, overdue logic and completion rules
    rely on; ``code``, ``label``, ``color`` and order are the tenant's to change."""

    __tablename__ = "task_statuses"
    __table_args__ = (
        CheckConstraint(
            "category in ('todo','in_progress','done')", name="ck_task_statuses_category"
        ),
        UniqueConstraint("tenant_id", "code", name="uq_task_statuses_tenant_code"),
    )

    code: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Task(Base, TenantScopedMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("char_length(title) between 3 and 255", name="ck_tasks_title_len"),
        CheckConstraint(f"depth between 0 and {MAX_TASK_DEPTH}", name="ck_tasks_depth"),
        CheckConstraint(
            "(parent_task_id is null and depth = 0) or (parent_task_id is not null and depth > 0)",
            name="ck_tasks_parent_vs_depth",
        ),
        CheckConstraint("parent_task_id is distinct from id", name="ck_tasks_not_own_parent"),
        CheckConstraint(
            "start_date is null or due_date is null or start_date <= due_date",
            name="ck_tasks_date_order",
        ),
        UniqueConstraint("id", "project_id", name="uq_tasks_id_project"),
        ForeignKeyConstraint(
            ["parent_task_id", "project_id"],
            ["tasks.id", "tasks.project_id"],
            name="fk_tasks_parent_same_project",
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Human-readable id TASK_000001 (display_id_service, kind 'task'); immutable (DB trigger).
    display_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    display_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_statuses.id"), nullable=False
    )
    # field_options key 'task_priority' (tenant-configurable), validated in the service.
    priority: Mapped[str] = mapped_column(String, nullable=False, server_default="Medium")
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    release_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("releases.id"), nullable=True
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # ADR-128: the project's "Unassigned requirements" task, where a requirement lands when it is
    # created without a task or loses its task. At most one per project; it cannot be deleted or
    # moved and takes no sub-tasks.
    is_requirements_home: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )


class TaskTestCaseLink(Base, TenantScopedMixin):
    """Task <-> TestCase (many-to-many: a test case can verify several tasks)."""

    __tablename__ = "task_test_case_links"
    __table_args__ = (UniqueConstraint("task_id", "test_case_id", name="uq_task_test_case_links"),)

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=False
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False
    )
    linked_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
