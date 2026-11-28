"""acceptance criteria per requirement version (ADR-149)

Revision ID: f3b5d7e9a1c2
Revises: e2a4c6d8f0b1
Create Date: 2026-11-28

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f3b5d7e9a1c2"
down_revision = "e2a4c6d8f0b1"
branch_labels = None
depends_on = None

_APP_ROLE = "qtesthub_app"
_CURRENT = "NULLIF(current_setting('app.current_tenant', true), '')::uuid"
_TABLE = "requirement_acceptance_criteria"
# The table has no project column: it is found through the version's requirement (ADR-140).
_PROJECT_OF_ROWS = (
    "select o.project_id from {rows} r "
    "join requirement_versions v on v.id = r.requirement_version_id "
    "join requirements o on o.id = v.requirement_id"
)

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
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        _TABLE,
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", uuid, sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "requirement_version_id",
            uuid,
            sa.ForeignKey("requirement_versions.id"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.UniqueConstraint(
            "requirement_version_id", "position", name="uq_acceptance_criteria_position"
        ),
        sa.CheckConstraint(
            "char_length(text) between 1 and 2000", name="ck_acceptance_criteria_text"
        ),
    )
    op.create_index("ix_acceptance_criteria_tenant_id", _TABLE, ["tenant_id"])
    op.execute(f"ALTER TABLE {_TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {_TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {_TABLE} "
        f"USING (tenant_id = {_CURRENT}) WITH CHECK (tenant_id = {_CURRENT})"
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {_TABLE} TO {_APP_ROLE}")
    for operation, (transition, _) in _OPERATIONS.items():
        name = f"archived_guard_{_TABLE}_{operation}"
        op.execute(_function(_TABLE, operation, _PROJECT_OF_ROWS))
        op.execute(
            f"create trigger {name} after {operation} on {_TABLE} "
            f"referencing {transition} for each statement execute function {name}()"
        )


def downgrade() -> None:
    # Acceptance criteria are lost.
    for operation in _OPERATIONS:
        name = f"archived_guard_{_TABLE}_{operation}"
        op.execute(f"drop trigger {name} on {_TABLE}")
        op.execute(f"drop function {name}()")
    op.drop_table(_TABLE)
