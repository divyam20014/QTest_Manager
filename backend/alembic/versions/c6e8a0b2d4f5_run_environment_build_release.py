"""runs record environment, build and release; builds belong to a release (ADR-152)

Revision ID: c6e8a0b2d4f5
Revises: b5d7f9a1c3e4
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "c6e8a0b2d4f5"
down_revision = "b5d7f9a1c3e4"
branch_labels = None
depends_on = None


def _uuid(name: str) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=True)


def upgrade() -> None:
    # So a build or a run can be required to name a release or build of its own project.
    op.create_unique_constraint("uq_releases_id_project", "releases", ["id", "project_id"])
    op.create_unique_constraint("uq_builds_id_project", "builds", ["id", "project_id"])

    op.add_column("builds", _uuid("release_id"))
    op.create_foreign_key(
        "fk_builds_release_same_project",
        "builds",
        "releases",
        ["release_id", "project_id"],
        ["id", "project_id"],
    )
    op.create_index("ix_builds_release", "builds", ["release_id"])

    # Existing runs stay empty: what they were run against is not known, and is not guessed.
    op.add_column("test_runs", _uuid("environment_id"))
    op.create_foreign_key(
        "fk_test_runs_environment", "test_runs", "environments", ["environment_id"], ["id"]
    )
    op.create_index("ix_test_runs_environment", "test_runs", ["environment_id"])
    for column, table, name in (
        ("build_id", "builds", "build"),
        ("release_id", "releases", "release"),
    ):
        op.add_column("test_runs", _uuid(column))
        op.create_foreign_key(
            f"fk_test_runs_{name}_same_project",
            "test_runs",
            table,
            [column, "project_id"],
            ["id", "project_id"],
        )
        op.create_index(f"ix_test_runs_{name}", "test_runs", [column])

    op.add_column(
        "tenants",
        sa.Column(
            "require_run_environment_build",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    # What each run was run against, and which release a build belongs to, is lost.
    op.drop_column("tenants", "require_run_environment_build")
    for name in ("release", "build"):
        op.drop_index(f"ix_test_runs_{name}", table_name="test_runs")
        op.drop_constraint(f"fk_test_runs_{name}_same_project", "test_runs", type_="foreignkey")
        op.drop_column("test_runs", f"{name}_id")
    op.drop_index("ix_test_runs_environment", table_name="test_runs")
    op.drop_constraint("fk_test_runs_environment", "test_runs", type_="foreignkey")
    op.drop_column("test_runs", "environment_id")
    op.drop_index("ix_builds_release", table_name="builds")
    op.drop_constraint("fk_builds_release_same_project", "builds", type_="foreignkey")
    op.drop_column("builds", "release_id")
    op.drop_constraint("uq_builds_id_project", "builds", type_="unique")
    op.drop_constraint("uq_releases_id_project", "releases", type_="unique")
