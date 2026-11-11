from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ServiceTokenCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scope: str = "ci_results"


class ServiceTokenOut(BaseModel):
    id: UUID
    name: str
    scope: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None

    model_config = {"from_attributes": True}


class ServiceTokenCreateResponse(BaseModel):
    token: ServiceTokenOut
    # Shown exactly once, at creation -- the same reveal-once convention
    # used everywhere else a secret is generated in this codebase (MFA
    # debug codes, SCIM/invite tokens).
    raw_value: str
