"""Phase 2: planning requests and responses."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.task import TaskOut, TaskStatusRef


class BacklogOut(BaseModel):
    items: list[TaskOut]
    total: int


class BacklogMoveRequest(BaseModel):
    # The task to place this one immediately before; null puts it at the end.
    before_task_id: UUID | None


def _clean_name(v: object) -> object:
    return " ".join(v.split()) if isinstance(v, str) else v


class MilestoneCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    due_date: date | None = None

    _name = field_validator("name", mode="before")(_clean_name)


class MilestoneUpdateRequest(BaseModel):
    """Only the fields sent are changed; send null to clear the description or date."""

    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    due_date: date | None = None
    completed: bool | None = None

    _name = field_validator("name", mode="before")(_clean_name)

    @model_validator(mode="after")
    def _required_stay_set(self) -> "MilestoneUpdateRequest":
        for field in ("name", "completed"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be cleared")
        return self


class MilestoneOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    description: str | None
    due_date: date | None
    completed_at: datetime | None
    task_count: int
    done_count: int
    estimate_hours: Decimal
    done_estimate_hours: Decimal


# --- sprints (ADR-146) -------------------------------------------------------------------------

SprintState = Literal["planned", "active", "closed"]


class SprintCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    goal: str | None = Field(default=None, max_length=2000)
    start_date: date
    end_date: date

    _name = field_validator("name", mode="before")(_clean_name)

    @model_validator(mode="after")
    def _date_order(self) -> "SprintCreateRequest":
        if self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class SprintUpdateRequest(BaseModel):
    """Only the fields sent are changed; send null to clear the goal."""

    name: str | None = Field(default=None, min_length=2, max_length=120)
    goal: str | None = Field(default=None, max_length=2000)
    start_date: date | None = None
    end_date: date | None = None

    _name = field_validator("name", mode="before")(_clean_name)

    @model_validator(mode="after")
    def _required_stay_set(self) -> "SprintUpdateRequest":
        for field in ("name", "start_date", "end_date"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be cleared")
        return self


class SprintCloseRequest(BaseModel):
    # Where the unfinished tasks go: a planned sprint, or null for the backlog. No default:
    # whoever closes the sprint chooses.
    move_unfinished_to: UUID | None


class TaskSprintRequest(BaseModel):
    # The sprint to put the task in, or null to take it out of its sprint.
    sprint_id: UUID | None


class SprintOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    goal: str | None
    start_date: date
    end_date: date
    state: SprintState
    started_at: datetime | None
    closed_at: datetime | None
    # What the sprint holds now; for a closed one, what it held when it closed.
    task_count: int
    done_count: int
    estimate_hours: Decimal
    done_estimate_hours: Decimal


class SprintTaskOut(BaseModel):
    task_id: UUID
    display_id: str | None
    title: str
    # The task's status today, which for a closed sprint may have changed since.
    status: TaskStatusRef
    assignee_name: str | None
    deleted: bool
    added_after_start: bool
    removed_at: datetime | None
    # In the sprint: done (now, or at close). False for a removed task.
    done: bool
    estimate_hours: Decimal | None


class SprintTotal(BaseModel):
    count: int
    hours: Decimal


class SprintTotals(BaseModel):
    # In the sprint when it started (for a planned sprint: what it holds now).
    planned: SprintTotal
    added: SprintTotal
    removed: SprintTotal
    completed: SprintTotal
    unfinished: SprintTotal


class SprintDetailOut(SprintOut):
    totals: SprintTotals
    tasks: list[SprintTaskOut]
