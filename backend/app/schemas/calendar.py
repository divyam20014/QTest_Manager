from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class CalendarRunOut(BaseModel):
    """A test run on the calendar: it starts on its creation date and ends when it is finished."""

    id: UUID
    name: str
    project_id: UUID
    project_name: str
    run_type: str
    status: Literal["in_progress", "paused", "finished"]
    start_date: date
    end_date: date | None


class CalendarDueOut(BaseModel):
    """Run cases of one open run that fall due on one day."""

    due_date: date
    run_id: UUID
    run_name: str
    project_id: UUID
    project_name: str
    total_cases: int
    open_cases: int
    overdue: bool


class CalendarReleaseOut(BaseModel):
    id: UUID
    name: str
    project_id: UUID
    project_name: str
    release_date: date
    status: str | None


class CalendarOut(BaseModel):
    from_date: date
    to_date: date
    runs: list[CalendarRunOut]
    due: list[CalendarDueOut]
    releases: list[CalendarReleaseOut]
    # True when a list hit its cap: the range holds more than is shown (narrow it by project).
    truncated: bool = False
