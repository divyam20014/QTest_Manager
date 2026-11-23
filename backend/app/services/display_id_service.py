"""ADR-115: collision-safe human-readable ids (TC_000001, BUG_000001).

Numbers come from `entity_counters` (one row per tenant and kind). A range is
reserved with a single atomic upsert (`INSERT ... ON CONFLICT DO UPDATE ...
RETURNING`), so concurrent creators block on the counter row's lock and always
receive disjoint ranges; bulk inserts reserve `n` numbers in one statement.
The increment lives in the caller's transaction: a rolled-back create rolls the
counter back with it, and the row lock is held until commit, which is what keeps
numbers unique under concurrency.

The session must already carry the tenant context (RLS), as every tenant-scoped
service call does.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.field_standards import DISPLAY_ID_KINDS, DISPLAY_ID_MIN_DIGITS, DISPLAY_ID_PREFIX

_RESERVE_SQL = text(
    """
    INSERT INTO entity_counters (tenant_id, kind, next_value)
    VALUES (:tenant_id, :kind, :n + 1)
    ON CONFLICT (tenant_id, kind)
    DO UPDATE SET next_value = entity_counters.next_value + :n
    RETURNING next_value - :n AS first_value
    """
)


_BUMP_SQL = text(
    """
    INSERT INTO entity_counters (tenant_id, kind, next_value)
    VALUES (:tenant_id, :kind, :floor + 1)
    ON CONFLICT (tenant_id, kind)
    DO UPDATE SET next_value = GREATEST(entity_counters.next_value, :floor + 1)
    """
)


def ensure_counter_above(db: Session, tenant_id: UUID, kind: str, highest_used: int) -> None:
    """Move the counter past `highest_used` (a display id kept from an import) so the next
    allocation can never collide with it. Never moves it backwards."""
    if kind not in DISPLAY_ID_KINDS:
        raise ValueError(f"Unknown display id kind: {kind!r}")
    db.execute(_BUMP_SQL, {"tenant_id": tenant_id, "kind": kind, "floor": highest_used})


def format_display_id(kind: str, seq: int) -> str:
    """TC_000001 / BUG_000001 (grows past six digits naturally)."""
    return f"{DISPLAY_ID_PREFIX[kind]}{seq:0{DISPLAY_ID_MIN_DIGITS}d}"


def reserve_range(db: Session, tenant_id: UUID, kind: str, n: int) -> int:
    """Atomically reserve `n` consecutive numbers; returns the first one."""
    if kind not in DISPLAY_ID_KINDS:
        raise ValueError(f"Unknown display id kind: {kind!r}")
    if n < 1:
        raise ValueError("n must be at least 1")
    first = db.execute(_RESERVE_SQL, {"tenant_id": tenant_id, "kind": kind, "n": n}).scalar_one()
    return int(first)


def next_display_ids(db: Session, tenant_id: UUID, kind: str, n: int = 1) -> list[tuple[int, str]]:
    """Reserve `n` ids for (tenant, kind) and return `[(display_seq, display_id), ...]`
    in ascending order. Safe under concurrency; one statement regardless of `n`."""
    first = reserve_range(db, tenant_id, kind, n)
    return [(seq, format_display_id(kind, seq)) for seq in range(first, first + n)]


def next_display_id(db: Session, tenant_id: UUID, kind: str) -> tuple[int, str]:
    return next_display_ids(db, tenant_id, kind, 1)[0]
