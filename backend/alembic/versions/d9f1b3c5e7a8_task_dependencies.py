"""task dependencies (ADR-147)

Revision ID: d9f1b3c5e7a8
Revises: c8e0a2b4d6f7
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d9f1b3c5e7a8"
down_revision = "c8e0a2b4d6f7"
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


def upgrade() -> None:
    op.create_table(
        "task_dependencies",
        _uuid_column("id", primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _uuid_column("tenant_id", sa.ForeignKey("tenants.id"), nullable=False),
        _uuid_column("project_id", sa.ForeignKey("projects.id"), nullable=False),
        _uuid_column("task_id", nullable=False),
        _uuid_column("depends_on_task_id", nullable=False),
        _uuid_column("created_by", sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        # Both composite, so a link cannot cross projects.
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["tasks.id", "tasks.project_id"],
            name="fk_task_dependencies_task_same_project",
        ),
        sa.ForeignKeyConstraint(
            ["depends_on_task_id", "project_id"],
            ["tasks.id", "tasks.project_id"],
            name="fk_task_dependencies_other_same_project",
        ),
        sa.UniqueConstraint("task_id", "depends_on_task_id", name="uq_task_dependencies_pair"),
        sa.CheckConstraint("task_id <> depends_on_task_id", name="ck_task_dependencies_not_self"),
    )
    op.create_index("ix_task_dependencies_depends_on", "task_dependencies", ["depends_on_task_id"])
    op.create_index("ix_task_dependencies_project", "task_dependencies", ["project_id"])
    op.create_index("ix_task_dependencies_tenant_id", "task_dependencies", ["tenant_id"])
    op.create_index("ix_task_dependencies_created_by", "task_dependencies", ["created_by"])
    _protect("task_dependencies")
    _guard_archived("task_dependencies")

    # No circles, whoever writes. The lock is the one the service takes; holding it means the
    # chain read next includes every link committed before this one.
    op.execute(
        """
create function task_dependencies_no_cycle() returns trigger language plpgsql as $$
begin
    perform pg_advisory_xact_lock(hashtext('dependencies:' || new.project_id::text));
    if exists (
        with recursive chain(id) as (
            select new.depends_on_task_id
            union
            select d.depends_on_task_id from task_dependencies d join chain c on d.task_id = c.id
        )
        select 1 from chain where id = new.task_id
    ) then
        raise exception using errcode = 'QT002', message = 'Task dependencies cannot form a circle';
    end if;
    return new;
end $$"""
    )
    op.execute(
        "create trigger task_dependencies_no_cycle before insert or update on task_dependencies "
        "for each row execute function task_dependencies_no_cycle()"
    )


def downgrade() -> None:
    # The links are lost; the tasks stay.
    _unguard_archived("task_dependencies")
    op.drop_table("task_dependencies")
    op.execute("drop function task_dependencies_no_cycle()")
