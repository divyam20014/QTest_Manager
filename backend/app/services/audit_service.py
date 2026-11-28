import csv
import hashlib
import io
from datetime import datetime
from uuid import UUID

from sqlalchemy import literal, select, tuple_
from sqlalchemy.orm import Session

from app.core import pagination
from app.core.audit import GENESIS_HASH, _canonical
from app.models.audit import AuditLog
from app.models.identity import User
from app.schemas.audit import AuditLogOut, ChainVerificationResult, CheckpointFailure
from app.services import audit_checkpoint_service

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
        service_token_id=log.service_token_id,
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
    return list_audit_logs_page(
        db,
        tenant_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )[0]


def list_audit_logs_page(
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
    cursor: str | None = None,
) -> tuple[list[AuditLogOut], str | None]:
    """Newest first. With `cursor` (ADR-113; empty string = first page) the page is
    keyset-paged over (created_at, id) -- `offset` is ignored -- and the second
    return value is the next page's cursor (None on the last page / offset mode).
    Within a tenant chain every event has a distinct, increasing created_at, so
    adding `id` as the tie-break does not change the order existing clients see."""
    query = _build_filtered_query(
        tenant_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
    )
    limit = min(limit, MAX_PAGE_SIZE)
    query = query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    if cursor is None:
        rows = db.execute(query.limit(limit).offset(offset)).all()
        return [_to_out(log, user_name) for log, user_name in rows], None
    position = pagination.decode_cursor(cursor)
    if position is not None:
        query = query.where(
            pagination.keyset_after(
                AuditLog.created_at, AuditLog.id, position, created_desc=True, id_desc=True
            )
        )
    rows = db.execute(query.limit(limit + 1)).all()
    page = [_to_out(log, user_name) for log, user_name in rows[:limit]]
    next_cursor = (
        pagination.encode_cursor(page[-1].created_at, page[-1].id) if len(rows) > limit else None
    )
    return page, next_cursor


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
    ).order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
    # Chunked server-side fetch: rows are written straight into the CSV buffer
    # instead of materialising up to EXPORT_ROW_CAP ORM rows first (ADR-113).
    rows = db.execute(query.limit(EXPORT_ROW_CAP).execution_options(yield_per=VERIFY_BATCH_SIZE))

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


# Rows per server-side-cursor fetch. Memory during verification is bounded by
# this, not by the size of the log (GAP-12, ADR-087).
VERIFY_BATCH_SIZE = 2000


def _row_hash_matches(row) -> bool:
    payload = {
        "tenant_id": str(row.tenant_id),
        "user_id": str(row.user_id) if row.user_id else None,
        "platform_admin_id": str(row.platform_admin_id) if row.platform_admin_id else None,
        "service_token_id": str(row.service_token_id) if row.service_token_id else None,
        "action": row.action,
        "entity_type": row.entity_type,
        "entity_id": str(row.entity_id),
        "metadata": row.event_metadata,
        "created_at": row.created_at.isoformat(),
        "prev_hash": row.prev_hash,
    }
    if hashlib.sha256(_canonical(payload).encode()).hexdigest() == row.record_hash:
        return True
    if row.service_token_id is None:
        # Rows written before `service_token_id` joined the hashed payload were
        # hashed without that key. A row with no service token is exactly the
        # shape those rows have, so accept that older form for them only; any
        # other change to a row still fails both forms. The link check in the
        # caller is unchanged, so reordering or deleting rows is detected as before.
        legacy_payload = {k: v for k, v in payload.items() if k != "service_token_id"}
        legacy_hash = hashlib.sha256(_canonical(legacy_payload).encode()).hexdigest()
        return legacy_hash == row.record_hash
    return False


def verify_chain(
    db: Session, tenant_id: UUID, *, since_checkpoint: bool = False
) -> ChainVerificationResult:
    """Re-walks the tenant's hash chain and recomputes each record's hash from
    its stored fields (ADR-006), rather than trusting the stored record_hash on
    sight. Surfaces tamper or corruption as a UI-visible result instead of only
    a test assertion.

    Rows are streamed through a server-side cursor in batches, so memory stays
    flat however long the log is (ADR-087). By default the whole chain is walked.
    With `since_checkpoint=True`, and only when every signed checkpoint verifies,
    the walk starts after the newest checkpoint's anchor row, which is trusted
    through its signature; rows before it are NOT re-hashed in that mode (it is a
    fast check of recent activity, not a replacement for the full walk)."""
    scope = audit_checkpoint_service.tenant_scope(tenant_id)
    conds = [AuditLog.tenant_id == tenant_id]
    expected_prev_hash = GENESIS_HASH
    skipped = 0
    precomputed = None
    if since_checkpoint:
        precomputed = audit_checkpoint_service.verify_checkpoints(db, scope)
        checkpoints = audit_checkpoint_service.list_checkpoints(db, scope)
        if precomputed[1] is None and checkpoints:
            latest = checkpoints[-1]
            conds.append(
                tuple_(AuditLog.created_at, AuditLog.id)
                > tuple_(literal(latest.last_created_at), literal(latest.last_record_id))
            )
            expected_prev_hash = latest.head_hash
            skipped = latest.record_count

    stream = db.execute(
        select(
            AuditLog.id,
            AuditLog.tenant_id,
            AuditLog.user_id,
            AuditLog.platform_admin_id,
            AuditLog.service_token_id,
            AuditLog.action,
            AuditLog.entity_type,
            AuditLog.entity_id,
            AuditLog.event_metadata,
            AuditLog.prev_hash,
            AuditLog.record_hash,
            AuditLog.created_at,
        )
        .where(*conds)
        .order_by(AuditLog.created_at, AuditLog.id)
        .execution_options(yield_per=VERIFY_BATCH_SIZE)
    )
    walked = 0
    broken_at: UUID | None = None
    try:
        for row in stream:
            walked += 1
            if row.prev_hash != expected_prev_hash or not _row_hash_matches(row):
                broken_at = row.id
                break
            expected_prev_hash = row.record_hash
    finally:
        stream.close()
    return _with_checkpoints(db, tenant_id, walked, broken_at, precomputed, skipped)


def _with_checkpoints(
    db: Session,
    tenant_id: UUID,
    checked_count: int,
    broken_at_id: UUID | None,
    precomputed: tuple[int, CheckpointFailure | None] | None = None,
    skipped_count: int = 0,
) -> ChainVerificationResult:
    """ADR-085: after the chain walk, also check the signed checkpoints against
    the live chain. They are always checked, even when the walk already failed,
    so the operator sees both facts. `valid` is the conjunction."""
    checked, failure = precomputed or audit_checkpoint_service.verify_checkpoints(
        db, audit_checkpoint_service.tenant_scope(tenant_id)
    )
    return ChainVerificationResult(
        valid=broken_at_id is None and failure is None,
        checked_count=checked_count,
        broken_at_id=broken_at_id,
        checkpoints_checked=checked,
        checkpoint_failure=failure,
        skipped_count=skipped_count,
    )
