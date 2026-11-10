from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID | None
    user_name: str | None
    platform_admin_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID
    metadata: dict | None
    prev_hash: str
    record_hash: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChainVerificationResult(BaseModel):
    valid: bool
    checked_count: int
    broken_at_id: UUID | None
