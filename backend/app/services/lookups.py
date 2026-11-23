"""Batch lookups for list serializers (ADR-113).

The per-row `to_out` helpers used to issue ~10 tiny queries per row (user
names, project names, status labels, custom fields, ...). The list endpoints
now resolve every referenced id for the whole page with one `WHERE id = ANY()`
query per table via these helpers. Pure reads: they run under the caller's
transaction, so RLS (and the already-set tenant context) apply exactly as for
the single-row queries they replace.
"""

from collections.abc import Iterable
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session


def value_map(
    db: Session,
    key_col: Any,
    value_col: Any,
    ids: Iterable[UUID | None],
    *,
    include_deleted: bool = False,
) -> dict:
    """{key: value} for the distinct non-null `ids` (missing ids are absent).
    `include_deleted` also resolves soft-deleted rows (ADR-116: a defect still names
    the test case it was raised against)."""
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    stmt = select(key_col, value_col).where(key_col.in_(wanted))
    if include_deleted:
        stmt = stmt.execution_options(include_deleted=True)
    return {k: v for k, v in db.execute(stmt)}
