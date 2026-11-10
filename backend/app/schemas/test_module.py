from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TestModuleCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    parent_id: UUID | None = None


class TestModuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    parent_id: UUID | None = None


class TestModuleOut(BaseModel):
    id: UUID
    project_id: UUID
    parent_id: UUID | None
    name: str
    test_case_count: int
    created_at: datetime
