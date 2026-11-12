import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class ReportSchedule(Base, TenantScopedMixin):
    """Pass 4 (ADR-065): recurring compliance-report email delivery.

    RLS-protected like any other tenant-owned config row -- unlike
    BackgroundJob/Session, nothing needs to resolve one of these before a
    tenant context exists. The worker's periodic sweep (app.worker, same
    pattern as defect_service.sweep_sla_breaches) iterates approved tenants
    and sets context per tenant before querying each tenant's due rows.
    """

    __tablename__ = "report_schedules"
    __table_args__ = (
        CheckConstraint("report_type in ('compliance')", name="ck_report_schedules_type"),
        CheckConstraint(
            "cadence in ('daily','weekly','monthly')", name="ck_report_schedules_cadence"
        ),
    )

    report_type: Mapped[str] = mapped_column(String, nullable=False, default="compliance")
    cadence: Mapped[str] = mapped_column(String, nullable=False)
    recipient_emails: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
