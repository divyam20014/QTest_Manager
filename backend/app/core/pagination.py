"""Keyset (cursor) paging helpers (ADR-113).

Offset paging (`page`/`offset`) stays the default and is unchanged. A client
that sends the optional `cursor` query parameter (empty string = first page)
opts in to keyset paging instead: the response then also carries the cursor of
the next page (`next_cursor` in the body, or an `X-Next-Cursor` header for the
endpoints that return a bare list), or null on the last page. Deep pages cost
the same as the first one, instead of an ever larger OFFSET scan + sort.

A cursor is an opaque urlsafe-base64 token over `(created_at, id)` of the last
row served. It carries no tenant or user data and is only ever used as a
comparison value inside an already tenant/role-scoped query, so a forged or
foreign cursor can never widen what a caller may see.
"""

import base64
import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, literal, or_, tuple_

from app.core.errors import ValidationAppError


def encode_cursor(created_at: datetime, row_id: UUID) -> str:
    raw = json.dumps([created_at.isoformat(), str(row_id)], separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID] | None:
    """None for the empty cursor (= first page); ValidationAppError if malformed."""
    if cursor == "":
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_raw, id_raw = json.loads(base64.urlsafe_b64decode(padded.encode()))
        return datetime.fromisoformat(created_raw), UUID(id_raw)
    except (ValueError, TypeError, KeyError):
        raise ValidationAppError("Invalid cursor") from None


def keyset_after(
    created_col,
    id_col,
    position: tuple[datetime, UUID],
    *,
    created_desc: bool,
    id_desc: bool,
):
    """WHERE-clause selecting the rows strictly after `position` in the order
    (created_col [DESC], id_col [DESC])."""
    created_at, row_id = position
    if created_desc == id_desc:
        pair = tuple_(created_col, id_col)
        target = tuple_(literal(created_at), literal(row_id))
        return pair < target if created_desc else pair > target
    # Mixed directions (created_at DESC, id ASC) cannot use a row comparison.
    created_cmp = created_col < created_at if created_desc else created_col > created_at
    id_cmp = id_col < row_id if id_desc else id_col > row_id
    return or_(created_cmp, and_(created_col == created_at, id_cmp))
