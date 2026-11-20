from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class PlatformAuditEventOut(BaseModel):
    id: UUID
    created_at: datetime
    event_type: str
    actor_admin_id: UUID | None
    actor_email: str | None
    target_admin_id: UUID | None
    ip: str | None
    outcome: str
    details: dict | None

    model_config = {"from_attributes": True}


class PlatformAuditEventListResponse(BaseModel):
    items: list[PlatformAuditEventOut]
    total: int
