from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Priority = Literal["Low", "Medium", "High", "Critical"]
TestCaseStatus = Literal["draft", "ready_for_review", "approved", "deprecated"]


class StepIn(BaseModel):
    action: str = Field(min_length=1)
    expected: str = Field(min_length=1)


class StepOut(BaseModel):
    step_number: int
    action: str
    expected: str


class TestCaseCreateRequest(BaseModel):
    title: str = Field(min_length=5)
    priority: Priority
    assignee_id: UUID | None = None
    steps: list[StepIn] = Field(min_length=1)


class TestCaseUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=5)
    priority: Priority | None = None
    assignee_id: UUID | None = None
    steps: list[StepIn] | None = Field(default=None, min_length=1)


class TestCaseOut(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    priority: Priority
    status: TestCaseStatus
    assignee_id: UUID | None
    version_number: int
    created_by: UUID
    created_at: datetime
    steps: list[StepOut]


class TestCaseVersionOut(BaseModel):
    version_number: int
    title: str
    approved_by: UUID | None
    approved_at: datetime | None
    created_by: UUID
    created_at: datetime
    steps: list[StepOut]
