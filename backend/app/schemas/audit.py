from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: UUID
    user_id: UUID | None
    user_name: str | None
    action: str
    entity_type: str
    entity_id: UUID
    record_hash: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChainVerificationResult(BaseModel):
    valid: bool
    checked_count: int
    broken_at_id: UUID | None
