from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class EnvironmentCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None


class EnvironmentUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None


class EnvironmentOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    created_at: datetime


class BuildCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    built_at: date | None = None
    notes: str | None = None


class BuildOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    built_at: date | None
    notes: str | None
    created_at: datetime


class ReleaseCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    release_date: date | None = None
    notes: str | None = None


class ReleaseOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    release_date: date | None
    notes: str | None
    created_at: datetime
