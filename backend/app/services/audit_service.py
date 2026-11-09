import hashlib
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import GENESIS_HASH, _canonical
from app.models.audit import AuditLog
from app.models.identity import User
from app.schemas.audit import AuditLogOut, ChainVerificationResult

MAX_PAGE_SIZE = 200


def list_audit_logs(
    db: Session,
    tenant_id: UUID,
    *,
    action: str | None = None,
    entity_type: str | None = None,
    user_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[AuditLogOut]:
    query = (
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(AuditLog.tenant_id == tenant_id)
    )
    if action is not None:
        query = query.where(AuditLog.action == action)
    if entity_type is not None:
        query = query.where(AuditLog.entity_type == entity_type)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)

    query = (
        query.order_by(AuditLog.created_at.desc()).limit(min(limit, MAX_PAGE_SIZE)).offset(offset)
    )
    rows = db.execute(query).all()
    return [
        AuditLogOut(
            id=log.id,
            user_id=log.user_id,
            user_name=user_name,
            action=log.action,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            record_hash=log.record_hash,
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def verify_chain(db: Session, tenant_id: UUID) -> ChainVerificationResult:
    """Re-walks the tenant's full hash chain and recomputes each record's
    hash from its stored fields (ADR-006), rather than trusting the stored
    record_hash on sight. Surfaces tamper or corruption as a UI-visible
    result instead of only a test assertion."""
    rows = (
        db.execute(
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant_id)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
        .scalars()
        .all()
    )

    expected_prev_hash = GENESIS_HASH
    for row in rows:
        payload = {
            "tenant_id": str(row.tenant_id),
            "user_id": str(row.user_id) if row.user_id else None,
            "action": row.action,
            "entity_type": row.entity_type,
            "entity_id": str(row.entity_id),
            "metadata": row.event_metadata,
            "created_at": row.created_at.isoformat(),
            "prev_hash": row.prev_hash,
        }
        recomputed = hashlib.sha256(_canonical(payload).encode()).hexdigest()

        if row.prev_hash != expected_prev_hash or recomputed != row.record_hash:
            return ChainVerificationResult(
                valid=False, checked_count=len(rows), broken_at_id=row.id
            )

        expected_prev_hash = row.record_hash

    return ChainVerificationResult(valid=True, checked_count=len(rows), broken_at_id=None)
