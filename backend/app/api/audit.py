from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.services import audit_service

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("")
def list_audit_logs(
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> dict:
    logs = audit_service.list_audit_logs(
        db,
        ctx.tenant_id,
        action=action,
        entity_type=entity_type,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    return envelope([log.model_dump(mode="json") for log in logs])


@router.get("/verify-chain")
def verify_chain(
    ctx: SessionContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
) -> dict:
    result = audit_service.verify_chain(db, ctx.tenant_id)
    return envelope(result.model_dump(mode="json"))
