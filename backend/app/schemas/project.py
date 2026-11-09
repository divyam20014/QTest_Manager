from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

Domain = Literal["Motor", "Health", "Travel", "Life", "Property"]
Priority = Literal["Low", "Medium", "High", "Critical"]
ProjectStatus = Literal["On Track", "At Risk", "Delayed", "Completed"]


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=3)
    domain: Domain
    priority: Priority
    status: ProjectStatus = "On Track"
    manager_name: str = Field(min_length=1)
    manager_user_id: UUID | None = None
    start_date: date
    end_date: date
    budget: Decimal = Field(ge=0)
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    region: str = Field(min_length=1)

    @model_validator(mode="after")
    def _check_dates(self) -> "ProjectCreateRequest":
        if self.end_date < self.start_date:
            raise ValueError("Start date cannot be after end date.")
        return self


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=3)
    domain: Domain | None = None
    priority: Priority | None = None
    status: ProjectStatus | None = None
    manager_name: str | None = Field(default=None, min_length=1)
    manager_user_id: UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget: Decimal | None = Field(default=None, ge=0)
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    region: str | None = Field(default=None, min_length=1)
    # Optimistic concurrency control (GAP-68): pass the project's current
    # `version` (from a prior GET/PATCH response) to detect a concurrent
    # edit -- the update is rejected with 409 if it doesn't match, instead
    # of silently overwriting another caller's change. Omit to keep the
    # previous last-write-wins behavior unchanged.
    expected_version: int | None = None


class ProjectOut(BaseModel):
    id: UUID
    name: str
    domain: Domain
    status: ProjectStatus
    priority: Priority
    manager_name: str
    manager_user_id: UUID | None
    start_date: date
    end_date: date
    budget: Decimal
    currency_code: str
    region: str
    owner_id: UUID
    assigned_user_ids: list[UUID]
    created_at: datetime
    version: int
    test_case_count: int = 0
    approved_test_case_count: int = 0
    test_run_count: int = 0
    open_defect_count: int = 0


class ProjectListResponse(BaseModel):
    items: list[ProjectOut]
    total: int


class ProjectMemberAddRequest(BaseModel):
    user_id: UUID
