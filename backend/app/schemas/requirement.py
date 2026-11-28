from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints


class RequirementHistoryEntryOut(BaseModel):
    id: UUID
    action: str
    user_id: UUID | None
    user_name: str | None
    event_metadata: dict
    created_at: datetime


# ADR-148: fixed, unlike types and priorities.
RequirementStatus = Literal["draft", "approved", "retired"]


# ADR-149
MAX_CRITERIA = 50
Criterion = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class RequirementCreateRequest(BaseModel):
    title: str = Field(min_length=5)
    description: str = ""
    # ADR-127: the task this requirement belongs to (same project).
    task_id: UUID | None = None
    requirement_type: str | None = Field(default=None, max_length=64)
    priority: str | None = Field(default=None, max_length=64)
    status: RequirementStatus = "draft"
    owner_id: UUID | None = None
    acceptance_criteria: list[Criterion] = Field(default_factory=list, max_length=MAX_CRITERIA)


class RequirementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=5)
    description: str | None = None
    # Send null to detach from the task; leave out to keep it. Changing it adds no version.
    task_id: UUID | None = None
    requirement_type: str | None = Field(default=None, max_length=64)
    priority: str | None = Field(default=None, max_length=64)
    status: RequirementStatus | None = None
    # The whole list, in order; leave out to keep it, send [] to remove them all.
    acceptance_criteria: list[Criterion] | None = Field(default=None, max_length=MAX_CRITERIA)
    # Send null to leave the requirement without an owner.
    owner_id: UUID | None = None
    # ADR-136: the `row_version` the change was made from; refused if it has moved on.
    expected_version: int | None = None


class RequirementOut(BaseModel):
    id: UUID
    project_id: UUID
    display_id: str | None
    title: str
    description: str
    version_number: int
    requirement_type: str
    priority: str
    status: RequirementStatus
    owner_id: UUID | None
    owner_name: str | None
    acceptance_criteria: list[str]
    # ADR-150: linked test cases to look at again since the wording changed.
    review_count: int = 0
    row_version: int
    created_by: UUID
    created_at: datetime
    linked_test_case_count: int
    task_id: UUID | None = None
    task_display_id: str | None = None
    task_title: str | None = None
    custom_fields: dict[str, object] = {}


class RequirementListResponse(BaseModel):
    items: list[RequirementOut]
    total: int


class RequirementVersionOut(BaseModel):
    version_number: int
    title: str
    description: str
    acceptance_criteria: list[str]
    created_by: UUID
    created_at: datetime


class LinkTestCaseRequest(BaseModel):
    test_case_id: UUID


class ConfirmLinkRequest(BaseModel):
    # The version the reviewer looked at; refused if the requirement has changed since.
    version_number: int = Field(ge=1)


class LinkedTestCaseOut(BaseModel):
    test_case_id: UUID
    test_case_title: str
    test_case_status: str
    # ADR-150: the version the case was agreed to cover; null = made before this was recorded.
    covers_version_number: int | None
    needs_review: bool
    linked_by: UUID
    linked_at: datetime


class RequirementDetailOut(RequirementOut):
    linked_test_cases: list[LinkedTestCaseOut]


class RequirementCoverageEntry(BaseModel):
    requirement_id: UUID
    display_id: str | None
    requirement_title: str
    status: RequirementStatus
    review_count: int
    linked_test_case_count: int
    covered: bool


class RequirementCoverageReport(BaseModel):
    project_id: UUID
    total_requirements: int
    covered_requirements: int
    coverage_percentage: float
    # ADR-150: retired requirements are left out of the numbers above and the list below.
    retired_requirements: int = 0
    requirements_needing_review: int = 0
    requirements: list[RequirementCoverageEntry]
