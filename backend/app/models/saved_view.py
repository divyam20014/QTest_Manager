import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class SavedView(Base, TenantScopedMixin):
    """ADR-096: a user's private, named filter+sort combination for a list page.
    Never shared; only the owner can read or change it."""

    __tablename__ = "saved_views"
    __table_args__ = (
        UniqueConstraint("user_id", "list_key", "name", name="uq_saved_views_user_list_name"),
        CheckConstraint(
            "list_key in "
            "('test_cases','test_repository','defects','test_runs','requirements','projects')",
            name="ck_saved_views_list_key",
        ),
        CheckConstraint("char_length(name) between 1 and 60", name="ck_saved_views_name_len"),
        Index(
            "uq_saved_views_one_default",
            "user_id",
            "list_key",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    list_key: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    filters: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    sort: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # ADR-115: optional saved column layout (visible columns/order/widths).
    columns: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(JSONB, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
