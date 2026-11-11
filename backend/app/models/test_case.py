import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
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


class TestCase(Base, TenantScopedMixin):
    """Authoring-level document (ADR-001). Execution state lives on
    test_run_cases/execution_steps, never here."""

    __tablename__ = "test_cases"
    __table_args__ = (
        CheckConstraint("char_length(title) >= 5", name="ck_test_cases_title_len"),
        CheckConstraint(
            "status in ('draft','ready_for_review','approved','deprecated')",
            name="ck_test_cases_status",
        ),
        CheckConstraint(
            "priority in ('Low','Medium','High','Critical')", name="ck_test_cases_priority"
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="draft", server_default="draft"
    )
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # Tier 3 (PV-7.3): optional module/folder grouping.
    module_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_modules.id"), nullable=True
    )
    # Tier 3: review-request/approval workflow. Narrows who may act on a
    # 'ready_for_review' case via approve/request_changes to this specific
    # user when set (falls back to anyone holding testcase.approve when
    # null, preserving today's behavior for callers that don't name a
    # reviewer).
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "test_case_versions.id", use_alter=True, name="fk_test_cases_current_version_id"
        ),
        nullable=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TestCaseVersion(Base, TenantScopedMixin):
    """Immutable snapshot (ADR-003). Never updated once created."""

    __tablename__ = "test_case_versions"
    __table_args__ = (
        UniqueConstraint("test_case_id", "version_number", name="uq_test_case_versions_number"),
    )

    test_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="", server_default="")
    # Pass 2 (UI/UX + schema realignment): free-text spreadsheet-style
    # fields, versioned alongside title/description/steps per ADR-003's
    # immutable-snapshot model -- all optional, no workflow logic attached.
    scenario_id: Mapped[str | None] = mapped_column(String, nullable=True)
    scenario_description: Mapped[str | None] = mapped_column(String, nullable=True)
    prerequisite: Mapped[str | None] = mapped_column(String, nullable=True)
    test_data: Mapped[str | None] = mapped_column(String, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TestCaseVersionStep(Base, TenantScopedMixin):
    """The join key used everywhere a step is referenced (ADR-002) — never a
    bare array index."""

    __tablename__ = "test_case_version_steps"
    __table_args__ = (
        UniqueConstraint("test_case_version_id", "step_number", name="uq_tcv_steps_number"),
        CheckConstraint("char_length(action) > 0", name="ck_tcv_steps_action_not_empty"),
        CheckConstraint("char_length(expected) > 0", name="ck_tcv_steps_expected_not_empty"),
    )

    test_case_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_case_versions.id"), nullable=False
    )
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    expected: Mapped[str] = mapped_column(String, nullable=False)


class Attachment(Base, TenantScopedMixin):
    """Generic polymorphic file metadata; bytes live on disk (ADR-012)."""

    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint(
            "owner_type in ('test_case','test_case_version','defect','execution_step')",
            name="ck_attachments_owner_type",
        ),
    )

    owner_type: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
