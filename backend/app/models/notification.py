import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class Notification(Base, TenantScopedMixin):
    """Phase 9 (ADR-051): a bounded set of trigger types, not a generic
    configurable-rules engine -- comment mentions, test case assignment,
    and defect closure are the three events this phase wires up. entity_type
    reuses the same taxonomy as Attachment/Comment's owner_type so the
    frontend can link back to the triggering entity consistently."""

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "type in ('mention','test_case_assigned','defect_closed',"
            "'review_requested','review_decided','run_case_assigned',"
            "'test_run_completed','defect_sla_breach')",
            name="ck_notifications_type",
        ),
        CheckConstraint(
            "entity_type in ('test_case','defect','execution_step','test_run')",
            name="ck_notifications_entity_type",
        ),
    )

    recipient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
