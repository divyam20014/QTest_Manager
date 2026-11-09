from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

RunType = Literal["Regression", "Sanity", "Smoke"]
RunCaseStatus = Literal["pending", "in_progress", "passed", "failed", "blocked", "ignored"]
Verdict = Literal["pass", "fail", "ignore"]


class TestRunCreateRequest(BaseModel):
    name: str = Field(min_length=3)
    run_type: RunType
    test_case_ids: list[UUID] = Field(min_length=1)


class VerdictRequest(BaseModel):
    verdict: Verdict


class ExecutionStepOut(BaseModel):
    id: UUID
    test_case_version_step_id: UUID
    step_number: int
    action: str
    expected: str
    verdict: Verdict | None
    opened_at: datetime | None
    closed_at: datetime | None
    duration_ms: int | None
    executed_by: UUID | None


class TestRunCaseOut(BaseModel):
    id: UUID
    test_case_id: UUID
    test_case_version_id: UUID
    title: str
    status: RunCaseStatus
    assigned_to: UUID | None
    started_at: datetime | None
    completed_at: datetime | None
    step_count: int
    passed_count: int
    failed_count: int
    ignored_count: int


class TestRunOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    run_type: RunType
    executed_by: UUID
    created_at: datetime
    finished_at: datetime | None
    cases: list[TestRunCaseOut]
