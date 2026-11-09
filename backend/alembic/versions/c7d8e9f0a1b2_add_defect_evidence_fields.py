"""add defects.actual_result, expected_result, environment

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-11-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, None] = 'b6c7d8e9f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('defects', sa.Column('actual_result', sa.String(), nullable=True))
    op.add_column('defects', sa.Column('expected_result', sa.String(), nullable=True))
    op.add_column('defects', sa.Column('environment', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('defects', 'environment')
    op.drop_column('defects', 'expected_result')
    op.drop_column('defects', 'actual_result')
