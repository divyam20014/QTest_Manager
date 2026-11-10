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


class Requirement(Base, TenantScopedMixin):
    """Authoring-level document, mirroring TestCase's model shape (ADR-001):
    edit history lives entirely in RequirementVersion, never mutated here
    beyond the denormalized title/current_version_id pointer."""

    __tablename__ = "requirements"
    __table_args__ = (
        CheckConstraint("char_length(title) >= 5", name="ck_requirements_title_len"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "requirement_versions.id", use_alter=True, name="fk_requirements_current_version_id"
        ),
        nullable=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RequirementVersion(Base, TenantScopedMixin):
    """Immutable snapshot, created on every edit -- no draft/approved
    workflow for requirements (unlike TestCase), so every edit forks a new
    version rather than conditionally mutating in place."""

    __tablename__ = "requirement_versions"
    __table_args__ = (
        UniqueConstraint("requirement_id", "version_number", name="uq_requirement_versions_number"),
    )

    requirement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirements.id"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="", server_default="")
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RequirementTestCaseLink(Base, TenantScopedMixin):
    """Requirement <-> TestCase mapping (RTM). Links the requirement itself,
    not a specific version -- coverage asks "does this requirement have a
    test case," not "does this exact wording of it.\""""

    __tablename__ = "requirement_test_case_links"
    __table_args__ = (
        UniqueConstraint(
            "requirement_id", "test_case_id", name="uq_requirement_test_case_links"
        ),
    )

    requirement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirements.id"), nullable=False
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False
    )
    linked_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
