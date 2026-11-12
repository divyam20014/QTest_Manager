import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class TestDataSet(Base, TenantScopedMixin):
    """Pass 5 item 2: a named collection of parameter rows for executing a
    single test case multiple times with different input data (e.g. a login
    test run once with valid credentials, once with invalid ones).

    Distinct from Tier 2's synthetic test-data generation/masking utility --
    this is about *parameterized execution*, not generating/masking seed
    data for an environment."""

    __tablename__ = "test_data_sets"

    test_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TestDataSetRow(Base, TenantScopedMixin):
    """One parameter row within a TestDataSet. `data` is a free-form JSON
    object (key -> value) -- different test cases need different
    parameters, so no fixed schema is imposed."""

    __tablename__ = "test_data_set_rows"

    test_data_set_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_data_sets.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
