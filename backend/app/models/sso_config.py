from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class SsoConfig(Base, TenantScopedMixin):
    """Tier 4 / ADR-054: tenant-level OIDC SSO configuration (PV-11.1).

    One row per tenant, RLS-protected like any other tenant-owned table --
    unlike Session/BackgroundJob, the tenant_id is always already known (it
    is a path parameter on the login/callback routes) before this row is
    ever queried, so there is no chicken-and-egg problem requiring an RLS
    exemption here.

    `client_secret_encrypted` reuses app/core/crypto.py's existing Fernet
    helper (the same one Phase 3's AI credentials use) rather than a new
    encryption mechanism.
    """

    __tablename__ = "sso_configs"

    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    issuer: Mapped[str] = mapped_column(String, nullable=False)
    client_id: Mapped[str] = mapped_column(String, nullable=False)
    client_secret_encrypted: Mapped[str] = mapped_column(String, nullable=False)
    # Role newly-provisioned SSO users get on first login -- deliberately
    # the lowest-privilege role, never auto-admin.
    default_role_code: Mapped[str] = mapped_column(
        String, nullable=False, default="tester", server_default="tester"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
