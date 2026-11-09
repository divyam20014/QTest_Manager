"""add idempotency_keys table (GAP-67)

Reliability hardening: maps a client-supplied Idempotency-Key header,
scoped to tenant+user+operation, to the entity it created, so a retried or
accidentally duplicated create request returns the original entity instead
of creating a duplicate (app/core/idempotency.py).

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-11-10 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        'idempotency_keys',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'user_id', 'scope', 'key', name='uq_idempotency_key'),
    )
    op.create_index(op.f('ix_idempotency_keys_tenant_id'), 'idempotency_keys', ['tenant_id'], unique=False)

    # Row-Level Security (ADR-007), same pattern as every other tenant table.
    op.execute("ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON idempotency_keys
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    # Covered by the baseline ALTER DEFAULT PRIVILEGES grant, but explicit
    # for clarity/defense-in-depth.
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON idempotency_keys")
    op.drop_index(op.f('ix_idempotency_keys_tenant_id'), table_name='idempotency_keys')
    op.drop_table('idempotency_keys')
