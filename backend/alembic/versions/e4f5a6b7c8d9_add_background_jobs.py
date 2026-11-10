"""add background_jobs (Tier 1: DB-backed job queue, ADR-053)

SR-6.10. Exempt from RLS from creation (same reasoning as ADR-015's
Session/MfaChallenge exemption, see app/models/background_job.py's
docstring): the worker process must scan for the next queued job across
ALL tenants before any single job's tenant context is known.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-11-10 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APP_ROLE = "qtesthub_app"


def upgrade() -> None:
    op.create_table(
        'background_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('job_type', sa.String(), nullable=False),
        sa.Column('payload', postgresql.JSONB(), nullable=False),
        sa.Column('status', sa.String(), server_default='queued', nullable=False),
        sa.Column('attempts', sa.SmallInteger(), server_default='0', nullable=False),
        sa.Column('error', sa.String(), nullable=True),
        sa.Column('result', postgresql.JSONB(), nullable=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status in ('queued','running','succeeded','failed')", name='ck_background_jobs_status'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_background_jobs_tenant_id'), 'background_jobs', ['tenant_id'], unique=False)
    # Partial index: the worker's claim query only ever scans queued rows.
    op.create_index(
        'ix_background_jobs_status_created_at',
        'background_jobs',
        ['status', 'created_at'],
        unique=False,
        postgresql_where=sa.text("status = 'queued'"),
    )
    # No RLS: see module docstring / app/models/background_job.py.
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON background_jobs TO {APP_ROLE}")


def downgrade() -> None:
    op.drop_table('background_jobs')
