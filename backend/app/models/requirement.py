import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
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
from app.models.mixins import TenantScopedMixin


class Requirement(Base, TenantScopedMixin):
    """Authoring-level document, mirroring TestCase's model shape (ADR-001):
    edit history lives entirely in RequirementVersion, never mutated here
    beyond the denormalized title/current_version_id pointer."""

    __tablename__ = "requirements"
    __table_args__ = (
        CheckConstraint("char_length(title) >= 5", name="ck_requirements_title_len"),
        CheckConstraint("status in ('draft','approved','retired')", name="ck_requirements_status"),
        ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["tasks.id", "tasks.project_id"],
            name="fk_requirements_task_same_project",
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    # ADR-127/128: the owning task (same project, composite FK). Never empty: a requirement
    # created without one is filed under the project's "Unassigned requirements" task.
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    # ADR-148: REQ_000001, immutable once assigned (DB trigger).
    display_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    display_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Both are field_options values (tenant-configurable), validated in the service.
    requirement_type: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="Functional"
    )
    priority: Mapped[str] = mapped_column(String(64), nullable=False, server_default="Medium")
    status: Mapped[str] = mapped_column(String(64), nullable=False, server_default="draft")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # ADR-136: moves with every saved change.
    row_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # A deleted requirement is hidden (models/soft_delete.py) and keeps its history.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
        UniqueConstraint("id", "requirement_id", name="uq_requirement_versions_id_requirement"),
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


class RequirementAcceptanceCriterion(Base, TenantScopedMixin):
    """ADR-149: how to tell the requirement is met. Part of a version, so it is never edited."""

    __tablename__ = "requirement_acceptance_criteria"
    __table_args__ = (
        UniqueConstraint(
            "requirement_version_id", "position", name="uq_acceptance_criteria_position"
        ),
    )

    requirement_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirement_versions.id"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)


class RequirementTestCaseLink(Base, TenantScopedMixin):
    """Requirement <-> TestCase mapping (RTM). Coverage asks "does this requirement have a
    test case"; the version says which wording the case was last agreed to cover (ADR-150)."""

    __tablename__ = "requirement_test_case_links"
    __table_args__ = (
        UniqueConstraint("requirement_id", "test_case_id", name="uq_requirement_test_case_links"),
    )

    requirement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirements.id"), nullable=False
    )
    test_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False
    )
    # Both are versions of this requirement (composite FKs). The first is empty only for a link
    # made before versions were recorded; the second is then the version that was current when
    # recording began.
    requirement_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirement_versions.id"), nullable=True
    )
    unrecorded_baseline_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirement_versions.id"), nullable=True
    )
    linked_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
