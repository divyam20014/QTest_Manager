import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class TestSuite(Base, TenantScopedMixin):
    """Pass 5 item 3: a reusable, FLAT, cross-module collection of specific
    test case references -- exists independently of any single run, meant
    to be repeatedly imported wholesale into new Test Runs. NOT a
    replacement for TestModule (which organizes where a test case
    structurally lives); a Suite is a saved, reusable *selection* that can
    freely span modules."""

    __tablename__ = "test_suites"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TestSuiteCase(Base, TenantScopedMixin):
    """A test case reference within a TestSuite."""

    __tablename__ = "test_suite_cases"
    __table_args__ = (
        UniqueConstraint("test_suite_id", "test_case_id", name="uq_test_suite_cases_suite_case"),
    )

    test_suite_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_suites.id"), nullable=False
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False
    )
