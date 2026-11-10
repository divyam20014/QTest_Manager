import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class TestModule(Base, TenantScopedMixin):
    """Module/folder-level grouping for test cases (PV-7.3). Self-referential
    for nesting; deleting a module reassigns its test cases and child
    modules to its own parent (never cascade-deletes test cases)."""

    __tablename__ = "test_modules"
    __table_args__ = (
        UniqueConstraint("project_id", "parent_id", "name", name="uq_test_modules_sibling_name"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_modules.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
