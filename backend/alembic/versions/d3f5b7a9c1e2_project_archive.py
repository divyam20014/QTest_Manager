"""project archive: an archived project's records are read-only (ADR-140)

Revision ID: d3f5b7a9c1e2
Revises: c2e4a6b8d0f1
Create Date: 2026-11-27

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "d3f5b7a9c1e2"
down_revision = "c2e4a6b8d0f1"
branch_labels = None
depends_on = None


def _through(*joins: str, column: str = "project_id") -> str:
    """The project ids of the changed rows `{rows}`, found through the joins."""
    return f"select {column} from {{rows}} r " + " ".join(joins)


# Comments, attachments and custom values name their owner by type and id.
_OWNERS = {
    "test_case": ("join test_cases o on o.id = r.owner_id", "o.project_id"),
    "defect": ("join defects o on o.id = r.owner_id", "o.project_id"),
    "requirement": ("join requirements o on o.id = r.owner_id", "o.project_id"),
    "task": ("join tasks o on o.id = r.owner_id", "o.project_id"),
    "test_case_version": (
        "join test_case_versions v on v.id = r.owner_id "
        "join test_cases o on o.id = v.test_case_id",
        "o.project_id",
    ),
    "execution_step": (
        "join execution_steps e on e.id = r.owner_id "
        "join test_run_cases c on c.id = e.test_run_case_id "
        "join test_runs o on o.id = c.test_run_id",
        "o.project_id",
    ),
}
_BY_OWNER = " union all ".join(
    f"select {column} from {{rows}} r {join} where r.owner_type = '{kind}'"
    for kind, (join, column) in _OWNERS.items()
)

_CASE = "join test_cases o on o.id = r.test_case_id"

# Every table whose rows belong to a project, with how to find that project.
PROJECT_OF: dict[str, str] = {
    **{
        table: "select project_id from {rows}"
        for table in (
            "builds",
            "defects",
            "project_members",
            "releases",
            "requirements",
            "shared_steps",
            "tasks",
            "test_cases",
            "test_modules",
            "test_plans",
            "test_runs",
            "test_suites",
        )
    },
    "test_case_versions": _through(_CASE, column="o.project_id"),
    "test_case_version_steps": _through(
        "join test_case_versions v on v.id = r.test_case_version_id",
        "join test_cases o on o.id = v.test_case_id",
        column="o.project_id",
    ),
    "test_data_sets": _through(_CASE, column="o.project_id"),
    "test_data_set_rows": _through(
        "join test_data_sets s on s.id = r.test_data_set_id",
        "join test_cases o on o.id = s.test_case_id",
        column="o.project_id",
    ),
    "requirement_versions": _through(
        "join requirements o on o.id = r.requirement_id", column="o.project_id"
    ),
    "requirement_test_case_links": _through(
        "join requirements o on o.id = r.requirement_id", column="o.project_id"
    ),
    "task_test_case_links": _through("join tasks o on o.id = r.task_id", column="o.project_id"),
    "defect_links": _through("join defects o on o.id = r.defect_id", column="o.project_id"),
    "test_run_cases": _through(
        "join test_runs o on o.id = r.test_run_id", column="o.project_id"
    ),
    "execution_steps": _through(
        "join test_run_cases c on c.id = r.test_run_case_id",
        "join test_runs o on o.id = c.test_run_id",
        column="o.project_id",
    ),
    "test_suite_cases": _through(
        "join test_suites o on o.id = r.test_suite_id", column="o.project_id"
    ),
    "test_plan_runs": _through(
        "join test_plans o on o.id = r.test_plan_id", column="o.project_id"
    ),
    "comments": _BY_OWNER,
    "attachments": _BY_OWNER,
    "custom_field_values": _BY_OWNER,
}

# operation -> (transition tables, the sets of changed rows to check)
_OPERATIONS = {
    "insert": ("new table as new_rows", ("new_rows",)),
    "update": ("old table as old_rows new table as new_rows", ("old_rows", "new_rows")),
    "delete": ("old table as old_rows", ("old_rows",)),
}


def _function(table: str, operation: str, query: str) -> str:
    checks = "".join(
        f"""
    if exists (select 1 from projects p where p.archived_at is not null
               and p.id in ({query.format(rows=rows)})) then
        raise exception using errcode = 'QT001',
            message = 'This project is archived, so it is read-only';
    end if;"""
        for rows in _OPERATIONS[operation][1]
    )
    return f"""
create function archived_guard_{table}_{operation}() returns trigger language plpgsql as $$
begin
    -- Cheap exit: nothing to check while no project is archived.
    if not exists (select 1 from projects where archived_at is not null) then
        return null;
    end if;
    -- Set, for one transaction, by the few organization-wide actions that may.
    if current_setting('app.allow_archived_write', true) = 'on' then
        return null;
    end if;{checks}
    return null;
end $$"""


def upgrade() -> None:
    op.add_column("projects", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("projects", sa.Column("archived_by", postgresql.UUID(), nullable=True))
    op.create_foreign_key("fk_projects_archived_by", "projects", "users", ["archived_by"], ["id"])
    op.create_index(
        "ix_projects_archived",
        "projects",
        ["tenant_id"],
        postgresql_where=sa.text("archived_at is not null"),
    )
    # One statement-level trigger per operation: a bulk insert is checked once, not per row.
    for table, query in PROJECT_OF.items():
        for operation, (transition, _) in _OPERATIONS.items():
            name = f"archived_guard_{table}_{operation}"
            op.execute(_function(table, operation, query))
            op.execute(
                f"create trigger {name} after {operation} on {table} "
                f"referencing {transition} for each statement execute function {name}()"
            )


def downgrade() -> None:
    for table in PROJECT_OF:
        for operation in _OPERATIONS:
            name = f"archived_guard_{table}_{operation}"
            op.execute(f"drop trigger {name} on {table}")
            op.execute(f"drop function {name}()")
    # Archived projects become ordinary, editable projects again.
    op.drop_index("ix_projects_archived", table_name="projects")
    op.drop_constraint("fk_projects_archived_by", "projects", type_="foreignkey")
    op.drop_column("projects", "archived_by")
    op.drop_column("projects", "archived_at")
