"""Pass 2: Test Case / Defect schema realignment (ADR-061)

- TestCaseVersion gains scenario_id/scenario_description/prerequisite/
  test_data (optional, versioned alongside title/description).
- Defect gains priority (mandatory going forward, tenant-configurable via
  a new 'defect_priority' field_options key, backfilled 'Medium' for
  existing rows), steps_to_reproduce (optional), assigned_to (optional,
  service-layer restricted to project members), module_id (optional,
  parity with TestCase.module_id).
- field_options.field_key CHECK constraint widened to include
  'defect_priority'; every existing tenant seeded with the same four
  defaults used by severity/test-case-priority.

Revision ID: 6a7b8c9d0e1f
Revises: 053233f28383
Create Date: 2026-11-11 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "6a7b8c9d0e1f"
down_revision: Union[str, None] = "053233f28383"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_OPTIONS = ["Low", "Medium", "High", "Critical"]


def upgrade() -> None:
    op.add_column("test_case_versions", sa.Column("scenario_id", sa.String(), nullable=True))
    op.add_column(
        "test_case_versions", sa.Column("scenario_description", sa.String(), nullable=True)
    )
    op.add_column("test_case_versions", sa.Column("prerequisite", sa.String(), nullable=True))
    op.add_column("test_case_versions", sa.Column("test_data", sa.String(), nullable=True))

    op.add_column(
        "defects",
        sa.Column("priority", sa.String(), nullable=False, server_default="Medium"),
    )
    op.add_column("defects", sa.Column("steps_to_reproduce", sa.String(), nullable=True))
    op.add_column(
        "defects",
        sa.Column("assigned_to", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "defects",
        sa.Column("module_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_defects_assigned_to", "defects", "users", ["assigned_to"], ["id"]
    )
    op.create_foreign_key(
        "fk_defects_module_id", "defects", "test_modules", ["module_id"], ["id"]
    )

    op.drop_constraint("ck_field_options_field_key", "field_options", type_="check")
    op.create_check_constraint(
        "ck_field_options_field_key",
        "field_options",
        "field_key in ('defect_severity','test_case_priority','defect_priority')",
    )

    conn = op.get_bind()
    for order, code in enumerate(DEFAULT_OPTIONS):
        conn.execute(
            sa.text(
                """
                INSERT INTO field_options (tenant_id, field_key, code, label, sort_order)
                SELECT id, 'defect_priority', :code, :code, :sort_order FROM tenants
                ON CONFLICT DO NOTHING
                """
            ),
            {"code": code, "sort_order": order},
        )


def downgrade() -> None:
    op.execute("DELETE FROM field_options WHERE field_key = 'defect_priority'")
    op.drop_constraint("ck_field_options_field_key", "field_options", type_="check")
    op.create_check_constraint(
        "ck_field_options_field_key",
        "field_options",
        "field_key in ('defect_severity','test_case_priority')",
    )
    op.drop_constraint("fk_defects_module_id", "defects", type_="foreignkey")
    op.drop_constraint("fk_defects_assigned_to", "defects", type_="foreignkey")
    op.drop_column("defects", "module_id")
    op.drop_column("defects", "assigned_to")
    op.drop_column("defects", "steps_to_reproduce")
    op.drop_column("defects", "priority")
    op.drop_column("test_case_versions", "test_data")
    op.drop_column("test_case_versions", "prerequisite")
    op.drop_column("test_case_versions", "scenario_description")
    op.drop_column("test_case_versions", "scenario_id")
