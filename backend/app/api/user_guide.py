from fastapi import APIRouter, Depends, Request, Response

from app.core.auth import SessionContext, get_current_context
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.services import user_guide_service

router = APIRouter(prefix="/user-guide", tags=["user-guide"])

# ADR-089: never let a shared cache or the disk cache keep guide text after sign-out.
NO_STORE = "private, no-store"


@router.get("")
@limiter.limit(scaled(60))
def get_user_guide(
    request: Request,
    response: Response,
    ctx: SessionContext = Depends(get_current_context),
) -> dict:
    """The user guide as ordered sections, only those this caller's permissions
    allow. Sections the caller may not read are not listed at all."""
    response.headers["Cache-Control"] = NO_STORE
    return envelope({"sections": user_guide_service.sections_for(ctx.permissions)})
