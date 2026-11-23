import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import insert, select, text
from sqlalchemy.orm import Session

from app.models.audit import AuditLog

GENESIS_HASH = "0" * 64


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def record_audit_event(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: UUID,
    metadata: dict | None = None,
    platform_admin_id: UUID | None = None,
    service_token_id: UUID | None = None,
) -> AuditLog:
    """Append-only, hash-chained audit entry (ADR-006).

    Takes a per-tenant advisory lock for the duration of the transaction
    (ADR-016) so concurrent appends to the same tenant's chain can't read
    the same "previous hash" before either commits.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:tenant_id))"), {"tenant_id": str(tenant_id)}
    )

    # The chain order must equal the order `verify_chain` re-walks: (created_at, id).
    # `id` is a random UUID, so it can only break a tie arbitrarily -- and the
    # Python clock ticks coarsely on some platforms (about 1-16 ms on Windows), so
    # back-to-back events can get the same timestamp. A tied pair was then chained
    # in write order but re-walked in random-UUID order, which looked like tampering
    # on an untouched log. So under the advisory lock above, each event is stamped
    # strictly later than the chain head, whatever the clock says (this also covers a
    # clock that steps backwards). `id` still sorts the query deterministically but
    # never decides the order, because no two events in a tenant share a timestamp.
    head = db.execute(
        select(AuditLog.record_hash, AuditLog.created_at)
        .where(AuditLog.tenant_id == tenant_id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(1)
    ).first()
    prev_hash = head.record_hash if head else GENESIS_HASH

    created_at = datetime.now(UTC)
    if head is not None and created_at <= head.created_at:
        created_at = head.created_at + timedelta(microseconds=1)
    payload = {
        "tenant_id": str(tenant_id),
        "user_id": str(user_id) if user_id else None,
        "platform_admin_id": str(platform_admin_id) if platform_admin_id else None,
        "service_token_id": str(service_token_id) if service_token_id else None,
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "metadata": metadata,
        "created_at": created_at.isoformat(),
        "prev_hash": prev_hash,
    }
    record_hash = hashlib.sha256(_canonical(payload).encode()).hexdigest()

    entry = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        platform_admin_id=platform_admin_id,
        service_token_id=service_token_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        event_metadata=metadata,
        prev_hash=prev_hash,
        record_hash=record_hash,
        created_at=created_at,
    )
    db.add(entry)
    db.flush()
    return entry


def record_audit_events_bulk(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    events: list[tuple[str, str, UUID, dict | None]],
) -> int:
    """Append many events `(action, entity_type, entity_id, metadata)` to the hash chain in
    one go (ADR-120: an import writes one compact event per created record). Same chain
    rules as `record_audit_event` -- advisory lock, strictly increasing timestamps, each
    hash covering the previous one -- but the head is read once and the rows are inserted
    in batches, so 5,000 events cost a handful of statements instead of 10,000."""
    if not events:
        return 0
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:tenant_id))"), {"tenant_id": str(tenant_id)}
    )
    head = db.execute(
        select(AuditLog.record_hash, AuditLog.created_at)
        .where(AuditLog.tenant_id == tenant_id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(1)
    ).first()
    prev_hash = head.record_hash if head else GENESIS_HASH
    created_at = datetime.now(UTC)
    if head is not None and created_at <= head.created_at:
        created_at = head.created_at + timedelta(microseconds=1)

    rows: list[dict] = []
    for action, entity_type, entity_id, metadata in events:
        payload = {
            "tenant_id": str(tenant_id),
            "user_id": str(user_id) if user_id else None,
            "platform_admin_id": None,
            "service_token_id": None,
            "action": action,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "metadata": metadata,
            "created_at": created_at.isoformat(),
            "prev_hash": prev_hash,
        }
        record_hash = hashlib.sha256(_canonical(payload).encode()).hexdigest()
        rows.append(
            {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "platform_admin_id": None,
                "service_token_id": None,
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "metadata": metadata,
                "prev_hash": prev_hash,
                "record_hash": record_hash,
                "created_at": created_at,
            }
        )
        prev_hash = record_hash
        created_at = created_at + timedelta(microseconds=1)

    table = AuditLog.__table__  # type: ignore[attr-defined]
    for start in range(0, len(rows), 1000):
        db.execute(insert(table), rows[start : start + 1000])  # type: ignore[arg-type]
    return len(rows)
