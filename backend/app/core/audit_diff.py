"""ADR-116: before/after values for audit events.

`audit_diff(before, after)` returns ``{field: {"from": ..., "to": ...}}`` for the
fields whose value differs. Values are reduced to JSON-safe scalars (UUIDs and dates
become strings) and long text is truncated, so the metadata stays small. The result
goes inside the hashed audit metadata, so the hash chain covers it like any other
metadata and existing entries are never rewritten.
"""

import json
from collections.abc import Iterable, Mapping
from datetime import date, datetime
from typing import Any
from uuid import UUID

MAX_VALUE_CHARS = 300


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, UUID | date | datetime):
        return value.isoformat() if isinstance(value, date | datetime) else str(value)
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, sort_keys=True, default=str)
        except (TypeError, ValueError):
            text = str(value)
    if len(text) > MAX_VALUE_CHARS:
        return text[: MAX_VALUE_CHARS - 3] + "..."
    return text


def audit_diff(
    before: Mapping[str, Any], after: Mapping[str, Any], fields: Iterable[str] | None = None
) -> dict[str, dict[str, Any]]:
    """Changed fields only. `fields` limits (and orders) the keys considered;
    default is every key of either side."""
    keys = list(fields) if fields is not None else sorted(set(before) | set(after))
    out: dict[str, dict[str, Any]] = {}
    for key in keys:
        old, new = before.get(key), after.get(key)
        if old == new:
            continue
        out[key] = {"from": _plain(old), "to": _plain(new)}
    return out
