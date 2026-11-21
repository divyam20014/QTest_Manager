"""ADR-097: manual flaky-test quarantine columns on test_cases

Revision ID: d7f3b9a1c5e2
Revises: c6e2a8f4b1d7
Create Date: 2026-11-23 10:00:00.000000
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d7f3b9a1c5e2"
down_revision = "c6e2a8f4b1d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "test_cases",
        sa.Column("quarantined", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("test_cases", sa.Column("quarantine_reason", sa.String(), nullable=True))
    op.add_column(
        "test_cases", sa.Column("quarantined_by", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "test_cases", sa.Column("quarantined_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_test_cases_quarantined_by", "test_cases", "users", ["quarantined_by"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_test_cases_quarantined_by", "test_cases", type_="foreignkey")
    for col in ("quarantined_at", "quarantined_by", "quarantine_reason", "quarantined"):
        op.drop_column("test_cases", col)
