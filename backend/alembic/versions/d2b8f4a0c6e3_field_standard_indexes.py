"""ADR-115: indexes for the 22-field standard, built CONCURRENTLY (ADR-113 style)

Revision ID: d2b8f4a0c6e3
Revises: c1a7e3f9b5d2
Create Date: 2026-11-26 09:30:00.000000

Kept apart from the column migration because CREATE INDEX CONCURRENTLY cannot run
inside a transaction (hence `autocommit_block`). Each build is preceded by a
DROP ... IF EXISTS so an interrupted build (which leaves an INVALID index) is
repaired by simply re-running.

`defects(tenant_id, status)` already exists as ix_defects_tenant_status
(ADR-113), so it is not duplicated here.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d2b8f4a0c6e3"
down_revision: str | None = "c1a7e3f9b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (name, unique, table, definition-after-table)
_INDEXES: list[tuple[str, bool, str, str]] = [
    (
        "uq_test_cases_tenant_display_id",
        True,
        "test_cases",
        "(tenant_id, display_id) WHERE display_id IS NOT NULL",
    ),
    (
        "uq_defects_tenant_display_id",
        True,
        "defects",
        "(tenant_id, display_id) WHERE display_id IS NOT NULL",
    ),
    (
        "ix_test_cases_tenant_test_type",
        False,
        "test_cases",
        "(tenant_id, test_type) WHERE test_type IS NOT NULL",
    ),
    (
        "ix_test_cases_tenant_automation_status",
        False,
        "test_cases",
        "(tenant_id, automation_status) WHERE automation_status IS NOT NULL",
    ),
    ("ix_defects_labels_gin", False, "defects", "USING gin (labels)"),
    (
        "ix_test_run_cases_executed_by",
        False,
        "test_run_cases",
        "(executed_by) WHERE executed_by IS NOT NULL",
    ),
    (
        "ix_defects_test_run_case",
        False,
        "defects",
        "(test_run_case_id) WHERE test_run_case_id IS NOT NULL",
    ),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, unique, table, definition in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            kind = "UNIQUE INDEX" if unique else "INDEX"
            op.execute(f"CREATE {kind} CONCURRENTLY {name} ON {table} {definition}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _unique, _table, _definition in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
