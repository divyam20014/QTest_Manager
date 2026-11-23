from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


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


class BuildBulkCreateRequest(BaseModel):
    """Gap-closure pass (ADR-057): one-at-a-time was the only path before
    this. A simple multi-row list, not a CSV upload -- consistent with
    this project's existing single-create shape, cheaper than building a
    new file-parsing path for a handful of rows at a time."""

    builds: list[BuildCreateRequest] = Field(min_length=1, max_length=500)


ReleaseStatus = Literal["Planned", "In Progress", "Released", "Cancelled"]


class ReleaseCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    release_date: date | None = None
    notes: str | None = None
    status: ReleaseStatus | None = None


class ReleaseUpdateRequest(BaseModel):
    """PATCH /releases/{id} (ADR-122): only the fields sent change; null clears optional ones."""

    name: str | None = Field(default=None, min_length=1)
    release_date: date | None = None
    notes: str | None = None
    status: ReleaseStatus | None = None

    @model_validator(mode="after")
    def _name_not_null(self) -> "ReleaseUpdateRequest":
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Release name cannot be empty")
        return self


class ReleaseBulkCreateRequest(BaseModel):
    releases: list[ReleaseCreateRequest] = Field(min_length=1, max_length=500)


class ReleaseOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    release_date: date | None
    notes: str | None
    status: ReleaseStatus | None = None
    created_at: datetime
