import csv
import hashlib
import io
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import GENESIS_HASH, _canonical
from app.models.audit import AuditLog
from app.models.identity import User
from app.schemas.audit import AuditLogOut, ChainVerificationResult

MAX_PAGE_SIZE = 200


def _build_filtered_query(
    tenant_id: UUID,
    *,
    action: str | None,
    entity_type: str | None,
    entity_id: UUID | None,
    user_id: UUID | None,
    date_from: datetime | None,
    date_to: datetime | None,
):
    query = (
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(AuditLog.tenant_id == tenant_id)
    )
    if action is not None:
        query = query.where(AuditLog.action == action)
    if entity_type is not None:
        query = query.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.where(AuditLog.entity_id == entity_id)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)
    if date_from is not None:
        query = query.where(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.where(AuditLog.created_at <= date_to)
    return query


def _to_out(log: AuditLog, user_name: str | None) -> AuditLogOut:
    return AuditLogOut(
        id=log.id,
        tenant_id=log.tenant_id,
        user_id=log.user_id,
        user_name=user_name,
        platform_admin_id=log.platform_admin_id,
        action=log.action,
        entity_type=log.entity_type,
        entity_id=log.entity_id,
        metadata=log.event_metadata,
        prev_hash=log.prev_hash,
        record_hash=log.record_hash,
        created_at=log.created_at,
    )


def list_audit_logs(
    db: Session,
    tenant_id: UUID,
    *,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    user_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[AuditLogOut]:
    query = _build_filtered_query(
        tenant_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
    )
    query = (
        query.order_by(AuditLog.created_at.desc()).limit(min(limit, MAX_PAGE_SIZE)).offset(offset)
    )
    rows = db.execute(query).all()
    return [_to_out(log, user_name) for log, user_name in rows]


# No LIMIT -- exports are a deliberate full-dataset dump for compliance
# review/archival, not a paginated UI read (ADR-039). Filters still apply so
# an export can be scoped to a user/entity/date-range/action subset.
EXPORT_ROW_CAP = 50_000


def export_audit_logs_csv(
    db: Session,
    tenant_id: UUID,
    *,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    user_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> str:
    query = _build_filtered_query(
        tenant_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
    ).order_by(AuditLog.created_at.asc())
    rows = db.execute(query.limit(EXPORT_ROW_CAP)).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Audit ID",
            "Tenant ID",
            "User ID",
            "User Name",
            "Action",
            "Entity Type",
            "Entity ID",
            "Timestamp",
            "Metadata",
            "Previous Hash",
            "Record Hash",
        ]
    )
    for log, user_name in rows:
        writer.writerow(
            [
                str(log.id),
                str(log.tenant_id),
                str(log.user_id) if log.user_id else "",
                user_name or "",
                log.action,
                log.entity_type,
                str(log.entity_id),
                log.created_at.isoformat(),
                _canonical(log.event_metadata) if log.event_metadata is not None else "",
                log.prev_hash,
                log.record_hash,
            ]
        )
    return buffer.getvalue()


def get_own_history(db: Session, tenant_id: UUID, user_id: UUID) -> list[AuditLogOut]:
    """Self-service account history: every audit event recorded against the
    calling user's own `user` entity -- creation, profile/role edits,
    password resets, and the user's own login/MFA events (auth_service also
    records those with entity_type="user", entity_id=the authenticating
    user). Requires no special permission since it is scoped to the
    caller's own identity, not the tenant-wide audit trail."""
    query = (
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "user",
            AuditLog.entity_id == user_id,
        )
        .order_by(AuditLog.created_at.desc())
        .limit(MAX_PAGE_SIZE)
    )
    rows = db.execute(query).all()
    return [_to_out(log, user_name) for log, user_name in rows]


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
            "platform_admin_id": str(row.platform_admin_id) if row.platform_admin_id else None,
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
