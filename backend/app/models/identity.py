import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin, UUIDPKMixin


class PlatformAdmin(Base, UUIDPKMixin):
    """Bootstrap-only (ADR-008). Not part of any tenant's RBAC."""

    __tablename__ = "platform_admins"

    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Tier 0 / ADR-052: brute-force lockout on the HTTP Basic plane (a full
    # session+MFA replacement was deliberately deferred -- see ADR-052).
    failed_login_count: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default="0"
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Platform Admin UI/UX pass: closes the gap where the only way to
    # deactivate a platform admin was the out-of-band seed script.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=sa.text("true")
    )
    # ADR-074: TOTP MFA. The secret is Fernet-encrypted at rest (never the
    # plaintext base32). While mfa_enabled_at is NULL the secret is only a
    # PENDING enrolment secret and grants nothing.
    mfa_secret_encrypted: Mapped[str | None] = mapped_column(String, nullable=True)
    mfa_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Highest TOTP time step already accepted -- a code is single-use.
    mfa_last_used_step: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mfa_failed_count: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default="0"
    )

    @property
    def mfa_enabled(self) -> bool:
        return self.mfa_enabled_at is not None and self.mfa_secret_encrypted is not None


class PlatformSession(Base, UUIDPKMixin):
    """ADR-074: server-side Platform Admin session. The cookie carries a
    random 256-bit token; only its SHA-256 is stored, so a database read
    cannot be replayed as a live session. `stage` 'password_ok' (password
    verified, MFA outstanding) grants no API access; only 'mfa_verified'
    does."""

    __tablename__ = "platform_sessions"
    __table_args__ = (
        CheckConstraint(
            "stage in ('password_ok','mfa_verified')", name="ck_platform_sessions_stage"
        ),
    )

    admin_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    stage: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    mfa_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)


class PlatformAdminRecoveryCode(Base, UUIDPKMixin):
    """ADR-074: single-use MFA recovery code. Only the SHA-256 of the
    (80-bit random) code is stored."""

    __tablename__ = "platform_admin_recovery_codes"

    admin_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Role(Base, UUIDPKMixin):
    """ADR-014 originally fixed this to 3 seed rows (admin/manager/tester).
    ADR-059 formally supersedes that: a tenant may now also define its own
    custom roles. System roles keep `tenant_id IS NULL` (shared by every
    tenant, exactly as before -- no per-tenant duplication); a custom role
    is scoped to the one tenant that created it via `tenant_id`. `code` stays
    unique-but-nullable (Postgres treats multiple NULLs as distinct), since
    only the 3 system roles are ever referenced by a fixed code string
    elsewhere in the codebase -- custom roles are only ever looked up by id.
    """

    __tablename__ = "roles"

    code: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Deliberately not a ForeignKey("tenants.id") -- see the migration's
    # own comment: a real FK would make `TRUNCATE tenants CASCADE` wipe
    # every system role along with it. Validated service-side instead.
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa.text("false")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=sa.text("true")
    )


class Permission(Base, UUIDPKMixin):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("permissions.id"), primary_key=True
    )


class User(Base, TenantScopedMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("char_length(name) > 0", name="ck_users_name_not_empty"),
        UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )

    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id"), nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=sa.text("true")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    pseudonymized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Session(Base, TenantScopedMixin):
    __tablename__ = "sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    mfa_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa.text("false")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MfaChallenge(Base, TenantScopedMixin):
    __tablename__ = "mfa_challenges"
    __table_args__ = (
        CheckConstraint("delivery_mode in ('real','simulated')", name="ck_mfa_delivery_mode"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    delivery_mode: Mapped[str] = mapped_column(
        String, nullable=False, default="simulated", server_default="simulated"
    )
    attempt_count: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default=sa.text("0")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
