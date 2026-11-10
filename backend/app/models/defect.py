import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class Defect(Base, TenantScopedMixin):
    __tablename__ = "defects"
    __table_args__ = (
        CheckConstraint("char_length(title) >= 5", name="ck_defects_title_len"),
        CheckConstraint(
            "severity in ('Low','Medium','High','Critical')", name="ck_defects_severity"
        ),
        CheckConstraint(
            "status in ('New','Open','Fixed','Verified','Closed')", name="ck_defects_status"
        ),
        CheckConstraint(
            "root_cause is null or root_cause in ("
            "'requirements_gap','code_defect','design_flaw','test_data_issue',"
            "'environment_issue','third_party_integration','other')",
            name="ck_defects_root_cause",
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    test_case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=True
    )
    test_case_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_case_versions.id"), nullable=True
    )
    test_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_runs.id"), nullable=True
    )
    test_case_version_step_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_case_version_steps.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="New", server_default="New")
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    actual_result: Mapped[str | None] = mapped_column(String, nullable=True)
    expected_result: Mapped[str | None] = mapped_column(String, nullable=True)
    environment: Mapped[str | None] = mapped_column(String, nullable=True)
    # Phase 6 (AI/SaaS vision roadmap, PV-6.4): a simple fixed taxonomy,
    # settable any time during triage, not required at creation.
    root_cause: Mapped[str | None] = mapped_column(String, nullable=True)
    reported_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DefectLink(Base, TenantScopedMixin):
    """Many-to-many linkage (ADR-005)."""

    __tablename__ = "defect_links"
    __table_args__ = (
        CheckConstraint(
            "linkable_type in ('execution_step','test_case','defect')",
            name="ck_defect_links_linkable_type",
        ),
        CheckConstraint(
            "link_type in ('relates_to','duplicate_of','caused_by')",
            name="ck_defect_links_link_type",
        ),
    )

    defect_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("defects.id"), nullable=False
    )
    linkable_type: Mapped[str] = mapped_column(String, nullable=False)
    linkable_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    link_type: Mapped[str] = mapped_column(
        String, nullable=False, default="relates_to", server_default="relates_to"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
