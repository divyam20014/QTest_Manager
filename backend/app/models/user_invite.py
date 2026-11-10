import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class UserInvite(Base, TenantScopedMixin):
    """Tier 1 / ADR-053: tenant user-invite flow (SR-2.4/5.11, SAAS-GAP-8).

    Replaces admin-sets-the-password-directly provisioning. No `users` row
    exists for the invitee until the invite is accepted -- only this row,
    keyed by an unguessable token, exists in the meantime.

    Deliberately exempt from RLS (same reasoning as ADR-015's Session/
    MfaChallenge exemption): POST /users/invite/{token}/accept is public
    and must resolve a row -- and therefore its tenant_id -- before any
    tenant context can be set. Security rests on the token being an
    unguessable random secret (hashed at rest) plus expires_at/accepted_at,
    the same trust model as a password-reset token, not on RLS.
    """

    __tablename__ = "user_invites"

    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id"), nullable=False
    )
    invited_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
