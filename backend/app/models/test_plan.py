import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class TestPlan(Base, TenantScopedMixin):
    """Pass 5 item 3: a higher-level container grouping one or more
    TestRuns under a single planning umbrella (e.g. "Release 2.0 Test
    Plan" containing a Smoke Run, a Regression Run, and a Sanity Run).
    Distinct from Release (Tier 2, a version/release marker tracked on
    defects) -- a Plan may optionally reference a Release for
    traceability, but a Plan's purpose is grouping runs, not marking a
    shipped version."""

    __tablename__ = "test_plans"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    release_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("releases.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TestPlanRun(Base, TenantScopedMixin):
    """A TestRun's membership in a TestPlan."""

    __tablename__ = "test_plan_runs"
    __table_args__ = (
        UniqueConstraint("test_plan_id", "test_run_id", name="uq_test_plan_runs_plan_run"),
    )

    test_plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_plans.id"), nullable=False
    )
    test_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_runs.id"), nullable=False
    )
