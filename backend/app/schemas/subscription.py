from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

SubscriptionStatus = Literal["trialing", "active", "past_due", "canceled"]


class PlanOut(BaseModel):
    id: UUID
    code: str
    name: str
    seat_limit: int | None
    storage_limit_mb: int | None
    ai_monthly_request_limit: int | None
    is_active: bool

    model_config = {"from_attributes": True}


class SubscriptionOut(BaseModel):
    id: UUID
    plan: PlanOut
    status: SubscriptionStatus
    seat_count: int
    current_period_start: datetime
    current_period_end: datetime | None
    created_at: datetime
    updated_at: datetime


class PlanCreateRequest(BaseModel):
    """Platform-admin-only (gap-closure pass, ADR-057)."""

    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    seat_limit: int | None = Field(default=None, ge=1)
    storage_limit_mb: int | None = Field(default=None, ge=1)
    ai_monthly_request_limit: int | None = Field(default=None, ge=1)
    is_active: bool = True


class PlanUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    seat_limit: int | None = Field(default=None, ge=1)
    storage_limit_mb: int | None = Field(default=None, ge=1)
    ai_monthly_request_limit: int | None = Field(default=None, ge=1)
    is_active: bool | None = None


class SubscriptionAssignRequest(BaseModel):
    """Platform-admin-only. Schema/admin-assignment only -- no payment
    collection, no invoicing (ADR-053)."""

    plan_code: str = Field(min_length=1)
    status: SubscriptionStatus = "active"
    seat_count: int = Field(default=1, ge=1)
    current_period_end: datetime | None = None


class SwitchPlanRequest(BaseModel):
    """Tenant-admin self-serve plan switch (Pass 2 / ADR-064). No payment
    is collected -- see subscription_service.switch_plan."""

    plan_code: str = Field(min_length=1)


class SubscriptionUsageOut(BaseModel):
    """Mirrors exactly what `plan_limits` enforces, so this can never show
    a different number than what's actually checked (Pass 2 / ADR-064)."""

    seat_count: int
    seat_limit: int | None
    storage_used_mb: float
    storage_limit_mb: int | None
    ai_requests_this_period: int
    ai_monthly_request_limit: int | None
