"""ADR-125: tenants.workspace_config

Revision ID: a6c8e0b2d4f7
Revises: f5b7d9a1c3e5
Create Date: 2026-12-16 09:00:00.000000

One nullable JSONB column holding the tenant's workspace defaults (sidebar entries, project tabs,
list view modes). NULL = built-in defaults, so every existing tenant is unchanged. Adding a
nullable column without a default is a catalog-only change; the tenants table already has RLS.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a6c8e0b2d4f7"
down_revision = "f5b7d9a1c3e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("workspace_config", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "workspace_config")
