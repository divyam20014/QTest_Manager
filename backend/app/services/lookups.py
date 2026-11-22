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


def value_map(db: Session, key_col: Any, value_col: Any, ids: Iterable[UUID | None]) -> dict:
    """{key: value} for the distinct non-null `ids` (missing ids are absent)."""
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    return {k: v for k, v in db.execute(select(key_col, value_col).where(key_col.in_(wanted)))}
