from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.platform_auth import require_platform_admin
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.models.identity import PlatformAdmin
from app.schemas.marketing import (
    LeadCreateRequest,
    LeadListResponse,
    LeadOut,
    LeadStatusUpdateRequest,
)
from app.services import marketing_service

public_router = APIRouter(prefix="/public", tags=["public"])
admin_router = APIRouter(prefix="/platform/leads", tags=["platform"])


# Unauthenticated, state-changing: throttled per client IP like /auth/signup,
# and the response is identical whether or not the honeypot tripped.
@public_router.post("/leads", status_code=201)
@limiter.limit("5/hour")
def submit_lead(req: LeadCreateRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    marketing_service.create_lead(db, req)
    return envelope({"received": True})


@admin_router.get("")
def list_leads(
    kind: Literal["demo", "contact", "pricing", "enterprise"] | None = Query(default=None),
    status: Literal["new", "contacted", "closed"] | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=marketing_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    leads, total = marketing_service.list_leads(
        db, kind=kind, status=status, page=page, page_size=page_size
    )
    return envelope(
        LeadListResponse(
            items=[LeadOut.model_validate(lead) for lead in leads], total=total
        ).model_dump(mode="json")
    )


@admin_router.patch("/{lead_id}")
def update_lead_status(
    lead_id: UUID,
    req: LeadStatusUpdateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    lead = marketing_service.update_lead_status(db, lead_id, req.status)
    return envelope(LeadOut.model_validate(lead).model_dump(mode="json"))
