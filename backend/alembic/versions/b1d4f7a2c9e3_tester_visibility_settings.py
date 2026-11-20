"""ADR-093: tenant Tester visibility switches (both default off)

Revision ID: b1d4f7a2c9e3
Revises: a9c3e7b1d5f2
Create Date: 2026-11-21 10:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "b1d4f7a2c9e3"
down_revision = "a9c3e7b1d5f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in ("testers_see_assigned_cases_only", "reports_hidden_from_testers"):
        op.add_column(
            "tenants",
            sa.Column(col, sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    op.drop_column("tenants", "reports_hidden_from_testers")
    op.drop_column("tenants", "testers_see_assigned_cases_only")
