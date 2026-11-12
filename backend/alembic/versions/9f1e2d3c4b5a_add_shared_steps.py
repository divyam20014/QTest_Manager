"""add shared_steps (Pass 5: test management depth)

A reusable, project-scoped step-template library. Deliberately a
copy-on-insert template, not a live reference -- see the model docstring
(app/models/shared_step.py) for why: it preserves the existing immutable
test-case-version/approval model untouched.

Revision ID: 9f1e2d3c4b5a
Revises: 7a8b9c0d1e2f
Create Date: 2026-11-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '9f1e2d3c4b5a'
down_revision: Union[str, None] = '7a8b9c0d1e2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        'shared_steps',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('expected', sa.String(), nullable=False),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_shared_steps_tenant_id'), 'shared_steps', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_shared_steps_project_id'), 'shared_steps', ['project_id'], unique=False)
    op.execute("ALTER TABLE shared_steps ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE shared_steps FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON shared_steps
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON shared_steps TO {APP_ROLE}")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON shared_steps")
    op.drop_table('shared_steps')
