from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

LeadKind = Literal["demo", "contact", "pricing", "enterprise"]
LeadStatus = Literal["new", "contacted", "closed"]


class LeadCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    kind: LeadKind
    full_name: str = Field(min_length=2, max_length=120)
    business_email: EmailStr = Field(max_length=254)
    company: str = Field(min_length=2, max_length=160)
    job_role: str | None = Field(default=None, max_length=120)
    team_size: str | None = Field(default=None, max_length=40)
    primary_requirement: str | None = Field(default=None, max_length=160)
    message: str | None = Field(default=None, max_length=2000)
    source_page: str | None = Field(default=None, max_length=200)
    # Honeypot: real visitors never see or fill this field.
    website: str | None = Field(default=None, max_length=200)


class LeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: LeadKind
    full_name: str
    business_email: str
    company: str
    job_role: str | None
    team_size: str | None
    primary_requirement: str | None
    message: str | None
    source_page: str | None
    status: LeadStatus
    created_at: datetime
    updated_at: datetime


class LeadListResponse(BaseModel):
    items: list[LeadOut]
    total: int


class LeadStatusUpdateRequest(BaseModel):
    status: LeadStatus
