import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
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


class FieldOption(Base, TenantScopedMixin):
    """Tier 5 (PV-9.5): tenant-configurable severity/priority value sets.

    Replaces the fixed CheckConstraint + Pydantic Literal that used to pin
    Defect.severity/TestCase.priority to exactly Low/Medium/High/Critical --
    these are pure labels with no workflow-transition logic attached (unlike
    status), so unlike status they're safe to fully hand to tenants (see
    ADR-055 for why status itself is handled differently: a display-label
    overlay, not a free-form value set). Every tenant is seeded with these
    same four defaults at creation so nothing changes unless an admin acts.
    """

    __tablename__ = "field_options"
    __table_args__ = (
        CheckConstraint(
            "field_key in ('defect_severity','test_case_priority')",
            name="ck_field_options_field_key",
        ),
        UniqueConstraint("tenant_id", "field_key", "code", name="uq_field_options_tenant_key_code"),
    )

    field_key: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StatusLabel(Base, TenantScopedMixin):
    """Tier 5 (PV-9.5): an additive display-label override for a fixed
    status code -- e.g. a tenant renaming "Closed" to "Resolved" in their
    own UI. Deliberately NOT a new status value or a transition-logic
    change: Defect.status/TestCase.status remain the same fixed, validated
    codes they always were (ADR-026's forward-only sequence, Tier 2's
    reopen-counter detection, and Tier 3's review-approval state machine
    all depend on knowing exactly which fixed codes exist). Absence of a
    row for a given (entity_type, status_code) means "use the built-in
    label" -- there is no requirement to cover every code.
    """

    __tablename__ = "status_labels"
    __table_args__ = (
        CheckConstraint(
            "entity_type in ('test_case','defect')", name="ck_status_labels_entity_type"
        ),
        UniqueConstraint(
            "tenant_id", "entity_type", "status_code", name="uq_status_labels_tenant_entity_code"
        ),
    )

    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    status_code: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CustomFieldDefinition(Base, TenantScopedMixin):
    """Tier 5 (PV-9.6): a tenant-defined extra field on test cases, defects,
    or requirements. `options` holds the selectable values for
    select/multi_select types only (null otherwise)."""

    __tablename__ = "custom_field_definitions"
    __table_args__ = (
        CheckConstraint(
            "entity_type in ('test_case','defect','requirement')",
            name="ck_custom_field_definitions_entity_type",
        ),
        CheckConstraint(
            "field_type in ('text','number','boolean','date','select','multi_select')",
            name="ck_custom_field_definitions_field_type",
        ),
        UniqueConstraint(
            "tenant_id", "entity_type", "field_key", name="uq_custom_field_definitions_tenant_key"
        ),
    )

    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    field_key: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    field_type: Mapped[str] = mapped_column(String, nullable=False)
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CustomFieldValue(Base, TenantScopedMixin):
    """One value of one custom field on one owning entity -- polymorphic,
    mirroring Attachment/Comment/Notification's owner_type/owner_id pattern
    (ADR-012/049/050/051) rather than a per-entity-type values table."""

    __tablename__ = "custom_field_values"
    __table_args__ = (
        CheckConstraint(
            "owner_type in ('test_case','defect','requirement')",
            name="ck_custom_field_values_owner_type",
        ),
        UniqueConstraint(
            "field_definition_id", "owner_id", name="uq_custom_field_values_def_owner"
        ),
    )

    field_definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("custom_field_definitions.id"), nullable=False
    )
    owner_type: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    value: Mapped[object | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
