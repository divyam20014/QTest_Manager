"""add reopened_count/last_reopened_at to defects (Tier 2, PV-6.3)

Reopened-defect analysis, option A: ADR-026's forward-only status sequence
is NOT reversed -- these two columns are purely additive analytics,
written by a new dedicated reopen path (defect_service.reopen_defect),
never by the existing strictly-sequential update_status.

Revision ID: f6a7b8c9d0e1
Revises: e4f5a6b7c8d9
Create Date: 2026-11-10 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e4f5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'defects',
        sa.Column('reopened_count', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'defects', sa.Column('last_reopened_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('defects', 'last_reopened_at')
    op.drop_column('defects', 'reopened_count')
