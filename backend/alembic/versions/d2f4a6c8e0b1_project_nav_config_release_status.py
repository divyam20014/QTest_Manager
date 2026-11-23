"""ADR-122: projects.nav_config and releases.status

Revision ID: d2f4a6c8e0b1
Revises: c7d1e5a9b3f2
Create Date: 2026-12-01 09:00:00.000000

Two additive, nullable columns. ``projects.nav_config`` (JSONB) holds the optional project-tab
order and hidden tabs; the API validates it against an allowlist and NULL means the default
tabs. ``releases.status`` (text) is the release's lifecycle state for PATCH /releases/{id}; NULL
(every existing row) means unset. Both columns sit on tables that already have RLS and grants.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d2f4a6c8e0b1"
down_revision: str | None = "c7d1e5a9b3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("nav_config", postgresql.JSONB(), nullable=True))
    op.add_column("releases", sa.Column("status", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("releases", "status")
    op.drop_column("projects", "nav_config")
