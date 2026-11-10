"""add tenant branding, IP allowlist, data residency columns (Tier 4, PV-11.3/11.4/11.6)

Adds `tenants.brand_display_name`/`brand_primary_color`/`brand_logo_ref`
(tenant branding, PV-11.4), `tenants.ip_allowlist` (CIDR allowlist,
PV-11.3 -- NULL/empty means no restriction, so existing tenants are
unaffected), and `tenants.data_region` (data residency readiness
metadata, PV-11.6, platform-admin-settable only).

Revision ID: c4d5e6f7a8b9
Revises: b8c9d0e1f2a3
Create Date: 2026-11-10 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tenants', sa.Column('brand_display_name', sa.String(), nullable=True))
    op.add_column('tenants', sa.Column('brand_primary_color', sa.String(length=7), nullable=True))
    op.add_column('tenants', sa.Column('brand_logo_ref', sa.String(), nullable=True))
    op.add_column('tenants', sa.Column('brand_logo_mime_type', sa.String(), nullable=True))
    op.add_column(
        'tenants',
        sa.Column('ip_allowlist', postgresql.ARRAY(sa.String()), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column('data_region', sa.String(), nullable=False, server_default='us'),
    )


def downgrade() -> None:
    op.drop_column('tenants', 'data_region')
    op.drop_column('tenants', 'ip_allowlist')
    op.drop_column('tenants', 'brand_logo_mime_type')
    op.drop_column('tenants', 'brand_logo_ref')
    op.drop_column('tenants', 'brand_primary_color')
    op.drop_column('tenants', 'brand_display_name')
