"""add plans + subscriptions (Tier 1: SaaS commercial foundations, ADR-053)

Schema/admin-assignment only (SR-3, SAAS-GAP-1) -- no payment gateway, no
billing engine. `plans` is a platform-wide catalog (no tenant_id, no RLS,
same category as roles/permissions). `subscriptions` is tenant-scoped and
RLS-protected, one row per tenant. Seeds two default plans and backfills a
Trial subscription for every existing tenant so none are left null.

Revision ID: c2d3e4f5a6b7
Revises: b7c8d9e0f1a2
Create Date: 2026-11-10 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        'plans',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('code', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('seat_limit', sa.Integer(), nullable=True),
        sa.Column('storage_limit_mb', sa.Integer(), nullable=True),
        sa.Column('ai_monthly_request_limit', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO {APP_ROLE}")

    op.create_table(
        'subscriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(), server_default='trialing', nullable=False),
        sa.Column('seat_count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('current_period_start', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("status in ('trialing','active','past_due','canceled')", name='ck_subscriptions_status'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['plan_id'], ['plans.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', name='uq_subscriptions_tenant_id'),
    )
    op.create_index(op.f('ix_subscriptions_tenant_id'), 'subscriptions', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON subscriptions
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO {APP_ROLE}")

    op.execute(
        """
        INSERT INTO plans (id, code, name, seat_limit, storage_limit_mb, ai_monthly_request_limit, is_active)
        VALUES
            (gen_random_uuid(), 'trial', 'Trial', 5, 1024, 100, true),
            (gen_random_uuid(), 'standard', 'Standard', 25, 10240, 1000, true)
        """
    )

    # Backfill: every existing tenant gets a Trial subscription so none are
    # left without one. Runs as the migration (owner) role, which bypasses
    # RLS entirely regardless of FORCE ROW LEVEL SECURITY.
    op.execute(
        """
        INSERT INTO subscriptions (id, tenant_id, plan_id, status, seat_count, current_period_start)
        SELECT gen_random_uuid(), t.id, (SELECT id FROM plans WHERE code = 'trial'), 'trialing', 1, now()
        FROM tenants t
        WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON subscriptions")
    op.drop_table('subscriptions')
    op.drop_table('plans')
