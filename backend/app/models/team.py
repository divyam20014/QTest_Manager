"""ADR-141: named groups of an organization's users.

A team gives no access by itself. Adding one to a project adds its members then.
"""

import uuid

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin, TenantScopedMixin


class Team(Base, TenantScopedMixin, CreatedAtMixin):
    __tablename__ = "teams"
    __table_args__ = (
        Index("uq_teams_tenant_name_ci", "tenant_id", text("lower(name)"), unique=True),
    )

    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # The database also requires the lead to belong to the same tenant.
    lead_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )


class TeamMember(Base, TenantScopedMixin, CreatedAtMixin):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_members_team_user"),)

    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
