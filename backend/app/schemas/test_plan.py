from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

PlanStatus = Literal["draft", "active", "complete"]


class TestPlanCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    release_id: UUID | None = None
    test_run_ids: list[UUID] = Field(default_factory=list)
    # ADR-153
    owner_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: PlanStatus = "draft"
    exit_criteria: str | None = Field(default=None, max_length=5000)


class TestPlanUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    release_id: UUID | None = None
    # Send null to clear the owner, a date or the exit criteria.
    owner_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: PlanStatus | None = None
    exit_criteria: str | None = Field(default=None, max_length=5000)


class TestPlanRunSetRequest(BaseModel):
    test_run_ids: list[UUID] = Field(default_factory=list)


class TestPlanOut(BaseModel):
    id: UUID
    project_id: UUID
    release_id: UUID | None
    name: str
    description: str | None
    created_at: datetime
    test_run_ids: list[UUID] = Field(default_factory=list)
    owner_id: UUID | None = None
    owner_name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: PlanStatus = "draft"
    exit_criteria: str | None = None


class TestPlanRollup(BaseModel):
    """Adapted from Tier 3's release-readiness metrics, scoped to exactly
    this plan's child runs rather than a whole project -- a plan may not
    cover every run in the project, so a project-wide computation would be
    misleading here."""

    test_plan_id: UUID
    total_test_cases: int
    execution_completion_percentage: float
    pass_percentage: float
    open_defects_by_severity: dict[str, int]
