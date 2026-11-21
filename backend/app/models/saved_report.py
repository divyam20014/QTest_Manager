import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class SavedReport(Base, TenantScopedMixin):
    """ADR-098: a structured (never SQL) report definition owned by a user and
    optionally shared read-only with the tenant."""

    __tablename__ = "saved_reports"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_saved_reports_user_name"),
        CheckConstraint(
            "source in ('test_cases','test_runs','defects')", name="ck_saved_reports_source"
        ),
        CheckConstraint("char_length(name) between 1 and 80", name="ck_saved_reports_name_len"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    is_shared: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
