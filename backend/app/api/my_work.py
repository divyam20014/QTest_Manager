from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context
from app.core.db import get_db
from app.core.responses import envelope
from app.services import my_work_service

router = APIRouter(tags=["my-work"])

# Read-only, scoped to the caller. Any signed-in user may call them: they only ever
# return the caller's own assignments, filtered by the same project visibility the
# run and test case lists apply. No new permission code.


@router.get("/my-work/summary")
def my_work_summary(
    ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> dict:
    out = my_work_service.summary(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    return envelope(out.model_dump(mode="json"))


@router.get("/my-work/run-cases")
def my_work_run_cases(
    ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> dict:
    out = my_work_service.list_run_cases(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    return envelope(out.model_dump(mode="json"))


@router.get("/my-work/reviews")
def my_work_reviews(
    ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> dict:
    out = my_work_service.list_reviews(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    return envelope(out.model_dump(mode="json"))
