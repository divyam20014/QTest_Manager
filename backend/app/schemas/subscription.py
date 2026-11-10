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


class SubscriptionAssignRequest(BaseModel):
    """Platform-admin-only. Schema/admin-assignment only -- no payment
    collection, no invoicing (ADR-053)."""

    plan_code: str = Field(min_length=1)
    status: SubscriptionStatus = "active"
    seat_count: int = Field(default=1, ge=1)
    current_period_end: datetime | None = None
