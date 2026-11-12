"""add tenant 'inactive' status and platform_admins.is_active

Platform Admin UI/UX pass: tenants gain a second, semantically distinct
non-active status. `suspended` already meant "compliance/abuse hold";
`inactive` is new and means "platform-admin-initiated deactivation" (e.g.
offboarding, non-payment) -- both block login identically via the existing
`_TENANT_STATUS_MESSAGES` dict in auth_service.py, but are tracked/badged
separately so admins can tell them apart later.

platform_admins.is_active closes a real gap: today there is no way to
deactivate a platform admin account short of the out-of-band
seed_platform_admin.py script, and no way to list/create them over HTTP at
all. Additive column, default true, so every existing admin stays active.

Revision ID: a1b2c3d4e5f7
Revises: f1a2b3c4d5e6
Create Date: 2026-11-12 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_tenants_status', 'tenants', type_='check')
    op.create_check_constraint(
        'ck_tenants_status',
        'tenants',
        "status in ('pending','approved','suspended','inactive')",
    )
    op.add_column(
        'platform_admins',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
    )


def downgrade() -> None:
    op.drop_column('platform_admins', 'is_active')
    op.drop_constraint('ck_tenants_status', 'tenants', type_='check')
    op.create_check_constraint(
        'ck_tenants_status',
        'tenants',
        "status in ('pending','approved','suspended')",
    )
