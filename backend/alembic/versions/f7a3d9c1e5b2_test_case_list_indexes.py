"""ADR-116: indexes for test case list search, filters and sorts (CONCURRENTLY)

Revision ID: f7a3d9c1e5b2
Revises: e4c8a1d7f3b9
Create Date: 2026-11-27 09:30:00.000000

Built CONCURRENTLY inside ``autocommit_block`` (ADR-113 style); each build is
preceded by DROP ... IF EXISTS so an interrupted build is repaired by re-running.

* ``(tenant_id, display_seq)`` over live rows: sort by Test Case ID.
* trigram GIN on ``test_cases.display_id`` / ``requirement_ref`` / ``test_modules.name``:
  the ILIKE search over id, requirement and module name.
* ``(tenant_id, severity)``: severity filter and sort.
* ``test_run_cases(tenant_id, test_case_id)`` over executed rows: the "latest
  execution" lookup behind execution status, executed-by and last-executed sort.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f7a3d9c1e5b2"
down_revision: str | None = "e4c8a1d7f3b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEXES: list[tuple[str, str, str]] = [
    (
        "ix_test_cases_tenant_display_seq",
        "test_cases",
        "(tenant_id, display_seq) WHERE deleted_at IS NULL",
    ),
    (
        "ix_test_cases_display_id_trgm",
        "test_cases",
        "USING gin (display_id gin_trgm_ops) WHERE display_id IS NOT NULL",
    ),
    (
        "ix_test_cases_requirement_ref_trgm",
        "test_cases",
        "USING gin (requirement_ref gin_trgm_ops) WHERE requirement_ref IS NOT NULL",
    ),
    ("ix_test_modules_name_trgm", "test_modules", "USING gin (name gin_trgm_ops)"),
    (
        "ix_test_cases_tenant_severity",
        "test_cases",
        "(tenant_id, severity) WHERE severity IS NOT NULL",
    ),
    (
        "ix_test_run_cases_executed_case",
        "test_run_cases",
        "(tenant_id, test_case_id) WHERE status IN ('passed','failed','blocked','ignored')",
    ),
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    with op.get_context().autocommit_block():
        for name, table, definition in _INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            op.execute(f"CREATE INDEX CONCURRENTLY {name} ON {table} {definition}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _table, _definition in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
