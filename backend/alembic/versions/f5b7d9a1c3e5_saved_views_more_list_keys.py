"""ADR-124: saved views for the Requirements and Projects lists

Revision ID: f5b7d9a1c3e5
Revises: e3a5c7d9f1b4
Create Date: 2026-12-09 09:00:00.000000

Widens ``ck_saved_views_list_key`` so a saved view can belong to the requirements or projects
list. No new column: the view mode (list / board / calendar) is one more allowlisted key inside the
existing ``filters`` JSON, so every existing view keeps working unchanged. The statement only
rewrites a CHECK on a small table (one row per saved view), so it runs inside the normal
transaction.
"""

from alembic import op

revision = "f5b7d9a1c3e5"
down_revision = "e3a5c7d9f1b4"
branch_labels = None
depends_on = None

_OLD = "list_key in ('test_cases','defects','test_runs')"
_NEW = "list_key in ('test_cases','defects','test_runs','requirements','projects')"


def upgrade() -> None:
    op.drop_constraint("ck_saved_views_list_key", "saved_views", type_="check")
    op.create_check_constraint("ck_saved_views_list_key", "saved_views", _NEW)


def downgrade() -> None:
    # Views of the new lists cannot satisfy the old check: drop them first.
    op.execute("DELETE FROM saved_views WHERE list_key IN ('requirements','projects')")
    op.drop_constraint("ck_saved_views_list_key", "saved_views", type_="check")
    op.create_check_constraint("ck_saved_views_list_key", "saved_views", _OLD)
