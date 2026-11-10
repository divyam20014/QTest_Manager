from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    clear_session_cookie,
    get_current_context,
    parse_session_cookie,
    set_session_cookie,
)
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.models.identity import User
from app.schemas.auth import LoginRequest, MeResponse, MfaVerifyRequest
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
@limiter.limit("10/minute")
def login(
    req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    session_row, debug_code = auth_service.start_login(
        db, req.tenant_id, req.email, req.password, request
    )
    set_session_cookie(response, session_row.id)
    payload: dict = {"mfa_required": True}
    if debug_code is not None:
        payload["debug_code"] = debug_code
    return envelope(payload)


@router.post("/mfa/verify")
@limiter.limit("10/minute")
def verify_mfa(
    req: MfaVerifyRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    session_id = parse_session_cookie(request)
    session_row = auth_service.verify_mfa(db, session_id, req.code)
    set_session_cookie(response, session_row.id)
    return envelope({"verified": True})


@router.post("/logout")
def logout(
    response: Response,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    auth_service.logout(db, ctx.session_id)
    clear_session_cookie(response)
    return envelope({"logged_out": True})


@router.get("/me")
def me(ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)) -> dict:
    user = db.execute(select(User).where(User.id == ctx.user_id)).scalar_one()
    return envelope(
        MeResponse(
            user_id=ctx.user_id,
            tenant_id=ctx.tenant_id,
            email=user.email,
            name=user.name,
            role=ctx.role_code,
        ).model_dump()
    )
