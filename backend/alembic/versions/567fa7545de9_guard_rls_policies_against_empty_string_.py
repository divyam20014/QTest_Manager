"""guard RLS policies against empty-string tenant GUC

A custom GUC placeholder (app.current_tenant) that has only ever been set
via set_config(..., true) (transaction-LOCAL) reverts to '' -- not NULL --
once that transaction commits, because Postgres initializes an
unrecognized custom parameter's placeholder value to the empty string.
current_setting('app.current_tenant', true)::uuid then raises
invalid_text_representation on the very next transaction instead of simply
failing the RLS predicate (NULL, i.e. deny). NULLIF(...,'') fixes this:
empty string becomes NULL before the cast, so the comparison safely
evaluates to NULL/false (default-deny) instead of erroring.

Revision ID: 567fa7545de9
Revises: 144251f3d347
Create Date: 2026-11-09 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '567fa7545de9'
down_revision: Union[str, None] = '144251f3d347'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_TABLES = [
    "users",
    "projects",
    "test_cases",
    "test_case_versions",
    "test_case_version_steps",
    "attachments",
    "test_runs",
    "test_run_cases",
    "execution_steps",
    "defects",
    "defect_links",
    "audit_logs",
]

OLD_EXPR = "tenant_id = current_setting('app.current_tenant', true)::uuid"
NEW_EXPR = "tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid"


def upgrade() -> None:
    for table in RLS_TABLES:
        op.execute(f"ALTER POLICY tenant_isolation ON {table} USING ({NEW_EXPR}) WITH CHECK ({NEW_EXPR})")


def downgrade() -> None:
    for table in RLS_TABLES:
        op.execute(f"ALTER POLICY tenant_isolation ON {table} USING ({OLD_EXPR}) WITH CHECK ({OLD_EXPR})")
