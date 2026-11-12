import uuid
from datetime import datetime

from sqlalchemy import (
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
from app.models.mixins import TenantScopedMixin


class TestRun(Base, TenantScopedMixin):
    __tablename__ = "test_runs"
    __table_args__ = (
        CheckConstraint("char_length(name) >= 3", name="ck_test_runs_name_len"),
        CheckConstraint("run_type in ('Regression','Sanity','Smoke')", name="ck_test_runs_type"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    run_type: Mapped[str] = mapped_column(String, nullable=False)
    executed_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TestRunCase(Base, TenantScopedMixin):
    """Bundles a test case into a run, pinned to the exact version (ADR-003)."""

    __tablename__ = "test_run_cases"
    __table_args__ = (
        # Pass 5 item 2: the old (test_run_id, test_case_id) unique pair is
        # widened to include test_data_row_id. Postgres treats NULL as
        # distinct in a unique constraint, so an un-parameterized case
        # (test_data_row_id IS NULL) still can't be bundled twice -- the
        # original invariant holds exactly as before -- while a
        # parameterized case can have one TestRunCase per selected data row.
        UniqueConstraint(
            "test_run_id",
            "test_case_id",
            "test_data_row_id",
            name="uq_test_run_cases_run_case_row",
        ),
        CheckConstraint(
            "status in ('pending','in_progress','passed','failed','blocked','ignored')",
            name="ck_test_run_cases_status",
        ),
    )

    test_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_runs.id"), nullable=False
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False
    )
    test_case_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_case_versions.id"), nullable=False
    )
    test_data_row_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_data_set_rows.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="pending", server_default="pending"
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ExecutionStep(Base, TenantScopedMixin):
    """Authoritative per-step verdict + timing record (ADR-004)."""

    __tablename__ = "execution_steps"
    __table_args__ = (
        UniqueConstraint(
            "test_run_case_id", "test_case_version_step_id", name="uq_execution_steps_case_step"
        ),
        CheckConstraint("verdict in ('pass','fail','ignore')", name="ck_execution_steps_verdict"),
    )

    test_run_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_run_cases.id"), nullable=False
    )
    test_case_version_step_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_case_version_steps.id"), nullable=False
    )
    verdict: Mapped[str | None] = mapped_column(String, nullable=True)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    executed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
