"""add projects.version for optimistic concurrency control (GAP-68)

Reliability hardening: a concurrent PATCH to the same field of the same
project was a silent lost update (no lock, no conflict signal). An
optional ProjectUpdateRequest.expected_version lets a caller detect a
concurrent edit (409) instead of silently overwriting it; version is
incremented on every successful update.

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-11-10 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'projects', sa.Column('version', sa.Integer(), nullable=False, server_default='1')
    )


def downgrade() -> None:
    op.drop_column('projects', 'version')
