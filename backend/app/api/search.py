from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context
from app.core.db import get_db
from app.core.responses import envelope
from app.services import search_service

router = APIRouter(tags=["search"])


@router.get("/search")
def search(
    q: str = Query(min_length=1, max_length=200),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    result = search_service.search(db, ctx.tenant_id, ctx.role_code, ctx.user_id, q)
    return envelope(result.model_dump(mode="json"))
