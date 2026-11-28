"""links record the requirement version they cover (ADR-150)

Revision ID: a4c6e8f0b2d3
Revises: f3b5d7e9a1c2
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "a4c6e8f0b2d3"
down_revision = "f3b5d7e9a1c2"
branch_labels = None
depends_on = None

_LINKS = "requirement_test_case_links"
_COLUMNS = ("requirement_version_id", "unrecorded_baseline_version_id")


def upgrade() -> None:
    # So a link can be required to name a version of its own requirement.
    op.create_unique_constraint(
        "uq_requirement_versions_id_requirement",
        "requirement_versions",
        ["id", "requirement_id"],
    )
    for column in _COLUMNS:
        op.add_column(_LINKS, sa.Column(column, postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            f"fk_requirement_links_{column}",
            _LINKS,
            "requirement_versions",
            [column, "requirement_id"],
            ["id", "requirement_id"],
        )
        op.create_index(f"ix_requirement_links_{column}", _LINKS, [column])
    # What a link made before now covered is not known, and is left empty. What is known is the
    # version that was current when recording began: any later version means the requirement
    # has changed since the link was made.
    op.execute("select set_config('app.allow_archived_write', 'on', true)")
    op.execute(
        f"update {_LINKS} l set unrecorded_baseline_version_id = r.current_version_id "
        "from requirements r where r.id = l.requirement_id"
    )
    op.execute("select set_config('app.allow_archived_write', 'off', true)")


def downgrade() -> None:
    # Which version each link covers is lost.
    for column in _COLUMNS:
        op.drop_index(f"ix_requirement_links_{column}", table_name=_LINKS)
        op.drop_constraint(f"fk_requirement_links_{column}", _LINKS, type_="foreignkey")
        op.drop_column(_LINKS, column)
    op.drop_constraint(
        "uq_requirement_versions_id_requirement", "requirement_versions", type_="unique"
    )
