"""BRD gap Phase 4: optional primary insurance domain on tenants

Adds tenants.primary_domain (nullable) with a CHECK constraint limiting it to
the five project domains plus 'Other'. Chosen optionally at signup (BRD
FR-AUTH-04) and used only as the default for a new project's Domain field --
it never restricts which domains a project may use. Existing tenants keep NULL
("not set"); no backfill.

The new column inherits the table-level grants and RLS policies tenants
already carries for qtesthub_app, so no GRANT/POLICY changes are needed.
Idempotent: safe to run twice.

Revision ID: c9d0e1f2a3b4
Revises: d1e2f3a4b5c6
Create Date: 2026-11-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT = "ck_tenants_primary_domain"


def upgrade() -> None:
    op.execute("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_domain VARCHAR")
    op.execute(f"ALTER TABLE tenants DROP CONSTRAINT IF EXISTS {CONSTRAINT}")
    op.execute(
        f"ALTER TABLE tenants ADD CONSTRAINT {CONSTRAINT} CHECK ("
        "primary_domain IS NULL OR primary_domain IN "
        "('Motor','Health','Travel','Life','Property','Other'))"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE tenants DROP CONSTRAINT IF EXISTS {CONSTRAINT}")
    op.execute("ALTER TABLE tenants DROP COLUMN IF EXISTS primary_domain")
