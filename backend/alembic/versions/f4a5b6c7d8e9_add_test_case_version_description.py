"""add test_case_versions.description

Description is versioned alongside title/steps (ADR-003's immutable
snapshot model) rather than added to test_cases directly, since editing
an approved case's description should go through the same
fork-a-new-version-on-edit path as title/steps.

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-11-10 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'test_case_versions',
        sa.Column('description', sa.String(), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('test_case_versions', 'description')
