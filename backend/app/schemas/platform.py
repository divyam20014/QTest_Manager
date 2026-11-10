from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import StrongPassword


class TenantCreateRequest(BaseModel):
    tenant_name: str = Field(min_length=3)
    admin_name: str = Field(min_length=1)
    admin_email: EmailStr
    admin_password: StrongPassword
    # Tier 4 / ADR-054 (PV-11.6): data residency readiness metadata only --
    # no per-region deployment topology exists yet, see docs/DATA_RESIDENCY.md.
    data_region: str = "us"


class TenantOut(BaseModel):
    id: UUID
    name: str
    status: str
    default_currency_code: str
    default_timezone: str
    data_region: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TenantDataRegionUpdateRequest(BaseModel):
    data_region: str = Field(min_length=1)


class TenantCreateResponse(BaseModel):
    tenant: TenantOut
    admin_user_id: UUID


class TenantStatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(pending|approved|suspended)$")
