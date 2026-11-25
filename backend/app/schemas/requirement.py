from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RequirementHistoryEntryOut(BaseModel):
    id: UUID
    action: str
    user_id: UUID | None
    user_name: str | None
    event_metadata: dict
    created_at: datetime


class RequirementCreateRequest(BaseModel):
    title: str = Field(min_length=5)
    description: str = ""
    # ADR-127: the task this requirement belongs to (same project).
    task_id: UUID | None = None


class RequirementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=5)
    description: str | None = None
    # Send null to detach from the task; leave out to keep it. Changing it adds no version.
    task_id: UUID | None = None


class RequirementOut(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str
    version_number: int
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
    created_by: UUID
    created_at: datetime


class LinkTestCaseRequest(BaseModel):
    test_case_id: UUID


class LinkedTestCaseOut(BaseModel):
    test_case_id: UUID
    test_case_title: str
    test_case_status: str
    linked_by: UUID
    linked_at: datetime


class RequirementDetailOut(RequirementOut):
    linked_test_cases: list[LinkedTestCaseOut]


class RequirementCoverageEntry(BaseModel):
    requirement_id: UUID
    requirement_title: str
    linked_test_case_count: int
    covered: bool


class RequirementCoverageReport(BaseModel):
    project_id: UUID
    total_requirements: int
    covered_requirements: int
    coverage_percentage: float
    requirements: list[RequirementCoverageEntry]
