from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Tier 5 (PV-9.5): priority is tenant-configurable (app/services/field_option_service.py)
# -- the DB CheckConstraint and this fixed Literal were both removed in favor of
# per-tenant option codes, validated at the service layer against each tenant's
# current `field_options` rows (seeded with these same four values by default).
Priority = Annotated[str, Field(min_length=1, max_length=64)]
TestCaseStatus = Literal["draft", "ready_for_review", "approved", "deprecated"]
StepChangeType = Literal["unchanged", "added", "removed", "modified"]


class TestCaseHistoryEntryOut(BaseModel):
    id: UUID
    action: str
    user_id: UUID | None
    user_name: str | None
    event_metadata: dict
    created_at: datetime


class StepIn(BaseModel):
    action: str = Field(min_length=1)
    expected: str = Field(min_length=1)


class StepOut(BaseModel):
    step_number: int
    action: str
    expected: str


class TestCaseCreateRequest(BaseModel):
    title: str = Field(min_length=5)
    description: str = ""
    priority: Priority
    assignee_id: UUID | None = None
    steps: list[StepIn] = Field(min_length=1)


class TestCaseUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=5)
    description: str | None = None
    priority: Priority | None = None
    assignee_id: UUID | None = None
    steps: list[StepIn] | None = Field(default=None, min_length=1)


class TestCaseOut(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str
    priority: Priority
    status: TestCaseStatus
    status_label: str
    assignee_id: UUID | None
    module_id: UUID | None
    reviewer_id: UUID | None
    reviewer_name: str | None
    version_number: int
    created_by: UUID
    created_at: datetime
    steps: list[StepOut]
    custom_fields: dict[str, object] = {}


class SubmitForReviewRequest(BaseModel):
    reviewer_id: UUID | None = None


class RequestChangesRequest(BaseModel):
    comment: str = Field(min_length=1)


class TestCaseListResponse(BaseModel):
    items: list[TestCaseOut]
    total: int


class TestCaseVersionOut(BaseModel):
    version_number: int
    title: str
    description: str
    approved_by: UUID | None
    approved_at: datetime | None
    created_by: UUID
    created_at: datetime
    steps: list[StepOut]


class StepDiff(BaseModel):
    step_number: int
    change: StepChangeType
    old_action: str | None = None
    old_expected: str | None = None
    new_action: str | None = None
    new_expected: str | None = None


class VersionCompareOut(BaseModel):
    from_version: int
    to_version: int
    title_changed: bool
    old_title: str
    new_title: str
    description_changed: bool
    old_description: str
    new_description: str
    steps: list[StepDiff]
