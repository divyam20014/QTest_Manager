from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import StrongPassword

# BRD gap Phase 4 / ADR-073 (FR-AUTH-04): the five insurance project domains
# plus "Other" (another or several domains). Optional everywhere.
TenantPrimaryDomain = Literal["Motor", "Health", "Travel", "Life", "Property", "Other"]


class TenantCreateRequest(BaseModel):
    tenant_name: str = Field(min_length=3)
    admin_name: str = Field(min_length=1)
    admin_email: EmailStr
    admin_password: StrongPassword
    # Tier 4 / ADR-054 (PV-11.6): data residency readiness metadata only --
    # no per-region deployment topology exists yet, see docs/DATA_RESIDENCY.md.
    data_region: str = "us"
    primary_domain: TenantPrimaryDomain | None = None


class TenantOut(BaseModel):
    id: UUID
    name: str
    status: str
    default_currency_code: str
    default_timezone: str
    data_region: str
    primary_domain: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TenantListResponse(BaseModel):
    items: list[TenantOut]
    total: int


class TenantDataRegionUpdateRequest(BaseModel):
    data_region: str = Field(min_length=1)


class TenantCreateResponse(BaseModel):
    tenant: TenantOut
    admin_user_id: UUID


class TenantStatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(pending|approved|suspended|inactive)$")


class PlatformAdminOut(BaseModel):
    id: UUID
    email: str
    is_active: bool
    created_at: datetime
    # ADR-074: derived from mfa_enabled_at -- never exposes any secret.
    mfa_enabled: bool = False
    # ADR-080: only whether a code is usable and when it lapses -- never the
    # code or its hash.
    enrolment_code_active: bool = False
    enrolment_code_expires_at: datetime | None = None
    # ADR-081: whether an admin-issued password-reset code is usable and when it
    # lapses -- never the code or its hash.
    password_reset_code_active: bool = False
    password_reset_code_expires_at: datetime | None = None

    model_config = {"from_attributes": True}


class PlatformAdminWithCodeOut(PlatformAdminOut):
    """Returned by create / reset-MFA / re-issue: carries the PLAINTEXT
    one-time enrolment code, visible only in this response."""

    enrolment_code: str | None = None
    # ADR-081: set only by POST /platform/admins/{id}/password-reset-code.
    password_reset_code: str | None = None


class PlatformAdminListResponse(BaseModel):
    items: list[PlatformAdminOut]
    total: int


class PlatformAdminCreateRequest(BaseModel):
    email: EmailStr
    password: StrongPassword


class PlatformAdminUpdateRequest(BaseModel):
    is_active: bool
