"""Report custom field definitions whose key clashes with a fixed standard field (ADR-115).

New definitions with a reserved key are refused by the API, but definitions that
tenants created earlier are left alone (nothing is renamed or deleted); this
read-only scan lists them so an admin can decide what to do before an "All
Fields" view shows the same field twice.

It reads across tenants, so it uses MIGRATION_DATABASE_URL (owner/superuser,
which bypasses row-level security).

Usage (from the api container, or with PYTHONPATH=. from backend/):
    python -m scripts.custom_field_clash_scan
Exit status is 0 either way; the report goes to stdout.
"""

import logging

from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.core.field_standards import RESERVED_CUSTOM_FIELD_KEYS

logger = logging.getLogger("custom_field_clash_scan")


def find_clashes(conn) -> list[dict]:  # type: ignore[no-untyped-def]
    rows = conn.execute(
        text(
            "SELECT d.tenant_id, t.name AS tenant_name, d.entity_type, d.field_key, d.label, "
            "(SELECT count(*) FROM custom_field_values v WHERE v.field_definition_id = d.id) "
            "AS value_count "
            "FROM custom_field_definitions d JOIN tenants t ON t.id = d.tenant_id "
            "ORDER BY t.name, d.entity_type, d.field_key"
        )
    ).mappings()
    return [
        dict(r)
        for r in rows
        if r["field_key"] in RESERVED_CUSTOM_FIELD_KEYS.get(r["entity_type"], frozenset())
    ]


def main() -> int:
    settings = get_settings()
    engine = create_engine(settings.migration_database_url or settings.database_url)
    with engine.connect() as conn:
        clashes = find_clashes(conn)
    if not clashes:
        print("No custom field definition clashes with a reserved standard field key.")
        return 0
    print(f"{len(clashes)} custom field definition(s) clash with a reserved key:")
    for c in clashes:
        print(
            f"  tenant={c['tenant_name']} ({c['tenant_id']}) entity={c['entity_type']} "
            f"key={c['field_key']} label={c['label']!r} values={c['value_count']}"
        )
        logger.warning("reserved custom field key clash: %s", c)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
