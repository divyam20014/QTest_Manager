from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class ScimToken(Base, TenantScopedMixin):
    """Tier 4 / ADR-054: per-tenant SCIM 2.0 bearer token (PV-11.2).

    RLS-protected like SsoConfig -- the SCIM routes carry tenant_id in the
    URL (`/scim/v2/{tenant_id}/Users`), so it is always known before this
    row is queried. The token itself is never stored in plaintext, hashed
    the same way every other credential in this codebase is
    (app/core/security.py's argon2 hasher) -- revocation and rotation are
    both just "create a new row" / "set revoked_at", never a mutable
    plaintext update.
    """

    __tablename__ = "scim_tokens"

    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
