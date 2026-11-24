import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class Dashboard(Base, TenantScopedMixin):
    """ADR-099: a named, fixed-layout custom dashboard. Private to its owner
    (owner_user_id), except the single tenant "team default" (owner NULL)."""

    __tablename__ = "dashboards"
    __table_args__ = (
        CheckConstraint("char_length(name) between 1 and 60", name="ck_dashboards_name_len"),
        CheckConstraint(
            "(is_team_default and owner_user_id is null and project_id is null) or "
            "(not is_team_default and owner_user_id is not null) or "
            "(not is_team_default and owner_user_id is null and project_id is not null)",
            name="ck_dashboards_owner_vs_default",
        ),
        Index(
            "uq_dashboards_one_team_default",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_team_default"),
        ),
        Index("ix_dashboards_owner", "owner_user_id"),
        # ADR-123: one layout per (project, user) and one default per project.
        Index(
            "uq_dashboards_project_user",
            "project_id",
            "owner_user_id",
            unique=True,
            postgresql_where=text("project_id is not null and owner_user_id is not null"),
        ),
        Index(
            "uq_dashboards_project_default",
            "project_id",
            unique=True,
            postgresql_where=text("project_id is not null and owner_user_id is null"),
        ),
    )

    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # ADR-123: set on a project dashboard layout (own, or the project default when owner is NULL).
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    is_team_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DashboardWidget(Base, TenantScopedMixin):
    __tablename__ = "dashboard_widgets"
    __table_args__ = (
        CheckConstraint("size in ('S','M','L')", name="ck_dashboard_widgets_size"),
        Index("ix_dashboard_widgets_dashboard", "dashboard_id", "position"),
    )

    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False
    )
    widget_type: Mapped[str] = mapped_column(String(40), nullable=False)
    size: Mapped[str] = mapped_column(String(1), nullable=False, server_default=text("'M'"))
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
