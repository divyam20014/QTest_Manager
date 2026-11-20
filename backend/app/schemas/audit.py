from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: UUID | None
    user_name: str | None
    platform_admin_id: UUID | None
    service_token_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID
    metadata: dict | None
    prev_hash: str
    record_hash: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CheckpointFailure(BaseModel):
    checkpoint_id: UUID
    # signature_invalid | anchor_missing | anchor_hash_mismatch | count_mismatch
    # | checkpoint_chain_broken (ADR-085)
    reason: str


class ChainVerificationResult(BaseModel):
    valid: bool
    checked_count: int
    broken_at_id: UUID | None
    # ADR-085: additive, so existing clients keep working unchanged.
    checkpoints_checked: int = 0
    checkpoint_failure: CheckpointFailure | None = None
    # ADR-087: records covered by a verified checkpoint and not re-hashed when
    # verification ran with since_checkpoint=true; 0 for a full walk.
    skipped_count: int = 0


class AuditCheckpointOut(BaseModel):
    id: UUID
    scope: str
    last_record_id: UUID
    last_created_at: datetime
    record_count: int
    head_hash: str
    prev_checkpoint_hash: str
    checkpoint_hash: str
    signature: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateCheckpointResult(BaseModel):
    created: bool
    # "no_new_events" when nothing changed since the last checkpoint.
    reason: str | None = None
    checkpoint: AuditCheckpointOut | None = None
