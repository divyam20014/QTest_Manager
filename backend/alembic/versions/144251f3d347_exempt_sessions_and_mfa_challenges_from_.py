"""exempt sessions and mfa_challenges from tenant RLS (ADR-015)

A session cookie must be resolved to a user BEFORE the tenant is known,
but RLS requires app.current_tenant to already be set to read any
tenant-scoped row -- circular for exactly these two tables. Security for
them instead rests on the row id being an unguessable random UUID plus
expires_at/revoked_at/attempt_count checks, the same trust model as a
password-reset token. Once a session resolves, its tenant_id becomes the
trusted context for the rest of the request, and every other table's RLS
applies normally from that point on.

Revision ID: 144251f3d347
Revises: 7bca6b69ef88
Create Date: 2026-11-09 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '144251f3d347'
down_revision: Union[str, None] = '7bca6b69ef88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EXEMPT_TABLES = ["sessions", "mfa_challenges"]


def upgrade() -> None:
    for table in EXEMPT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in EXEMPT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
            """
        )
