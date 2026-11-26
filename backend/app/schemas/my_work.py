from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.task import TaskStatusRef

MyRunCaseStatus = Literal["pending", "in_progress", "failed", "blocked"]


class MyRunCaseOut(BaseModel):
    id: UUID
    run_id: UUID
    run_name: str
    run_paused: bool
    project_id: UUID
    project_name: str
    test_case_id: UUID
    test_case_display_id: str | None
    title: str
    status: MyRunCaseStatus
    blocked_reason: str | None
    started_at: datetime | None
    # ADR-123: assignment due date; `overdue` = past due and not yet executed.
    due_date: date | None = None
    overdue: bool = False


class MyRunCaseListResponse(BaseModel):
    items: list[MyRunCaseOut]
    total: int


class MyReviewOut(BaseModel):
    id: UUID
    display_id: str | None
    title: str
    priority: str
    project_id: UUID
    project_name: str
    created_at: datetime


class MyReviewListResponse(BaseModel):
    items: list[MyReviewOut]
    total: int


class MyTaskOut(BaseModel):
    id: UUID
    display_id: str | None
    title: str
    project_id: UUID
    project_name: str
    status: TaskStatusRef
    priority: str
    due_date: date | None = None
    # Past due and not in a "done" status.
    overdue: bool = False


class MyTaskListResponse(BaseModel):
    items: list[MyTaskOut]
    total: int


class MyWorkSummaryOut(BaseModel):
    """Counts behind the sidebar badge and the My Work tab labels. They come from the
    same queries as the lists, so a badge can never disagree with its tab."""

    run_cases_pending: int
    run_cases_in_progress: int
    run_cases_failed: int
    run_cases_blocked: int
    run_cases_total: int
    reviews_total: int
    tasks_total: int
    tasks_overdue: int
