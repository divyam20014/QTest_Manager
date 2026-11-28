"""sprints and their history (ADR-146)

Revision ID: c8e0a2b4d6f7
Revises: b7d9f1a3c5e6
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "c8e0a2b4d6f7"
down_revision = "b7d9f1a3c5e6"
branch_labels = None
depends_on = None

_APP_ROLE = "qtesthub_app"
_CURRENT = "NULLIF(current_setting('app.current_tenant', true), '')::uuid"


def _protect(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING (tenant_id = {_CURRENT}) WITH CHECK (tenant_id = {_CURRENT})"
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {_APP_ROLE}")


def _guard_archived(table: str) -> None:
    """ADR-140: the same read-only guard every table of project records has."""
    sets = {
        "insert": ("new table as new_rows", ("new_rows",)),
        "update": ("old table as old_rows new table as new_rows", ("old_rows", "new_rows")),
        "delete": ("old table as old_rows", ("old_rows",)),
    }
    for operation, (transition, changed) in sets.items():
        name = f"archived_guard_{table}_{operation}"
        checks = "".join(
            f"""
    if exists (select 1 from projects p where p.archived_at is not null
               and p.id in (select project_id from {rows})) then
        raise exception using errcode = 'QT001',
            message = 'This project is archived, so it is read-only';
    end if;"""
            for rows in changed
        )
        op.execute(
            f"""
create function {name}() returns trigger language plpgsql as $$
begin
    if not exists (select 1 from projects where archived_at is not null) then
        return null;
    end if;
    if current_setting('app.allow_archived_write', true) = 'on' then
        return null;
    end if;{checks}
    return null;
end $$"""
        )
        op.execute(
            f"create trigger {name} after {operation} on {table} "
            f"referencing {transition} for each statement execute function {name}()"
        )


def _unguard_archived(table: str) -> None:
    for operation in ("insert", "update", "delete"):
        name = f"archived_guard_{table}_{operation}"
        op.execute(f"drop trigger {name} on {table}")
        op.execute(f"drop function {name}()")


def _uuid_column(name: str, *args, **kwargs) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), *args, **kwargs)


def _id_column() -> sa.Column:
    return _uuid_column("id", primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _timestamp(name: str, **kwargs) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), **kwargs)


def upgrade() -> None:
    op.create_table(
        "sprints",
        _id_column(),
        _uuid_column("tenant_id", sa.ForeignKey("tenants.id"), nullable=False),
        _uuid_column("project_id", sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("state", sa.String(10), nullable=False, server_default="planned"),
        _timestamp("started_at", nullable=True),
        _timestamp("closed_at", nullable=True),
        _timestamp("created_at", nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("id", "project_id", name="uq_sprints_id_project"),
        sa.CheckConstraint("char_length(name) >= 2", name="ck_sprints_name_len"),
        sa.CheckConstraint("start_date <= end_date", name="ck_sprints_date_order"),
        sa.CheckConstraint("state in ('planned','active','closed')", name="ck_sprints_state"),
    )
    op.create_index(
        "uq_sprints_project_name_ci", "sprints", ["project_id", sa.text("lower(name)")], unique=True
    )
    op.create_index(
        "uq_sprints_one_active_per_project",
        "sprints",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("state = 'active'"),
    )
    op.create_index("ix_sprints_project", "sprints", ["project_id", "state"])
    op.create_index("ix_sprints_tenant_id", "sprints", ["tenant_id"])

    op.create_table(
        "sprint_task_history",
        _id_column(),
        _uuid_column("tenant_id", sa.ForeignKey("tenants.id"), nullable=False),
        _uuid_column("project_id", sa.ForeignKey("projects.id"), nullable=False),
        _uuid_column("sprint_id", nullable=False),
        _uuid_column("task_id", nullable=False),
        sa.Column("added_after_start", sa.Boolean(), nullable=False),
        _timestamp("added_at", nullable=False, server_default=sa.func.now()),
        _timestamp("removed_at", nullable=True),
        sa.Column("estimate_at_add", sa.Numeric(7, 2), nullable=True),
        sa.Column("estimate_at_end", sa.Numeric(7, 2), nullable=True),
        sa.Column("done_at_close", sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(
            ["sprint_id", "project_id"],
            ["sprints.id", "sprints.project_id"],
            name="fk_sprint_history_sprint_same_project",
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["tasks.id", "tasks.project_id"],
            name="fk_sprint_history_task_same_project",
        ),
        sa.UniqueConstraint("sprint_id", "task_id", name="uq_sprint_history_sprint_task"),
    )
    op.create_index("ix_sprint_history_task", "sprint_task_history", ["task_id"])
    op.create_index("ix_sprint_history_project", "sprint_task_history", ["project_id"])
    op.create_index("ix_sprint_history_tenant_id", "sprint_task_history", ["tenant_id"])

    for table in ("sprints", "sprint_task_history"):
        _protect(table)
        _guard_archived(table)

    op.add_column("tasks", _uuid_column("sprint_id", nullable=True))
    op.create_foreign_key(
        "fk_tasks_sprint_same_project",
        "tasks",
        "sprints",
        ["sprint_id", "project_id"],
        ["id", "project_id"],
    )
    op.create_index("ix_tasks_sprint", "tasks", ["sprint_id"])


def downgrade() -> None:
    # Sprints and their history are lost; the tasks stay.
    op.drop_index("ix_tasks_sprint", table_name="tasks")
    op.drop_constraint("fk_tasks_sprint_same_project", "tasks", type_="foreignkey")
    op.drop_column("tasks", "sprint_id")
    for table in ("sprint_task_history", "sprints"):
        _unguard_archived(table)
        op.drop_table(table)
