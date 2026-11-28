"""task types, estimates and a shared backlog order (ADR-144)

Revision ID: a6c8e0f2b4d5
Revises: f5b7d9e1a3c4
Create Date: 2026-11-28

"""

import sqlalchemy as sa

from alembic import op

revision = "a6c8e0f2b4d5"
down_revision = "f5b7d9e1a3c4"
branch_labels = None
depends_on = None

_KEYS_BEFORE = (
    "defect_severity",
    "test_case_priority",
    "defect_priority",
    "test_type",
    "test_case_severity",
    "task_priority",
)
_TYPES = ("Task", "Story", "Chore")


def _check_keys(keys: tuple[str, ...]) -> None:
    allowed = ",".join(f"'{key}'" for key in keys)
    op.execute("ALTER TABLE field_options DROP CONSTRAINT ck_field_options_field_key")
    op.execute(
        "ALTER TABLE field_options ADD CONSTRAINT ck_field_options_field_key "
        f"CHECK (field_key in ({allowed}))"
    )


def upgrade() -> None:
    op.add_column(
        "tasks", sa.Column("task_type", sa.String(), nullable=False, server_default="Task")
    )
    op.add_column("tasks", sa.Column("estimate_hours", sa.Numeric(7, 2), nullable=True))
    # An unlimited numeric: a task moved between two others takes their exact midpoint.
    op.add_column("tasks", sa.Column("backlog_rank", sa.Numeric(), nullable=True))
    op.create_check_constraint(
        "ck_tasks_estimate_range", "tasks", "estimate_hours between 0 and 10000"
    )
    # Existing tasks keep the order they were created in.
    # Archived projects are read-only (ADR-140); filling a new column is not a change to them.
    op.execute("select set_config('app.allow_archived_write', 'on', true)")
    op.execute(
        "update tasks set backlog_rank = ordered.position * 1000 from ("
        "  select id, row_number() over (partition by project_id order by created_at, id)"
        "         as position from tasks"
        ") ordered where ordered.id = tasks.id"
    )
    op.execute("select set_config('app.allow_archived_write', 'off', true)")
    op.create_index("ix_tasks_project_backlog", "tasks", ["project_id", "backlog_rank", "id"])

    _check_keys(_KEYS_BEFORE + ("task_type",))
    for order, code in enumerate(_TYPES):
        op.execute(
            sa.text(
                "insert into field_options (tenant_id, field_key, code, label, sort_order) "
                "select id, 'task_type', :code, :code, :sort_order from tenants"
            ).bindparams(code=code, sort_order=order)
        )


def downgrade() -> None:
    # Types, estimates and the backlog order are lost.
    op.execute("delete from field_options where field_key = 'task_type'")
    _check_keys(_KEYS_BEFORE)
    op.drop_index("ix_tasks_project_backlog", table_name="tasks")
    op.drop_constraint("ck_tasks_estimate_range", "tasks", type_="check")
    for column in ("backlog_rank", "estimate_hours", "task_type"):
        op.drop_column("tasks", column)
