"""test plans get an owner, dates, a status and exit criteria (ADR-153)

Revision ID: d7f9b1c3e5a6
Revises: c6e8a0b2d4f5
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d7f9b1c3e5a6"
down_revision = "c6e8a0b2d4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("test_plans", sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_test_plans_owner", "test_plans", "users", ["owner_id"], ["id"])
    op.create_index("ix_test_plans_owner", "test_plans", ["owner_id"])
    op.add_column("test_plans", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("test_plans", sa.Column("end_date", sa.Date(), nullable=True))
    op.add_column(
        "test_plans",
        sa.Column("status", sa.String(10), nullable=False, server_default="draft"),
    )
    op.add_column("test_plans", sa.Column("exit_criteria", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_test_plans_status", "test_plans", "status in ('draft','active','complete')"
    )
    op.create_check_constraint(
        "ck_test_plans_dates",
        "test_plans",
        "start_date is null or end_date is null or start_date <= end_date",
    )


def downgrade() -> None:
    # Owners, dates, statuses and exit criteria are lost.
    op.drop_constraint("ck_test_plans_dates", "test_plans", type_="check")
    op.drop_constraint("ck_test_plans_status", "test_plans", type_="check")
    for column in ("exit_criteria", "status", "end_date", "start_date"):
        op.drop_column("test_plans", column)
    op.drop_index("ix_test_plans_owner", table_name="test_plans")
    op.drop_constraint("fk_test_plans_owner", "test_plans", type_="foreignkey")
    op.drop_column("test_plans", "owner_id")
