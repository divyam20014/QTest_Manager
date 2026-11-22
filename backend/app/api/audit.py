from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.audit import AuditCheckpointOut, CreateCheckpointResult
from app.services import audit_checkpoint_service, audit_service

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("")
def list_audit_logs(
    response: Response,
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: UUID | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    cursor: str | None = Query(default=None, max_length=300),
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> dict:
    """Newest first, as a bare list. Optional `cursor` (empty = first page) switches
    to keyset paging and returns the next page's cursor in the `X-Next-Cursor`
    response header (absent on the last page); `offset` is ignored then (ADR-113)."""
    logs, next_cursor = audit_service.list_audit_logs_page(
        db,
        ctx.tenant_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
        cursor=cursor,
    )
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return envelope([log.model_dump(mode="json") for log in logs])


@router.get("/export")
def export_audit_logs(
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: UUID | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> PlainTextResponse:
    csv_text = audit_service.export_audit_logs_csv(
        db,
        ctx.tenant_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
    )
    return PlainTextResponse(
        csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit_logs.csv"'},
    )


@router.get("/verify-chain")
def verify_chain(
    since_checkpoint: bool = False,
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> dict:
    result = audit_service.verify_chain(db, ctx.tenant_id, since_checkpoint=since_checkpoint)
    return envelope(result.model_dump(mode="json"))


# ADR-085: signed checkpoints. The scope is always derived from the session's
# tenant (never from input), so a tenant only ever sees its own.
@router.get("/checkpoints")
def list_checkpoints(
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> dict:
    rows = audit_checkpoint_service.list_checkpoints(
        db, audit_checkpoint_service.tenant_scope(ctx.tenant_id)
    )
    return envelope([AuditCheckpointOut.model_validate(r).model_dump(mode="json") for r in rows])


@router.post("/checkpoints")
def create_checkpoint(
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> dict:
    checkpoint = audit_checkpoint_service.create_checkpoint(
        db, audit_checkpoint_service.tenant_scope(ctx.tenant_id)
    )
    result = CreateCheckpointResult(
        created=checkpoint is not None,
        reason=None if checkpoint else "no_new_events",
        checkpoint=AuditCheckpointOut.model_validate(checkpoint) if checkpoint else None,
    )
    return envelope(result.model_dump(mode="json"))


@router.get("/checkpoints/export")
def export_checkpoints(
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """A JSON document operators store off-box (object-lock/WORM bucket, ticket,
    SIEM). It carries only hashes, counts and ids, never audit content."""
    scope = audit_checkpoint_service.tenant_scope(ctx.tenant_id)
    rows = audit_checkpoint_service.list_checkpoints(db, scope)
    body = {
        "scope": scope,
        "exported_at": datetime.now(UTC).isoformat(),
        "checkpoints": [AuditCheckpointOut.model_validate(r).model_dump(mode="json") for r in rows],
    }
    return JSONResponse(
        body,
        headers={"Content-Disposition": 'attachment; filename="audit_checkpoints.json"'},
    )
