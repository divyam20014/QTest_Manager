import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    computed_field,
    field_validator,
    model_validator,
)

from app.core.field_standards import (
    CONTENT_TEXT_MAX,
    DESCRIPTION_MAX,
    MAX_STEPS,
    SHORT_TEXT_MAX,
    STEP_DATA_MAX,
    STEP_TEXT_MAX,
    TEST_DATA_MAX,
    TITLE_MAX,
    TITLE_MIN,
)
from app.core.text_sanitize import clean_plain, sanitize_markdown

# Tier 5 (PV-9.5): priority is tenant-configurable (app/services/field_option_service.py)
# -- the DB CheckConstraint and this fixed Literal were both removed in favor of
# per-tenant option codes, validated at the service layer against each tenant's
# current `field_options` rows (seeded with these same four values by default).
Priority = Annotated[str, Field(min_length=1, max_length=64)]
TestCaseStatus = Literal["draft", "ready_for_review", "approved", "deprecated"]
StepChangeType = Literal["unchanged", "added", "removed", "modified"]


class TestCaseHistoryEntryOut(BaseModel):
    id: UUID
    action: str
    user_id: UUID | None
    user_name: str | None
    event_metadata: dict
    created_at: datetime


AutomationStatus = Literal["Manual", "Automated", "Candidate for Automation"]
Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=TITLE_MIN, max_length=TITLE_MAX)
]
TestDataFormat = Literal["auto", "json", "text"]


class StepIn(BaseModel):
    """One step. `step_no` is accepted for convenience but ignored: steps are
    renumbered 1..n from their position in the list, so a reorder is just the same
    list sent in a new order. `expected_result` is accepted as an alias of
    `expected`."""

    model_config = ConfigDict(populate_by_name=True)

    step_no: int | None = Field(default=None, ge=1)
    action: str = Field(min_length=1, max_length=STEP_TEXT_MAX)
    expected: str = Field(
        min_length=1,
        max_length=STEP_TEXT_MAX,
        validation_alias=AliasChoices("expected", "expected_result"),
    )
    test_data: str | None = Field(default=None, max_length=STEP_DATA_MAX)

    @field_validator("action", "expected")
    @classmethod
    def _clean_text(cls, value: str) -> str:
        cleaned = sanitize_markdown(value)
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned

    @field_validator("test_data")
    @classmethod
    def _clean_data(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return clean_plain(value) or None


class StepOut(BaseModel):
    step_number: int
    action: str
    expected: str
    test_data: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def step_no(self) -> int:
        return self.step_number

    @computed_field  # type: ignore[prop-decorator]
    @property
    def expected_result(self) -> str:
        return self.expected


def _merge_preconditions(data: Any) -> Any:
    """`prerequisite` is the legacy name of `preconditions`."""
    if isinstance(data, dict) and "prerequisite" in data:
        data = dict(data)
        legacy = data.pop("prerequisite")
        if "preconditions" not in data:
            data["preconditions"] = legacy
        elif data["preconditions"] != legacy:
            raise ValueError("preconditions and prerequisite are the same field; send one value")
    return data


class _TestCaseContent(BaseModel):
    """Writable content shared by the create and update requests."""

    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    preconditions: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    test_data: str | None = Field(default=None, max_length=TEST_DATA_MAX)
    # Hint only (not stored): 'json' rejects malformed JSON; 'auto'/'text' accept anything.
    test_data_format: TestDataFormat = "auto"
    expected_result: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    postconditions: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    scenario_id: str | None = Field(default=None, max_length=SHORT_TEXT_MAX)
    scenario_description: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    test_type: str | None = Field(default=None, max_length=64)
    severity: str | None = Field(default=None, max_length=64)
    automation_status: AutomationStatus | None = None
    environment: str | None = Field(default=None, max_length=SHORT_TEXT_MAX)
    requirement_ref: str | None = Field(default=None, max_length=SHORT_TEXT_MAX)

    @model_validator(mode="before")
    @classmethod
    def _legacy_names(cls, data: Any) -> Any:
        return _merge_preconditions(data)

    @field_validator(
        "description", "preconditions", "expected_result", "postconditions", "scenario_description"
    )
    @classmethod
    def _markdown(cls, value: str | None) -> str | None:
        return None if value is None else sanitize_markdown(value)

    @field_validator("test_data")
    @classmethod
    def _plain(cls, value: str | None) -> str | None:
        return None if value is None else clean_plain(value)

    @field_validator("scenario_id", "environment", "requirement_ref", "test_type", "severity")
    @classmethod
    def _short(cls, value: str | None) -> str | None:
        return None if value is None else (clean_plain(value) or None)

    @model_validator(mode="after")
    def _check_test_data_format(self) -> "_TestCaseContent":
        if self.test_data_format == "json" and self.test_data:
            try:
                json.loads(self.test_data)
            except ValueError as exc:
                raise ValueError(f"test_data is not valid JSON: {exc}") from exc
        return self


class TestCaseCreateRequest(_TestCaseContent):
    """Creating a case through the API requires module, title, priority,
    preconditions, test data, at least one step and the case-level expected result
    (`test_case_service.enforce_create_requirements`, which gives one message per
    missing field). The fields stay optional here so internal callers (AI
    generation, templates, sample data) keep working. See ADR-116."""

    title: Title
    module_id: UUID | None = None
    priority: Priority
    assignee_id: UUID | None = None
    steps: list[StepIn] = Field(min_length=1, max_length=MAX_STEPS)
    description: str | None = Field(default="", max_length=DESCRIPTION_MAX)


class TestCaseUpdateRequest(_TestCaseContent):
    title: Title | None = None
    module_id: UUID | None = None
    priority: Priority | None = None
    assignee_id: UUID | None = None
    steps: list[StepIn] | None = Field(default=None, min_length=1, max_length=MAX_STEPS)
    # The id is immutable; echoing the current value back is tolerated, anything
    # else is refused by the service.
    display_id: str | None = Field(default=None, max_length=64)


class TestCaseBulkUpdateRequest(BaseModel):
    """ADR-070: bulk metadata edit. Only the fields explicitly present in the
    request body are applied: `assignee_id: null` unassigns, omitting the key
    leaves the assignee alone. Never changes test content, so approved cases
    stay approved on their current version."""

    test_case_ids: list[UUID] = Field(min_length=1, max_length=200)
    priority: Priority | None = None
    assignee_id: UUID | None = None


class BulkItemResult(BaseModel):
    test_case_id: UUID
    ok: bool
    error: str | None = None


class TestCaseBulkUpdateResult(BaseModel):
    updated: int
    failed: int
    results: list[BulkItemResult]


class LinkedDefectOut(BaseModel):
    id: UUID
    display_id: str | None = None
    title: str
    status: str


class TestCaseOut(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str
    priority: Priority
    # `status` is the lifecycle status (draft / ready_for_review / approved /
    # deprecated). It keeps its API name for backward compatibility; the product
    # label is "Review Status" and `review_status*` repeat it under that name.
    # The execution outcome is `execution_status`, a different thing.
    status: TestCaseStatus
    status_label: str
    review_status: TestCaseStatus
    review_status_label: str
    assignee_id: UUID | None
    module_id: UUID | None
    module_name: str | None = None
    # Module / Sub-module / Feature, from the nesting of test_modules ("A/B/C").
    module_path: str | None = None
    reviewer_id: UUID | None
    reviewer_name: str | None
    version_number: int
    created_by: UUID
    created_by_name: str | None = None
    created_at: datetime
    steps: list[StepOut]
    custom_fields: dict[str, object] = {}
    scenario_id: str | None
    scenario_description: str | None
    prerequisite: str | None
    # Same value as `prerequisite` (its new name).
    preconditions: str | None = None
    test_data: str | None
    # 'json' when test_data is a JSON object/array, else 'text' (None when empty).
    test_data_format: str | None = None
    # Pass 2: NOT stored fields -- derived read-only from the most recent
    # execution of this test case across any test run (execution_service's
    # ExecutionStep is the authoritative source). Never settable via
    # create/update/import; absent entirely if the case has never been
    # executed.
    last_execution_result: str | None = None
    last_executed_by_name: str | None = None
    last_execution_date: datetime | None = None
    # ADR-116: derived from the latest executed test run case (Pass / Fail /
    # Blocked / Skipped, or Not Run). Never stored on the test case.
    execution_status: str = "Not Run"
    last_executed_by: str | None = None
    last_executed_by_id: UUID | None = None
    last_executed_at: datetime | None = None
    # Actual result text of that latest executed run case (execution record data).
    last_actual_result: str | None = None
    linked_defects: list[LinkedDefectOut] = []
    linked_defect_count: int = 0
    attachment_count: int = 0
    comment_count: int = 0
    # ADR-115: 22-field standard. Read-only here; display_id is immutable and is
    # deliberately absent from every create/update schema.
    display_id: str | None = None
    test_type: str | None = None
    severity: str | None = None
    automation_status: str | None = None
    environment: str | None = None
    requirement_ref: str | None = None
    postconditions: str | None = None
    expected_result: str | None = None
    quarantined: bool = False
    quarantine_reason: str | None = None
    quarantined_at: datetime | None = None


class TestCaseExecutionOut(BaseModel):
    """One execution of a test case (one test run case) for the history tab."""

    test_run_case_id: UUID
    test_run_id: UUID
    run_name: str
    run_type: str
    run_finished: bool
    executed_at: datetime | None
    executed_by_id: UUID | None
    executed_by_name: str | None
    status: str  # the run case status (pending, passed, failed, ...)
    execution_status: str  # Pass / Fail / Blocked / Skipped / Not Run
    actual_result: str | None
    blocked_reason: str | None
    version_number: int
    defects: list[LinkedDefectOut]


class TestCaseExecutionListResponse(BaseModel):
    items: list[TestCaseExecutionOut]
    total: int


class FieldSpecOut(BaseModel):
    key: str
    label: str
    type: str
    group: str
    sortable: bool
    filterable: bool
    editable: bool
    mandatory_on_create: bool
    default_visible: bool


class TestCaseFieldCatalogOut(BaseModel):
    fields: list[FieldSpecOut]
    default_columns: list[str]
    sortable: list[str]
    filters: list[str]
    automation_statuses: list[str]
    execution_statuses: list[str]


class SubmitForReviewRequest(BaseModel):
    reviewer_id: UUID | None = None


class RequestChangesRequest(BaseModel):
    comment: str = Field(min_length=1)


class TestCaseListResponse(BaseModel):
    items: list[TestCaseOut]
    total: int


class TestCaseVersionOut(BaseModel):
    version_number: int
    title: str
    description: str
    scenario_id: str | None = None
    scenario_description: str | None = None
    prerequisite: str | None = None
    preconditions: str | None = None
    test_data: str | None = None
    postconditions: str | None = None
    expected_result: str | None = None
    approved_by: UUID | None
    approved_at: datetime | None
    created_by: UUID
    created_at: datetime
    steps: list[StepOut]


class StepDiff(BaseModel):
    step_number: int
    change: StepChangeType
    old_action: str | None = None
    old_expected: str | None = None
    new_action: str | None = None
    new_expected: str | None = None


class VersionCompareOut(BaseModel):
    from_version: int
    to_version: int
    title_changed: bool
    old_title: str
    new_title: str
    description_changed: bool
    old_description: str
    new_description: str
    steps: list[StepDiff]


class QuarantineRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
