"""Pass C (deferred items): extend notifications for run-case assignment,
test-run completion, and defect SLA breach (bug #19); track per-defect
SLA-breach notification to avoid re-notifying on every worker sweep.

Revision ID: c8d9e0f1a2b3
Revises: 6a7b8c9d0e1f
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8d9e0f1a2b3"
down_revision: str | None = "6a7b8c9d0e1f"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_notifications_type", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_type",
        "notifications",
        "type in ('mention','test_case_assigned','defect_closed',"
        "'review_requested','review_decided','run_case_assigned',"
        "'test_run_completed','defect_sla_breach')",
    )
    op.drop_constraint("ck_notifications_entity_type", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_entity_type",
        "notifications",
        "entity_type in ('test_case','defect','execution_step','test_run')",
    )
    op.add_column(
        "defects",
        sa.Column("sla_breach_notified_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("defects", "sla_breach_notified_at")
    op.drop_constraint("ck_notifications_entity_type", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_entity_type",
        "notifications",
        "entity_type in ('test_case','defect','execution_step')",
    )
    op.drop_constraint("ck_notifications_type", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_type",
        "notifications",
        "type in ('mention','test_case_assigned','defect_closed',"
        "'review_requested','review_decided')",
    )
