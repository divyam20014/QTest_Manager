"""ADR-118: indexes for the defect list (search, filters, sorts) and link lookups

Revision ID: b6e0c2a8d4f7
Revises: a9d3f5b7c1e4
Create Date: 2026-11-28 09:10:00.000000

Built CONCURRENTLY inside ``autocommit_block`` (ADR-113 style); each build is
preceded by DROP ... IF EXISTS so an interrupted build is repaired by re-running.

* ``defects(tenant_id, display_seq)`` over live rows: sort by Bug ID.
* trigram GIN on ``defects.display_id``: the display-id part of the search box.
* trigram GIN on ``defects.description``: the description snippet part of the search.
* ``defects(tenant_id, severity)`` / ``(tenant_id, priority)``: filters and sorts.
* ``defects(tenant_id, fix_version)``: filter and sort by Fix Version.
* ``defect_links(tenant_id, linkable_type, linkable_id)``: "defects of this test
  case / run case" (the bidirectional link lookup).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b6e0c2a8d4f7"
down_revision: str | None = "a9d3f5b7c1e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEXES: list[tuple[str, str, str]] = [
    (
        "ix_defects_tenant_display_seq",
        "defects",
        "(tenant_id, display_seq) WHERE deleted_at IS NULL",
    ),
    (
        "ix_defects_display_id_trgm",
        "defects",
        "USING gin (display_id gin_trgm_ops) WHERE display_id IS NOT NULL",
    ),
    (
        "ix_defects_description_trgm",
        "defects",
        "USING gin (description gin_trgm_ops) WHERE description IS NOT NULL",
    ),
    ("ix_defects_tenant_severity", "defects", "(tenant_id, severity) WHERE deleted_at IS NULL"),
    ("ix_defects_tenant_priority", "defects", "(tenant_id, priority) WHERE deleted_at IS NULL"),
    (
        "ix_defects_tenant_fix_version",
        "defects",
        "(tenant_id, fix_version) WHERE fix_version IS NOT NULL AND deleted_at IS NULL",
    ),
    (
        "ix_defect_links_tenant_target",
        "defect_links",
        "(tenant_id, linkable_type, linkable_id)",
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
