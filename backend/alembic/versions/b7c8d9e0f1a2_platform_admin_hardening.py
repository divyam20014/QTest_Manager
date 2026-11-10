"""platform admin hardening: lockout columns + audit attribution (Tier 0 / ADR-052)

Adds brute-force lockout columns to platform_admins and a nullable
platform_admin_id FK on audit_logs so platform-admin actions (tenant
provisioning/status changes) are individually attributed instead of
recording user_id=None with no identity at all.

Revision ID: b7c8d9e0f1a2
Revises: e5f6a7b8c9d0
Create Date: 2026-11-10 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'platform_admins',
        sa.Column('failed_login_count', sa.SmallInteger(), server_default='0', nullable=False),
    )
    op.add_column(
        'platform_admins',
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'audit_logs',
        sa.Column('platform_admin_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_audit_logs_platform_admin_id',
        'audit_logs',
        'platform_admins',
        ['platform_admin_id'],
        ['id'],
    )
    # No extra GRANT needed: the app role already has blanket SELECT/INSERT/
    # UPDATE/DELETE on all public-schema tables (7bca6b69ef88), which covers
    # the new columns too.


def downgrade() -> None:
    op.drop_constraint('fk_audit_logs_platform_admin_id', 'audit_logs', type_='foreignkey')
    op.drop_column('audit_logs', 'platform_admin_id')
    op.drop_column('platform_admins', 'locked_until')
    op.drop_column('platform_admins', 'failed_login_count')
