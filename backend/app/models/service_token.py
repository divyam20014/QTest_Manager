from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class ServiceToken(Base, TenantScopedMixin):
    """Post-gap-closure pass (ADR-059): per-tenant machine-to-machine bearer
    token for CI/CD result ingestion (PV-5). RLS-protected like SsoConfig/
    ScimToken -- the CI webhook routes carry tenant_id in the URL, so it is
    always known before this row is queried.

    Hashed at rest the same way every other credential in this codebase is
    (app/core/security.py's argon2 hasher) -- revocation is "set
    revoked_at", never a mutable plaintext update. `scope` is a fixed,
    closed set (not a free-form string) so a token can never be granted
    more than this app's code actually checks for.
    """

    __tablename__ = "service_tokens"

    name: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    # Fixed taxonomy, checked against in app/core/service_token_auth.py --
    # "ci_results" is the only scope that exists today (result ingestion).
    # A new capability needing M2M access adds its own scope value here and
    # its own explicit check at the call site, never a blanket "all".
    scope: Mapped[str] = mapped_column(String, nullable=False, default="ci_results")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
