"""ADR-082: platform-level audit trail for the Platform Admin plane.

`record_platform_event` is the single write path. It appends one hash-chained
row (same technique as app/core/audit.py: a serialising advisory lock, a strictly
increasing created_at, a SHA-256 over a canonical payload that includes the
previous hash). Only whitelisted, scalar `details` keys are stored, and callers
never pass passwords, codes, secrets or tokens in the first place.

Failures must survive the 401 that follows them, so `commit=True` commits the
session right here (every failure path already commits its lockout counters the
same way). Successes pass commit=False and ride in the action's own transaction.
"""

import hashlib
import json
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.logging import logger
from app.models.identity import PlatformAdmin
from app.models.platform_audit import PlatformAuditEvent
from app.schemas.audit import ChainVerificationResult
from app.services import audit_checkpoint_service

GENESIS_HASH = "0" * 64
SUCCESS = "success"
FAILURE = "failure"

# Set per request by a middleware in app/main.py; None outside a request
# (CLI scripts, tests that call the services directly).
client_ip_var: ContextVar[str | None] = ContextVar("platform_audit_client_ip", default=None)

# Whitelist: anything else a caller passes is dropped, so a mistake can never
# put a secret into the trail.
ALLOWED_DETAIL_KEYS = frozenset({"reason", "method", "source", "target_email", "status"})
_MAX_VALUE_LEN = 120
_MAX_EMAIL_LEN = 254


def normalize_email(email: str | None) -> str | None:
    if email is None:
        return None
    cleaned = "".join(ch for ch in email.strip().lower() if ch.isprintable())
    return cleaned[:_MAX_EMAIL_LEN] or None


def _clean_details(details: dict | None) -> dict | None:
    if not details:
        return None
    out: dict = {}
    for key, value in details.items():
        if key not in ALLOWED_DETAIL_KEYS or value is None:
            continue
        if isinstance(value, bool | int):
            out[key] = value
        else:
            out[key] = str(value)[:_MAX_VALUE_LEN]
    return out or None


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _payload(row_like: dict) -> dict:
    created_at: datetime = row_like["created_at"]
    return {
        "id": str(row_like["id"]),
        "created_at": created_at.astimezone(UTC).isoformat(),
        "event_type": row_like["event_type"],
        "actor_admin_id": str(row_like["actor_admin_id"]) if row_like["actor_admin_id"] else None,
        "actor_email": row_like["actor_email"],
        "target_admin_id": (
            str(row_like["target_admin_id"]) if row_like["target_admin_id"] else None
        ),
        "ip": row_like["ip"],
        "outcome": row_like["outcome"],
        "details": row_like["details"],
        "prev_hash": row_like["prev_hash"],
    }


def _hash(row_like: dict) -> str:
    return hashlib.sha256(_canonical(_payload(row_like)).encode()).hexdigest()


def record_platform_event(
    db: Session,
    event_type: str,
    *,
    outcome: str = SUCCESS,
    actor_admin_id: UUID | None = None,
    actor_email: str | None = None,
    target_admin_id: UUID | None = None,
    details: dict | None = None,
    ip: str | None = None,
    commit: bool = False,
) -> PlatformAuditEvent:
    """Appends one chained event. `commit=True` commits the caller's session
    (use it on failure paths that raise right after, so the row is not lost)."""
    # Flush the caller's pending row changes FIRST: they take their row locks
    # before this transaction asks for the chain lock, so every writer acquires
    # locks in the same order (rows, then chain) and cannot deadlock.
    db.flush()
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('platform_audit_events'))"))

    if actor_email is None and actor_admin_id is not None:
        actor_email = db.execute(
            select(PlatformAdmin.email).where(PlatformAdmin.id == actor_admin_id)
        ).scalar_one_or_none()

    head = db.execute(
        select(PlatformAuditEvent.record_hash, PlatformAuditEvent.created_at)
        .order_by(PlatformAuditEvent.created_at.desc(), PlatformAuditEvent.id.desc())
        .limit(1)
    ).first()
    # Strictly later than the chain head whatever the clock says, so the
    # (created_at, id) order verify_chain re-walks always equals write order.
    created_at = datetime.now(UTC)
    if head is not None and created_at <= head.created_at:
        created_at = head.created_at + timedelta(microseconds=1)

    fields = {
        "id": uuid4(),
        "created_at": created_at,
        "event_type": event_type,
        "actor_admin_id": actor_admin_id,
        "actor_email": normalize_email(actor_email),
        "target_admin_id": target_admin_id,
        "ip": (ip or client_ip_var.get() or None),
        "outcome": outcome,
        "details": _clean_details(details),
        "prev_hash": head.record_hash if head else GENESIS_HASH,
    }
    fields["record_hash"] = _hash(fields)
    event = PlatformAuditEvent(**fields)
    db.add(event)
    db.flush()
    if commit:
        db.commit()
    return event


def list_events(
    db: Session,
    *,
    event_type: str | None = None,
    outcome: str | None = None,
    actor_email: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[PlatformAuditEvent], int]:
    conditions = []
    if event_type:
        conditions.append(PlatformAuditEvent.event_type == event_type)
    if outcome:
        conditions.append(PlatformAuditEvent.outcome == outcome)
    if actor_email:
        needle = actor_email.strip().lower().replace("\\", "\\\\").replace("%", "\\%")
        needle = needle.replace("_", "\\_")
        conditions.append(PlatformAuditEvent.actor_email.ilike(f"%{needle}%", escape="\\"))
    total = db.execute(
        select(func.count()).select_from(PlatformAuditEvent).where(*conditions)
    ).scalar_one()
    rows = list(
        db.execute(
            select(PlatformAuditEvent)
            .where(*conditions)
            .order_by(PlatformAuditEvent.created_at.desc(), PlatformAuditEvent.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).scalars()
    )
    return rows, total


def verify_chain(db: Session) -> ChainVerificationResult:
    """Re-walks the whole chain and recomputes every hash from the stored
    fields (not trusting the stored record_hash on sight)."""
    # Streamed in batches through a server-side cursor: memory is flat (ADR-087).
    stream = db.execute(
        select(
            PlatformAuditEvent.id,
            PlatformAuditEvent.created_at,
            PlatformAuditEvent.event_type,
            PlatformAuditEvent.actor_admin_id,
            PlatformAuditEvent.actor_email,
            PlatformAuditEvent.target_admin_id,
            PlatformAuditEvent.ip,
            PlatformAuditEvent.outcome,
            PlatformAuditEvent.details,
            PlatformAuditEvent.prev_hash,
            PlatformAuditEvent.record_hash,
        )
        .order_by(PlatformAuditEvent.created_at, PlatformAuditEvent.id)
        .execution_options(yield_per=2000)
    )
    expected_prev = GENESIS_HASH
    walked = 0
    broken_at: UUID | None = None
    try:
        for row in stream:
            walked += 1
            fields = {
                "id": row.id,
                "created_at": row.created_at,
                "event_type": row.event_type,
                "actor_admin_id": row.actor_admin_id,
                "actor_email": row.actor_email,
                "target_admin_id": row.target_admin_id,
                "ip": row.ip,
                "outcome": row.outcome,
                "details": row.details,
                "prev_hash": row.prev_hash,
            }
            if row.prev_hash != expected_prev or _hash(fields) != row.record_hash:
                logger.error("security_event=platform_audit_chain_broken broken_at_id=%s", row.id)
                broken_at = row.id
                break
            expected_prev = row.record_hash
    finally:
        stream.close()
    return _with_checkpoints(db, walked, broken_at)


def _with_checkpoints(
    db: Session, checked_count: int, broken_at_id: UUID | None
) -> ChainVerificationResult:
    """ADR-085: also check the signed checkpoints (always, even after a failed
    walk). `valid` is the conjunction."""
    checked, failure = audit_checkpoint_service.verify_checkpoints(
        db, audit_checkpoint_service.PLATFORM_SCOPE
    )
    return ChainVerificationResult(
        valid=broken_at_id is None and failure is None,
        checked_count=checked_count,
        broken_at_id=broken_at_id,
        checkpoints_checked=checked,
        checkpoint_failure=failure,
    )
