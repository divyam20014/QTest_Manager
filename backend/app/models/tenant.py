from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import UUIDPKMixin


class Tenant(Base, UUIDPKMixin):
    __tablename__ = "tenants"
    __table_args__ = (
        CheckConstraint(
            "status in ('pending','approved','suspended','inactive')", name="ck_tenants_status"
        ),
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

    # Tier 4 / ADR-054: tenant branding (PV-11.4), reusing Phase 1's
    # tenant-settings mechanism rather than inventing a second one.
    # brand_logo_ref is an opaque storage reference (app/core/storage.py),
    # never a raw filesystem path.
    brand_display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    brand_primary_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    brand_logo_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    brand_logo_mime_type: Mapped[str | None] = mapped_column(String, nullable=True)

    # Tier 4 / ADR-054: tenant-configurable IP allowlist (PV-11.3). NULL/empty
    # means "no restriction" -- existing tenants are unaffected until they
    # opt in. Stored as CIDR-notation strings, validated at the API layer.
    ip_allowlist: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)

    # Tier 4 / ADR-054: data residency readiness (PV-11.6) -- metadata only,
    # platform-admin-settable at tenant creation. No per-region deployment
    # topology exists yet; see docs/DATA_RESIDENCY.md.
    data_region: Mapped[str] = mapped_column(
        String, nullable=False, default="us", server_default="us"
    )
