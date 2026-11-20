from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

RuleType = Literal["freeze_window", "environment_restriction"]


class AccessRuleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    enabled: bool = True
    rule_type: RuleType
    project_id: UUID | None = None
    environment: str | None = Field(default=None, max_length=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    blocked_actions: list[str] = Field(min_length=1, max_length=50)
    exempt_roles: list[str] = Field(default_factory=lambda: ["admin"], max_length=3)
    reason: str = Field(min_length=1, max_length=500)


class AccessRuleUpdateRequest(BaseModel):
    """PATCH: only the fields sent are changed (send null to clear project_id,
    environment or a window bound)."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None
    project_id: UUID | None = None
    environment: str | None = Field(default=None, max_length=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    blocked_actions: list[str] | None = Field(default=None, min_length=1, max_length=50)
    exempt_roles: list[str] | None = Field(default=None, max_length=3)
    reason: str | None = Field(default=None, min_length=1, max_length=500)


class AccessRuleOut(BaseModel):
    id: UUID
    name: str
    enabled: bool
    rule_type: str
    project_id: UUID | None
    environment: str | None
    starts_at: datetime | None
    ends_at: datetime | None
    blocked_actions: list[str]
    exempt_roles: list[str]
    reason: str
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActiveAccessRuleOut(BaseModel):
    """What any signed-in user may see: only rules that restrict their role
    right now. Never the exempt-role list or other rule internals."""

    id: UUID
    rule_type: str
    project_id: UUID | None
    environment: str | None
    reason: str
    ends_at: datetime | None
    blocked_actions: list[str]


class AccessRulePreviewRequest(BaseModel):
    action_code: str = Field(min_length=1, max_length=100)
    role_code: Literal["admin", "manager", "tester"]
    project_id: UUID | None = None
    environment: str | None = Field(default=None, max_length=100)
    at: datetime | None = None


class AccessRulePreviewOut(BaseModel):
    blocked: bool
    rule_id: UUID | None
    reason: str | None
