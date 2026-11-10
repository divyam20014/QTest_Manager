from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import UUIDPKMixin


class Tenant(Base, UUIDPKMixin):
    __tablename__ = "tenants"
    __table_args__ = (
        CheckConstraint("status in ('pending','approved','suspended')", name="ck_tenants_status"),
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="pending", server_default="pending"
    )
    default_currency_code: Mapped[str] = mapped_column(
        String(3), nullable=False, default="USD", server_default="USD"
    )
    default_timezone: Mapped[str] = mapped_column(
        String, nullable=False, default="UTC", server_default="UTC"
    )
    # AI/SaaS vision roadmap Phase 3 (ADR-045): reuses Phase 1's
    # tenant-settings mechanism rather than inventing a second one.
    # ai_api_key_encrypted holds a Fernet-encrypted ciphertext, never the
    # plaintext key -- it is never returned by any API response.
    ai_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    ai_provider: Mapped[str] = mapped_column(
        String, nullable=False, default="gemini", server_default="gemini"
    )
    ai_api_key_encrypted: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
