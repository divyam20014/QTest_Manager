"""add AI Test Case Generator (Phase 3): tenant AI settings columns plus
ai_usage_logs

AI/SaaS vision roadmap Phase 3 (GAP-72 / PV-?, first of three sequenced AI
capabilities): adds ai_enabled/ai_provider/ai_api_key_encrypted columns to
the existing tenants table (reusing Phase 1's settings mechanism rather than
a new table) and a new ai_usage_logs table for token-usage metering. No new
permission is seeded -- generating draft test cases reuses the same
project-access rule as manually creating a test case; enabling AI and
managing the API key reuses the existing tenant.settings.manage permission.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-11-10 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.add_column(
        'tenants',
        sa.Column('ai_enabled', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column(
        'tenants',
        sa.Column('ai_provider', sa.String(), server_default='gemini', nullable=False),
    )
    op.add_column('tenants', sa.Column('ai_api_key_encrypted', sa.String(), nullable=True))

    op.create_table(
        'ai_usage_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('requirement_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('prompt_tokens', sa.Integer(), nullable=False),
        sa.Column('completion_tokens', sa.Integer(), nullable=False),
        sa.Column('total_tokens', sa.Integer(), nullable=False),
        sa.Column('success', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['requirement_id'], ['requirements.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_ai_usage_logs_tenant_id'), 'ai_usage_logs', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE ai_usage_logs FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON ai_usage_logs
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_logs TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON ai_usage_logs")
    op.drop_table('ai_usage_logs')
    op.drop_column('tenants', 'ai_api_key_encrypted')
    op.drop_column('tenants', 'ai_provider')
    op.drop_column('tenants', 'ai_enabled')
