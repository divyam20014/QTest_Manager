"""ADR-127: request / response models for tasks, sub-tasks and tenant task statuses."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

TaskStatusCategory = Literal["todo", "in_progress", "done"]
HEX_COLOR = r"^#[0-9a-fA-F]{6}$"
STATUS_CODE = r"^[a-z][a-z0-9_]{1,39}$"


# --- statuses ----------------------------------------------------------------------------


class TaskStatusOut(BaseModel):
    id: UUID
    code: str
    label: str
    category: TaskStatusCategory
    color: str | None
    sort_order: int
    is_default: bool
    task_count: int = 0


class TaskStatusCreateRequest(BaseModel):
    code: str = Field(pattern=STATUS_CODE)
    label: str = Field(min_length=1, max_length=40)
    category: TaskStatusCategory
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    sort_order: int | None = Field(default=None, ge=0, le=1000)
    is_default: bool = False


class TaskStatusUpdateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=40)
    category: TaskStatusCategory | None = None
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    sort_order: int | None = Field(default=None, ge=0, le=1000)
    is_default: bool | None = None


# --- tasks -------------------------------------------------------------------------------


class TaskStatusRef(BaseModel):
    id: UUID
    code: str
    label: str
    category: TaskStatusCategory
    color: str | None


class TaskRef(BaseModel):
    id: UUID
    display_id: str | None
    title: str
    depth: int


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=20000)
    # Set to create a sub-task; the parent must be in the same project.
    parent_task_id: UUID | None = None
    status_id: UUID | None = None
    priority: str | None = Field(default=None, max_length=40)
    assignee_id: UUID | None = None
    release_id: UUID | None = None
    start_date: date | None = None
    due_date: date | None = None


class TaskUpdateRequest(BaseModel):
    """Only the fields sent are changed. `parent_task_id` moves the task (null = make it a
    root task); its sub-tasks move with it."""

    title: str | None = Field(default=None, min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=20000)
    parent_task_id: UUID | None = None
    priority: str | None = Field(default=None, max_length=40)
    assignee_id: UUID | None = None
    release_id: UUID | None = None
    start_date: date | None = None
    due_date: date | None = None


class TaskStatusChangeRequest(BaseModel):
    status_id: UUID


class TaskLinkTestCaseRequest(BaseModel):
    test_case_id: UUID


class TaskOut(BaseModel):
    id: UUID
    project_id: UUID
    parent_task_id: UUID | None
    depth: int
    display_id: str | None
    title: str
    description: str | None
    status: TaskStatusRef
    priority: str
    assignee_id: UUID | None
    assignee_name: str | None
    release_id: UUID | None
    start_date: date | None
    due_date: date | None
    completed_at: datetime | None
    is_overdue: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    # Direct children / direct links (no recursion).
    sub_task_count: int = 0
    sub_tasks_done: int = 0
    requirement_count: int = 0
    defect_count: int = 0
    test_case_count: int = 0


class TaskLinkedTestCaseOut(BaseModel):
    test_case_id: UUID
    display_id: str | None
    title: str
    status: str
    linked_by: UUID
    linked_at: datetime


class TaskDetailOut(TaskOut):
    ancestors: list[TaskRef] = []
    sub_tasks: list[TaskOut] = []
    test_cases: list[TaskLinkedTestCaseOut] = []


class TaskListResponse(BaseModel):
    items: list[TaskOut]
    total: int


# --- rollups, effective test cases, runs, history (phase 4) ---------------------------------


class TaskHistoryEntryOut(BaseModel):
    id: UUID
    action: str
    user_id: UUID | None
    user_name: str | None
    event_metadata: dict
    created_at: datetime


class TaskRollupOut(BaseModel):
    """Numbers for a task and (unless `include_sub_tasks` is false) every sub-task below it."""

    task_id: UUID
    include_sub_tasks: bool
    # Work: the sub-tasks below the task, by category (the task itself is not counted).
    sub_tasks_total: int
    sub_tasks_todo: int
    sub_tasks_in_progress: int
    sub_tasks_done: int
    sub_tasks_overdue: int
    # 0-100: share of sub-tasks done; a task without sub-tasks is 0 or 100 by its own status.
    progress_percent: int
    # Requirements and how many of them have at least one linked test case.
    requirements_total: int
    requirements_covered: int
    # Distinct test cases: linked to a task directly or through one of its requirements.
    test_cases_total: int
    test_cases_passed: int
    test_cases_failed: int
    test_cases_blocked: int
    test_cases_not_run: int
    # passed / (passed + failed + blocked) over each case's latest result; null before any result.
    pass_rate: int | None
    test_runs_total: int
    defects_total: int
    defects_open: int
    defects_critical_open: int


class TaskSummaryStatus(BaseModel):
    status_id: UUID
    code: str
    label: str
    category: TaskStatusCategory
    color: str | None
    count: int


class TaskSummaryOut(BaseModel):
    """A project's tasks at a glance (the Overview "Task progress" widget)."""

    project_id: UUID
    total: int
    top_level: int
    sub_tasks: int
    todo: int
    in_progress: int
    done: int
    # 0-100: share of all the project's tasks that are done.
    progress_percent: int
    overdue: int
    due_next_7_days: int
    unassigned_open: int
    completed_last_7_days: int
    by_status: list[TaskSummaryStatus]


class TaskTestCaseRow(BaseModel):
    test_case_id: UUID
    display_id: str | None
    title: str
    status: str
    # Where the case comes from: linked to the task, or through one of its requirements.
    linked_directly: bool
    via_requirement: bool
    # Latest result over every run: passed / failed / blocked, or null when never executed.
    last_result: str | None
    task_id: UUID
    task_display_id: str | None


class TaskRunRow(BaseModel):
    run_id: UUID
    name: str
    run_type: str
    created_at: datetime
    finished_at: datetime | None
    # Counts of THIS task's test cases inside the run.
    cases_total: int
    cases_passed: int
    cases_failed: int
    cases_blocked: int
