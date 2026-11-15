from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import UUIDPKMixin

LEAD_KINDS = ("demo", "contact", "pricing", "enterprise")
LEAD_STATUSES = ("new", "contacted", "closed")


class MarketingLead(Base, UUIDPKMixin):
    """Demo / sales enquiries from the public marketing site.

    Platform-wide, not tenant-owned (a prospect has no tenant yet) -- no
    tenant_id, no RLS, same category as Plan. Readable only through the
    platform-admin API.
    """

    __tablename__ = "marketing_leads"
    __table_args__ = (
        CheckConstraint(f"kind in {LEAD_KINDS}", name="ck_marketing_leads_kind"),
        CheckConstraint(f"status in {LEAD_STATUSES}", name="ck_marketing_leads_status"),
    )

    kind: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    business_email: Mapped[str] = mapped_column(String, nullable=False)
    company: Mapped[str] = mapped_column(String, nullable=False)
    job_role: Mapped[str | None] = mapped_column(String, nullable=True)
    team_size: Mapped[str | None] = mapped_column(String, nullable=True)
    primary_requirement: Mapped[str | None] = mapped_column(String, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_page: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
