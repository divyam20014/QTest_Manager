"""add sessions.last_seen_at for idle-timeout enforcement

session_ttl_minutes was a defined setting that nothing ever read --
only the post-MFA absolute expires_at was enforced, with no sliding/idle
timeout. Adds a last_seen_at column, updated on every authenticated
request (app/core/auth.get_current_context), checked against
settings.session_ttl_minutes.

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-11-09 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'sessions',
        sa.Column(
            'last_seen_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
    )


def downgrade() -> None:
    op.drop_column('sessions', 'last_seen_at')
