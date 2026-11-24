from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context
from app.core.db import get_db
from app.core.responses import envelope
from app.services import calendar_service

router = APIRouter(tags=["calendar"])


@router.get("/calendar")
def calendar(
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    project_id: UUID | None = Query(default=None),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-124: runs started / finished, run cases due and releases dated inside a range of at
    most 62 days. Read-only; scoped to the projects (and, for a scoped Tester, the cases) the
    caller can already see. Any signed-in user may call it: no new permission code."""
    out = calendar_service.get_calendar(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        from_date=from_date,
        to_date=to_date,
        project_id=project_id,
    )
    return envelope(out.model_dump(mode="json"))
