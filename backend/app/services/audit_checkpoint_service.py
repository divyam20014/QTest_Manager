"""ADR-085 (GAP-01): signed checkpoints over the audit hash chains.

The hash chains (ADR-006 tenant `audit_logs`, ADR-082 `platform_audit_events`)
detect an edit, but whoever holds database-owner rights can recompute a whole
chain consistently. A checkpoint anchors the chain head (last record id, its
hash, the running count) at a point in time, links to the previous checkpoint,
and signs the result with HMAC-SHA256 using a key that is NOT in the database
(settings.audit_checkpoint_hmac_key). The app role can only INSERT checkpoints.
After a rewrite the anchor row is gone or hashes differently, so verification
fails, and the attacker cannot forge a matching signature without the key.

What this does not do: stop a party who holds BOTH database-owner rights and the
HMAC key, or detect deletion of the newest checkpoint(s) when none were exported
off-box. See docs (KNOWN_GAPS GAP-01, ADR-085).

A scope is 'platform' or 'tenant:<uuid>'. Checkpoint creation deliberately does
not write an audit event of its own: that event would be "new activity" and the
next scheduled run would checkpoint it again, forever.
"""

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, literal, select, text, tuple_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ValidationAppError
from app.core.logging import logger
from app.models.audit import AuditChainCheckpoint, AuditLog
from app.models.platform_audit import PlatformAuditEvent
from app.models.tenant import Tenant
from app.schemas.audit import CheckpointFailure

GENESIS_HASH = "0" * 64
PLATFORM_SCOPE = "platform"

# Public on purpose: used only when AUDIT_CHECKPOINT_HMAC_KEY is empty, which
# production configuration validation rejects. A signature made with it proves
# nothing about tampering by anyone who can read this source.
_DEV_ONLY_KEY = "dev-only-audit-checkpoint-key--never-use-in-production"
_warned_dev_key = False

REASONS = (
    "signature_invalid",
    "anchor_missing",
    "anchor_hash_mismatch",
    "count_mismatch",
    "checkpoint_chain_broken",
)


def tenant_scope(tenant_id: UUID) -> str:
    return f"tenant:{tenant_id}"


def parse_scope(scope: str) -> UUID | None:
    """Returns the tenant id for 'tenant:<uuid>', None for 'platform'."""
    if scope == PLATFORM_SCOPE:
        return None
    if scope.startswith("tenant:"):
        try:
            return UUID(scope[len("tenant:") :])
        except ValueError:
            pass
    raise ValidationAppError(f"Invalid audit scope: {scope!r}")


def _hmac_key() -> bytes:
    global _warned_dev_key
    key = get_settings().audit_checkpoint_hmac_key
    if not key:
        if not _warned_dev_key:
            _warned_dev_key = True
            logger.warning(
                "AUDIT_CHECKPOINT_HMAC_KEY is unset: signing audit checkpoints with the "
                "public dev-only key. Production refuses to start in this state."
            )
        key = _DEV_ONLY_KEY
    return key.encode()


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def compute_checkpoint_hash(
    *,
    scope: str,
    record_count: int,
    head_hash: str,
    prev_checkpoint_hash: str,
    created_at: datetime,
    last_record_id: UUID,
    last_created_at: datetime,
) -> str:
    """SHA-256 over scope|count|head_hash|prev_checkpoint_hash|created_at, plus
    the anchored record's id and timestamp so those fields are covered too."""
    material = "|".join(
        [
            scope,
            str(record_count),
            head_hash,
            prev_checkpoint_hash,
            _iso(created_at),
            str(last_record_id),
            _iso(last_created_at),
        ]
    )
    return hashlib.sha256(material.encode()).hexdigest()


def sign(checkpoint_hash: str) -> str:
    return hmac.new(_hmac_key(), checkpoint_hash.encode(), hashlib.sha256).hexdigest()


@dataclass
class _Anchor:
    id: UUID
    created_at: datetime
    record_hash: str


def _chain(scope: str):
    """(model, extra WHERE conditions) for a scope's chain."""
    tenant_id = parse_scope(scope)
    if tenant_id is None:
        return PlatformAuditEvent, []
    return AuditLog, [AuditLog.tenant_id == tenant_id]


def _bind_scope(db: Session, scope: str) -> None:
    """Binds the RLS GUC for tenant scopes (it resets on every commit)."""
    tenant_id = parse_scope(scope)
    if tenant_id is not None:
        set_tenant_context(db, str(tenant_id))


def _head_and_count(db: Session, scope: str) -> tuple[_Anchor | None, int]:
    _bind_scope(db, scope)
    model, conds = _chain(scope)
    head = db.execute(
        select(model.id, model.created_at, model.record_hash)
        .where(*conds)
        .order_by(model.created_at.desc(), model.id.desc())
        .limit(1)
    ).first()
    if head is None:
        return None, 0
    count = db.execute(select(func.count()).select_from(model).where(*conds)).scalar_one()
    return _Anchor(head.id, head.created_at, head.record_hash), count


def _latest_checkpoint(db: Session, scope: str) -> AuditChainCheckpoint | None:
    return db.execute(
        select(AuditChainCheckpoint)
        .where(AuditChainCheckpoint.scope == scope)
        .order_by(AuditChainCheckpoint.created_at.desc(), AuditChainCheckpoint.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def list_checkpoints(db: Session, scope: str) -> list[AuditChainCheckpoint]:
    """Oldest first. Always filtered by scope: the table has no RLS, so this
    filter IS the tenant isolation; callers derive the scope from the session."""
    return list(
        db.execute(
            select(AuditChainCheckpoint)
            .where(AuditChainCheckpoint.scope == scope)
            .order_by(AuditChainCheckpoint.created_at, AuditChainCheckpoint.id)
        ).scalars()
    )


def verify_checkpoints(db: Session, scope: str) -> tuple[int, CheckpointFailure | None]:
    """Checks every checkpoint of a scope against the live chain. Returns
    (checkpoints_checked, first failure or None)."""
    checkpoints = list_checkpoints(db, scope)
    _bind_scope(db, scope)
    model, conds = _chain(scope)

    expected_prev = GENESIS_HASH
    checked = 0
    for cp in checkpoints:
        checked += 1
        reason = _check_one(db, cp, expected_prev, model, conds)
        if reason is not None:
            logger.error(
                "security_event=audit_checkpoint_failed scope=%s checkpoint_id=%s reason=%s",
                scope,
                cp.id,
                reason,
            )
            return checked, CheckpointFailure(checkpoint_id=cp.id, reason=reason)
        expected_prev = cp.checkpoint_hash
    return checked, None


def _check_one(
    db: Session, cp: AuditChainCheckpoint, expected_prev: str, model, conds: list
) -> str | None:
    recomputed = compute_checkpoint_hash(
        scope=cp.scope,
        record_count=cp.record_count,
        head_hash=cp.head_hash,
        prev_checkpoint_hash=cp.prev_checkpoint_hash,
        created_at=cp.created_at,
        last_record_id=cp.last_record_id,
        last_created_at=cp.last_created_at,
    )
    if recomputed != cp.checkpoint_hash or not hmac.compare_digest(
        sign(cp.checkpoint_hash), cp.signature
    ):
        return "signature_invalid"
    if cp.prev_checkpoint_hash != expected_prev:
        return "checkpoint_chain_broken"

    anchor = db.execute(
        select(model.created_at, model.record_hash).where(*conds, model.id == cp.last_record_id)
    ).first()
    if anchor is None:
        return "anchor_missing"
    if anchor.record_hash != cp.head_hash or anchor.created_at != cp.last_created_at:
        return "anchor_hash_mismatch"
    position = db.execute(
        select(func.count())
        .select_from(model)
        .where(
            *conds,
            tuple_(model.created_at, model.id)
            <= tuple_(literal(anchor.created_at), literal(cp.last_record_id)),
        )
    ).scalar_one()
    if position != cp.record_count:
        return "count_mismatch"
    return None


def create_checkpoint(db: Session, scope: str) -> AuditChainCheckpoint | None:
    """Appends a signed checkpoint for the scope's current chain head and commits.

    Returns None when the chain is empty or nothing changed since the last
    checkpoint (idempotent). Raises ConflictError, writing nothing, when the
    chain or an earlier checkpoint fails verification: anchoring a chain that
    is already broken would launder the tampering into a "good" checkpoint.
    """
    # Lazy imports: the verify_chain functions in these modules call
    # verify_checkpoints above, so a top-level import would be circular.
    from app.services import audit_service, platform_audit_service

    tenant_id = parse_scope(scope)
    _bind_scope(db, scope)
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"audit_checkpoint:{scope}"}
    )

    head, count = _head_and_count(db, scope)
    previous = _latest_checkpoint(db, scope)
    if head is None or (
        previous is not None
        and previous.last_record_id == head.id
        and previous.record_count == count
    ):
        db.rollback()
        return None

    result = (
        platform_audit_service.verify_chain(db)
        if tenant_id is None
        else audit_service.verify_chain(db, tenant_id)
    )
    if not result.valid:
        db.rollback()
        raise ConflictError(
            "Audit chain failed verification; refusing to anchor it in a new checkpoint. "
            "Investigate before retrying."
        )

    created_at = datetime.now(UTC)
    if previous is not None and created_at <= previous.created_at:
        created_at = previous.created_at + timedelta(microseconds=1)
    prev_hash = previous.checkpoint_hash if previous else GENESIS_HASH
    checkpoint_hash = compute_checkpoint_hash(
        scope=scope,
        record_count=count,
        head_hash=head.record_hash,
        prev_checkpoint_hash=prev_hash,
        created_at=created_at,
        last_record_id=head.id,
        last_created_at=head.created_at,
    )
    checkpoint = AuditChainCheckpoint(
        scope=scope,
        last_record_id=head.id,
        last_created_at=head.created_at,
        record_count=count,
        head_hash=head.record_hash,
        prev_checkpoint_hash=prev_hash,
        checkpoint_hash=checkpoint_hash,
        signature=sign(checkpoint_hash),
        created_at=created_at,
    )
    db.add(checkpoint)
    db.commit()
    return checkpoint


@dataclass
class ScopeRun:
    scope: str
    status: str  # created | unchanged | would_create | refused | error
    new_events: int = 0
    record_count: int = 0
    detail: str | None = None


def all_scopes(db: Session) -> list[str]:
    tenant_ids = db.execute(select(Tenant.id).order_by(Tenant.created_at)).scalars().all()
    return [PLATFORM_SCOPE, *(tenant_scope(t) for t in tenant_ids)]


def run_checkpoints(
    db: Session, scopes: list[str] | None = None, *, dry_run: bool = False
) -> list[ScopeRun]:
    """Used by the CLI and the worker. One scope failing never stops the rest."""
    targets = scopes if scopes is not None else all_scopes(db)
    runs: list[ScopeRun] = []
    for scope in targets:
        try:
            head, count = _head_and_count(db, scope)
            previous = _latest_checkpoint(db, scope)
            prev_count = previous.record_count if previous else 0
            unchanged = head is None or (
                previous is not None and previous.last_record_id == head.id and prev_count == count
            )
            new_events = 0 if head is None else max(count - prev_count, 0)
            if dry_run:
                db.rollback()
                status = "unchanged" if unchanged else "would_create"
                runs.append(ScopeRun(scope, status, 0 if unchanged else new_events, count))
                continue
            checkpoint = create_checkpoint(db, scope)
            runs.append(
                ScopeRun(
                    scope,
                    "created" if checkpoint else "unchanged",
                    new_events if checkpoint else 0,
                    count,
                )
            )
        except ConflictError as exc:
            db.rollback()
            runs.append(ScopeRun(scope, "refused", detail=exc.message))
        except Exception:
            db.rollback()
            logger.exception("audit checkpoint failed for scope %s", scope)
            runs.append(ScopeRun(scope, "error", detail="unexpected error, see logs"))
    return runs
