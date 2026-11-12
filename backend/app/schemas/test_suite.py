from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.execution import RunType


class TestSuiteCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    test_case_ids: list[UUID] = Field(default_factory=list)


class TestSuiteUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None


class TestSuiteCaseSetRequest(BaseModel):
    test_case_ids: list[UUID] = Field(default_factory=list)


class TestSuiteOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    description: str | None
    created_at: datetime
    test_case_ids: list[UUID] = Field(default_factory=list)


class CreateRunFromSuiteRequest(BaseModel):
    name: str = Field(min_length=3)
    run_type: RunType
