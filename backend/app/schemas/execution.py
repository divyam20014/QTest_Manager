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


class TestRunUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=3)
    run_type: RunType | None = None


class TestRunCaseAddRequest(BaseModel):
    test_case_ids: list[UUID] = Field(min_length=1)
    # Pass 5 item 2 (parameterized execution): for a test case id that has
    # an associated TestDataSet, list which row ids to bundle -- one
    # TestRunCase per selected row. A test case id with no entry here (or
    # an empty list) bundles once, unparameterized, exactly as before --
    # fully backward compatible with every existing caller.
    data_row_ids: dict[UUID, list[UUID]] = Field(default_factory=dict)


class TestRunCaseAssignRequest(BaseModel):
    assigned_to: UUID | None = None


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
    paused_at: datetime | None
    cases: list[TestRunCaseOut]


class TestRunSummaryOut(BaseModel):
    """Lighter-weight shape for list views (no per-case rollups, which
    to_out()'s N+1-style queries make too costly to run per row in a list)."""

    id: UUID
    project_id: UUID
    name: str
    run_type: RunType
    executed_by: UUID
    created_at: datetime
    finished_at: datetime | None
    paused_at: datetime | None
    case_count: int


class RunCaseContextOut(BaseModel):
    """Everything the Execution Console needs to render context around the
    steps it fetches separately -- run/project/case identity, not just the
    step list (FR-EXEC's execution console display requirements)."""

    run_id: UUID
    run_name: str
    run_finished: bool
    run_paused: bool
    project_id: UUID
    project_name: str
    test_case_id: UUID
    test_case_title: str
    priority: str
    version_number: int
    assignee_id: UUID | None
    assignee_name: str | None
    status: RunCaseStatus
    # Pass 5 item 2: when this run case was bundled from a specific
    # TestDataSetRow, the row's name + raw key/value parameters, so the
    # executor knows which data to use.
    data_row_id: UUID | None = None
    data_row_name: str | None = None
    data_row_values: dict | None = None
