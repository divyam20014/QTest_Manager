import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, text
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
) -> AuditLog:
    """Append-only, hash-chained audit entry (ADR-006).

    Takes a per-tenant advisory lock for the duration of the transaction
    (ADR-016) so concurrent appends to the same tenant's chain can't read
    the same "previous hash" before either commits.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:tenant_id))"), {"tenant_id": str(tenant_id)}
    )

    # Tiebreak on `id` as well as `created_at`: two events can land on the
    # same timestamp (Python-computed before insert, not DB-generated), and
    # without a secondary sort key Postgres's order for ties is undefined.
    # `verify_chain` below walks rows in (created_at, id) order, so this
    # query must agree with that ordering (reversed) or a tied pair can be
    # chained in one order here and re-walked in the other order there,
    # which looks like tamper/corruption even though nothing was tampered.
    prev_hash = (
        db.execute(
            select(AuditLog.record_hash)
            .where(AuditLog.tenant_id == tenant_id)
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        )
        .scalars()
        .first()
        or GENESIS_HASH
    )

    created_at = datetime.now(UTC)
    payload = {
        "tenant_id": str(tenant_id),
        "user_id": str(user_id) if user_id else None,
        "platform_admin_id": str(platform_admin_id) if platform_admin_id else None,
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
