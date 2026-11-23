from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

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


class MyWorkSummaryOut(BaseModel):
    """Counts behind the sidebar badge and the My Work tab labels. They come from the
    same queries as the lists, so a badge can never disagree with its tab."""

    run_cases_pending: int
    run_cases_in_progress: int
    run_cases_failed: int
    run_cases_blocked: int
    run_cases_total: int
    reviews_total: int
