"""ADR-132: saved views for the all-projects Test Cases page

Revision ID: a7c9e1f3b5d8
Revises: e2f5b7c9d1a3
Create Date: 2026-11-26 20:00:00.000000

Widens ``ck_saved_views_list_key`` by one value, ``test_repository``. No row changes: it only
rewrites a CHECK on a small table, so it runs inside the normal transaction.
"""

from alembic import op

revision = "a7c9e1f3b5d8"
down_revision = "e2f5b7c9d1a3"
branch_labels = None
depends_on = None

_OLD = "list_key in ('test_cases','defects','test_runs','requirements','projects')"
_NEW = (
    "list_key in ('test_cases','test_repository','defects','test_runs','requirements','projects')"
)


def upgrade() -> None:
    op.drop_constraint("ck_saved_views_list_key", "saved_views", type_="check")
    op.create_check_constraint("ck_saved_views_list_key", "saved_views", _NEW)


def downgrade() -> None:
    # Views of the new list cannot satisfy the old check: drop them first.
    op.execute("DELETE FROM saved_views WHERE list_key = 'test_repository'")
    op.drop_constraint("ck_saved_views_list_key", "saved_views", type_="check")
    op.create_check_constraint("ck_saved_views_list_key", "saved_views", _OLD)
