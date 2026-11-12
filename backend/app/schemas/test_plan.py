from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TestPlanCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    release_id: UUID | None = None
    test_run_ids: list[UUID] = Field(default_factory=list)


class TestPlanUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    release_id: UUID | None = None


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
