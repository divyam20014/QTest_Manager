"""milestones and the planning.manage permission (ADR-145)

Revision ID: b7d9f1a3c5e6
Revises: a6c8e0f2b4d5
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "b7d9f1a3c5e6"
down_revision = "a6c8e0f2b4d5"
branch_labels = None
depends_on = None

_APP_ROLE = "qtesthub_app"
_CURRENT = "NULLIF(current_setting('app.current_tenant', true), '')::uuid"
_PERMISSION = "planning.manage"


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


def upgrade() -> None:
    op.create_table(
        "milestones",
        _uuid_column("id", primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _uuid_column("tenant_id", sa.ForeignKey("tenants.id"), nullable=False),
        _uuid_column("project_id", sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("id", "project_id", name="uq_milestones_id_project"),
        sa.CheckConstraint("char_length(name) >= 2", name="ck_milestones_name_len"),
    )
    op.create_index(
        "uq_milestones_project_name_ci",
        "milestones",
        ["project_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index("ix_milestones_project_due", "milestones", ["project_id", "due_date"])
    op.create_index("ix_milestones_tenant_id", "milestones", ["tenant_id"])
    _protect("milestones")
    _guard_archived("milestones")

    op.add_column("tasks", _uuid_column("milestone_id", nullable=True))
    # Composite, so a task can only point at a milestone of its own project.
    op.create_foreign_key(
        "fk_tasks_milestone_same_project",
        "tasks",
        "milestones",
        ["milestone_id", "project_id"],
        ["id", "project_id"],
    )
    op.create_index("ix_tasks_milestone", "tasks", ["milestone_id"])

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "insert into permissions (id, code, description) "
            "values (gen_random_uuid(), :code, 'Manage milestones and sprints')"
        ),
        {"code": _PERMISSION},
    )
    # Whoever can manage tasks today, built-in or custom role, can manage planning.
    bind.execute(
        sa.text(
            "insert into role_permissions (role_id, permission_id) "
            "select g.role_id, planning.id from role_permissions g "
            "join permissions held on held.id = g.permission_id and held.code = 'task.manage' "
            "cross join permissions planning where planning.code = :code"
        ),
        {"code": _PERMISSION},
    )


def downgrade() -> None:
    # Milestones, and which tasks belonged to them, are lost.
    bind = op.get_bind()
    for statement in (
        "delete from role_permissions where permission_id in "
        "(select id from permissions where code = :code)",
        "delete from permissions where code = :code",
    ):
        bind.execute(sa.text(statement), {"code": _PERMISSION})
    op.drop_index("ix_tasks_milestone", table_name="tasks")
    op.drop_constraint("fk_tasks_milestone_same_project", "tasks", type_="foreignkey")
    op.drop_column("tasks", "milestone_id")
    _unguard_archived("milestones")
    op.drop_table("milestones")
