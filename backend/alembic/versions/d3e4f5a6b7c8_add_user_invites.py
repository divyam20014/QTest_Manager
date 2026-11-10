"""add user_invites (Tier 1: tenant user-invite flow, ADR-053)

SR-2.4/5.11, SAAS-GAP-8. Exempt from RLS from creation (same reasoning as
ADR-015's Session/MfaChallenge exemption, see app/models/user_invite.py's
docstring): the public accept endpoint must resolve this row -- and
therefore its tenant_id -- before any tenant context exists.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-11-10 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        'user_invites',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', postgresql.CITEXT(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('role_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('invited_by', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id']),
        sa.ForeignKeyConstraint(['invited_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_invites_tenant_id'), 'user_invites', ['tenant_id'], unique=False)
    # No RLS: see module docstring / app/models/user_invite.py.
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON user_invites TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table('user_invites')
