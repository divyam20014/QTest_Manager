import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
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
            "status in ('New','Open','Fixed','Verified','Closed',"
            "'Assigned','In Progress','Retest','Reopened','Rejected','Deferred')",
            name="ck_defects_status",
        ),
        CheckConstraint(
            "resolution is null or resolution in ('Fixed','Duplicate','Won''t Fix',"
            "'Cannot Reproduce','By Design','Not Applicable')",
            name="ck_defects_resolution",
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
    # Pass 2: priority is tenant-configurable (field_options, field_key
    # 'defect_priority'), same mechanism Tier 5 gave severity -- mandatory
    # going forward, backfilled to 'Medium' for pre-existing rows.
    priority: Mapped[str] = mapped_column(String, nullable=False, server_default="Medium")
    status: Mapped[str] = mapped_column(String, nullable=False, default="New", server_default="New")
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    # Pass 2: distinct from `description` -- a reproduction recipe, not the
    # general problem narrative.
    steps_to_reproduce: Mapped[str | None] = mapped_column(String, nullable=True)
    actual_result: Mapped[str | None] = mapped_column(String, nullable=True)
    expected_result: Mapped[str | None] = mapped_column(String, nullable=True)
    # ADR-070: soft delete. Every ORM SELECT excludes rows with deleted_at set
    # (app/models/soft_delete.py).
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # Pass 2: optional, restricted at the service layer to users already
    # assigned to this defect's project (same membership check used
    # everywhere else), mirroring TestCase.assignee_id.
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # Pass 2: optional parity with TestCase.module_id (Tier 3's TestModule).
    module_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_modules.id"), nullable=True
    )
    # Tier 2 (PV-8.1): environment is being promoted from free text to a
    # real Environment entity. The free-text column stays, nullable, as a
    # transition aid (old rows / clients that haven't moved to
    # environment_id yet) rather than being hard-dropped.
    environment: Mapped[str | None] = mapped_column(String, nullable=True)
    environment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("environments.id"), nullable=True
    )
    # Tier 2 (PV-8.2): optional build/release traceability.
    found_in_build_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("builds.id"), nullable=True
    )
    fixed_in_release_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("releases.id"), nullable=True
    )
    # Phase 6 (AI/SaaS vision roadmap, PV-6.4): a simple fixed taxonomy,
    # settable any time during triage, not required at creation.
    root_cause: Mapped[str | None] = mapped_column(String, nullable=True)
    reported_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # ADR-115: human-readable id BUG_000001 (see display_id_service); immutable.
    display_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    display_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    preconditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    labels: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    # [{"no": 1, "action": "...", "test_data": "...", "expected": "..."}]; the
    # legacy steps_to_reproduce text stays the compatibility rendering.
    repro_steps: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)
    build_found: Mapped[str | None] = mapped_column(Text, nullable=True)
    fix_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_cause_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_run_case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("test_run_cases.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Pass C (deferred item #4): set once the SLA-breach notification has
    # fired for this defect, so the worker's periodic sweep never re-sends
    # it on every poll. Cleared implicitly by nothing -- a defect that's
    # reopened (see reopened_count) keeps its history; a fresh breach after
    # reopening re-ages from created_at, so this flag intentionally isn't
    # reset on reopen (the budget is lifecycle-wide, see compute_aging).
    sla_breach_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Tier 2 (PV-6.3): additive analytics only -- ADR-026's forward-only
    # status sequence is deliberately NOT reversed. A "reopen" moves status
    # back to 'Open' via a dedicated path (defect_service.reopen_defect),
    # distinct from the strictly-sequential update_status; these two columns
    # are the only record of that ever having happened.
    reopened_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_reopened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class DefectLink(Base, TenantScopedMixin):
    """Many-to-many linkage (ADR-005)."""

    __tablename__ = "defect_links"
    __table_args__ = (
        CheckConstraint(
            "linkable_type in ('execution_step','test_case','defect','test_run_case')",
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
