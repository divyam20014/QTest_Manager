import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import (
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


class Role(Base, UUIDPKMixin):
    """Fixed seed set per BRD §3.2 (ADR-014): admin, manager, tester."""

    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)


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
