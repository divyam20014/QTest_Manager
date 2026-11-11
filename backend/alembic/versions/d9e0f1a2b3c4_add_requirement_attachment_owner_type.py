"""Pass D: widen attachments.owner_type to include 'requirement' (BRD/FRD/TRD
document uploads on a Requirement) -- the authorization dispatcher
(owner_access.py) already handled this owner type; only the DB CHECK
constraint was missing, leaving it a dead branch.

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-11-11
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: str | Sequence[str] | None = "c8d9e0f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_attachments_owner_type", "attachments", type_="check")
    op.create_check_constraint(
        "ck_attachments_owner_type",
        "attachments",
        "owner_type in ('test_case','test_case_version','defect','execution_step','requirement')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_attachments_owner_type", "attachments", type_="check")
    op.create_check_constraint(
        "ck_attachments_owner_type",
        "attachments",
        "owner_type in ('test_case','test_case_version','defect','execution_step')",
    )
