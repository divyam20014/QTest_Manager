from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.core.logging import logger
from app.models.marketing import MarketingLead
from app.schemas.marketing import LeadCreateRequest

DEFAULT_PAGE_SIZE = 25


def create_lead(db: Session, req: LeadCreateRequest) -> MarketingLead | None:
    """Returns None (and stores nothing) when the honeypot is filled; the
    caller still answers with a generic success so bots learn nothing."""
    if req.website:
        logger.info("security_event=lead_honeypot_tripped kind=%s", req.kind)
        return None
    lead = MarketingLead(
        kind=req.kind,
        full_name=req.full_name,
        business_email=str(req.business_email).lower(),
        company=req.company,
        job_role=req.job_role or None,
        team_size=req.team_size or None,
        primary_requirement=req.primary_requirement or None,
        message=req.message or None,
        source_page=req.source_page or None,
    )
    db.add(lead)
    db.commit()
    return lead


def list_leads(
    db: Session,
    *,
    kind: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[MarketingLead], int]:
    query = select(MarketingLead)
    if kind:
        query = query.where(MarketingLead.kind == kind)
    if status:
        query = query.where(MarketingLead.status == status)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = (
        db.execute(
            query.order_by(MarketingLead.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return list(rows), total


def update_lead_status(db: Session, lead_id: UUID, status: str) -> MarketingLead:
    lead = db.get(MarketingLead, lead_id)
    if lead is None:
        raise NotFoundError("Lead not found")
    lead.status = status
    db.commit()
    db.refresh(lead)
    return lead
