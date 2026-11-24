"""ADR-123: run-case due date, project dashboards, aggregate indexes

Revision ID: e3a5c7d9f1b4
Revises: d2f4a6c8e0b1
Create Date: 2026-12-02 09:00:00.000000

* ``test_run_cases.due_date`` (nullable date): the assignment-level due date that makes the
  "Overdue test cases" and "Upcoming milestones" widgets real. NULL = no due date.
* ``dashboards.project_id`` (nullable, FK, ON DELETE CASCADE): a project dashboard layout. A row with
  ``project_id`` set is either one user's own layout of that project (owner set) or the project's
  default layout (owner NULL, not a team default). The owner/default check is widened to allow
  that third shape and two partial unique indexes allow one layout per (project, user) and one
  default per project. Org dashboards (project_id NULL) are untouched.
* Two partial indexes for the new aggregates, built CONCURRENTLY inside ``autocommit_block`` like
  ADR-113 (IF NOT EXISTS / IF EXISTS so an interrupted build can be repaired).
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e3a5c7d9f1b4"
down_revision = "d2f4a6c8e0b1"
branch_labels = None
depends_on = None

_OLD_CHECK = (
    "(is_team_default and owner_user_id is null) or "
    "(not is_team_default and owner_user_id is not null)"
)
_NEW_CHECK = (
    "(is_team_default and owner_user_id is null and project_id is null) or "
    "(not is_team_default and owner_user_id is not null) or "
    "(not is_team_default and owner_user_id is null and project_id is not null)"
)

_INDEXES: list[tuple[str, str, str]] = [
    (
        "ix_test_run_cases_tenant_due",
        "test_run_cases",
        "(tenant_id, due_date) WHERE due_date IS NOT NULL",
    ),
    (
        "ix_releases_tenant_project_date",
        "releases",
        "(tenant_id, project_id, release_date) WHERE release_date IS NOT NULL",
    ),
]


def upgrade() -> None:
    op.add_column("test_run_cases", sa.Column("due_date", sa.Date(), nullable=True))

    op.add_column(
        "dashboards",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_dashboards_project_id",
        "dashboards",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("ck_dashboards_owner_vs_default", "dashboards", type_="check")
    op.create_check_constraint("ck_dashboards_owner_vs_default", "dashboards", _NEW_CHECK)
    op.create_index(
        "uq_dashboards_project_user",
        "dashboards",
        ["project_id", "owner_user_id"],
        unique=True,
        postgresql_where=sa.text("project_id is not null and owner_user_id is not null"),
    )
    op.create_index(
        "uq_dashboards_project_default",
        "dashboards",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("project_id is not null and owner_user_id is null"),
    )

    with op.get_context().autocommit_block():
        for name, table, definition in _INDEXES:
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} {definition}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _table, _definition in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")

    op.execute("DELETE FROM dashboards WHERE project_id IS NOT NULL")  # cascades to widgets
    op.drop_index("uq_dashboards_project_default", table_name="dashboards")
    op.drop_index("uq_dashboards_project_user", table_name="dashboards")
    op.drop_constraint("ck_dashboards_owner_vs_default", "dashboards", type_="check")
    op.create_check_constraint("ck_dashboards_owner_vs_default", "dashboards", _OLD_CHECK)
    op.drop_constraint("fk_dashboards_project_id", "dashboards", type_="foreignkey")
    op.drop_column("dashboards", "project_id")
    op.drop_column("test_run_cases", "due_date")
