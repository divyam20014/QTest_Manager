"""row_version on test_cases and defects, to refuse stale saves (ADR-136)

Revision ID: b1d3f5a7c9e2
Revises: a7c9e1f3b5d8
Create Date: 2026-11-27

"""

import sqlalchemy as sa

from alembic import op

revision = "b1d3f5a7c9e2"
down_revision = "a7c9e1f3b5d8"
branch_labels = None
depends_on = None

_TABLES = ("test_cases", "defects")


def upgrade() -> None:
    # A constant default: existing rows read 1 without the table being rewritten.
    for table in _TABLES:
        op.add_column(
            table, sa.Column("row_version", sa.Integer(), nullable=False, server_default="1")
        )


def downgrade() -> None:
    for table in _TABLES:
        op.drop_column(table, "row_version")
