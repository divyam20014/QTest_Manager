from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SharedStepCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    action: str = Field(min_length=1)
    expected: str = Field(min_length=1)
    category: str | None = None


class SharedStepUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    action: str | None = Field(default=None, min_length=1)
    expected: str | None = Field(default=None, min_length=1)
    category: str | None = None


class SharedStepOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    action: str
    expected: str
    category: str | None
    created_at: datetime
