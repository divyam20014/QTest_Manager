from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.core.field_standards import (
    BUILD_FOUND_MAX,
    CONTENT_TEXT_MAX,
    DESCRIPTION_MAX,
    FIX_VERSION_MAX,
    LABEL_MAX,
    MAX_LABELS,
    MAX_STEPS,
    ROOT_CAUSE_NOTES_MAX,
    SHORT_TEXT_MAX,
    STEP_DATA_MAX,
    STEP_TEXT_MAX,
    TITLE_MAX,
)
from app.core.text_sanitize import clean_plain, sanitize_markdown

# Tier 5 (PV-9.5): severity is tenant-configurable (app/services/field_option_service.py)
# -- the DB CheckConstraint and this fixed Literal were both removed in favor of
# per-tenant option codes, validated at the service layer against each tenant's
# current `field_options` rows (seeded with these same four values by default).
Severity = Annotated[str, Field(min_length=1, max_length=64)]
# Pass 2: Defect gains a Priority value set, same tenant-configurable
# field_options mechanism as severity ('defect_priority' field_key) --
# never a hardcoded enum.
Priority = Annotated[str, Field(min_length=1, max_length=64)]
# ADR-115/118: eleven codes (legacy Open/Verified stay valid).
DefectStatus = Literal[
    "New",
    "Assigned",
    "In Progress",
    "Fixed",
    "Retest",
    "Reopened",
    "Closed",
    "Rejected",
    "Deferred",
    "Open",
    "Verified",
]
# Requests that change status accept every code; the transition table decides.
DefectStatusInput = DefectStatus
LinkableType = Literal["execution_step", "test_case", "defect", "test_run_case"]
LinkType = Literal["relates_to", "duplicate_of", "caused_by"]
Verdict = Literal["pass", "fail", "ignore"]
RootCause = Literal[
    "requirements_gap",
    "code_defect",
    "design_flaw",
    "test_data_issue",
    "environment_issue",
    "third_party_integration",
    "other",
]
Resolution = Literal[
    "Fixed", "Duplicate", "Won't Fix", "Cannot Reproduce", "By Design", "Not Applicable"
]

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=TITLE_MAX)]


def normalise_labels(value: list[str] | None) -> list[str] | None:
    """Trim, lower-case, drop empties and case-insensitive duplicates (first one wins,
    order kept); at most 20 labels of at most 40 characters each."""
    if value is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for raw in value:
        label = clean_plain(str(raw)).lower()
        if not label:
            continue
        if len(label) > LABEL_MAX:
            raise ValueError(f"Each label must be at most {LABEL_MAX} characters")
        if label in seen:
            continue
        seen.add(label)
        out.append(label)
    if len(out) > MAX_LABELS:
        raise ValueError(f"A defect can have at most {MAX_LABELS} labels")
    return out


class ReproStepIn(BaseModel):
    """One step to reproduce. `step_no` sent by a client is ignored: steps are
    renumbered 1..n from list order."""

    model_config = ConfigDict(populate_by_name=True)

    step_no: int | None = None
    action: str = Field(min_length=1, max_length=STEP_TEXT_MAX)
    test_data: str | None = Field(default=None, max_length=STEP_DATA_MAX)
    expected_result: str | None = Field(
        default=None,
        max_length=STEP_TEXT_MAX,
        validation_alias=AliasChoices("expected_result", "expected"),
    )
    # Set on the step that failed when the defect was raised from an execution.
    failed: bool = False

    @field_validator("action", mode="after")
    @classmethod
    def _clean_action(cls, v: str) -> str:
        cleaned = sanitize_markdown(v)
        if not cleaned:
            raise ValueError("Step action must not be blank")
        return cleaned

    @field_validator("test_data", "expected_result", mode="after")
    @classmethod
    def _clean_optional(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return sanitize_markdown(v) or None


def _check_step_count(value: list[ReproStepIn] | None) -> list[ReproStepIn] | None:
    if value is not None and len(value) > MAX_STEPS:
        raise ValueError(f"At most {MAX_STEPS} steps are allowed")
    return value


class DefectCreateRequest(BaseModel):
    # FR-EXEC-003: when created from a failed execution step (or run case), the
    # backend derives project/test_case/test_run/step traceability itself rather
    # than trusting the client to resend ids it already has server-side.
    execution_step_id: UUID | None = None
    test_run_case_id: UUID | None = None
    project_id: UUID | None = None
    test_case_id: UUID | None = None
    # Further test cases to link on creation (many cases per defect).
    test_case_ids: list[UUID] = Field(default_factory=list, max_length=50)
    # In-run, not-step-specific creation (FR-DEF module): a general issue
    # about this run, without pinning a particular step.
    test_run_id: UUID | None = None
    title: Title | None = None
    severity: Severity | None = None
    priority: Priority | None = None
    status: DefectStatus | None = None
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    preconditions: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    repro_steps: list[ReproStepIn] | None = None
    # Legacy free text: converted to numbered steps when `repro_steps` is not sent.
    steps_to_reproduce: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    actual_result: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    expected_result: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    environment: str | None = Field(default=None, max_length=SHORT_TEXT_MAX)
    environment_id: UUID | None = None
    build_found: str | None = Field(default=None, max_length=BUILD_FOUND_MAX)
    found_in_build_id: UUID | None = None
    fix_version: str | None = Field(default=None, max_length=FIX_VERSION_MAX)
    fixed_in_release_id: UUID | None = None
    root_cause: RootCause | None = None
    root_cause_notes: str | None = Field(default=None, max_length=ROOT_CAUSE_NOTES_MAX)
    labels: list[str] | None = None
    module_id: UUID | None = None
    # Restricted at the service layer to active users assigned to this defect's project.
    assigned_to: UUID | None = None
    # ADR-127: the task this defect belongs to (same project).
    task_id: UUID | None = None
    # Copy the failing step's evidence (attachment references) onto the new defect.
    copy_evidence: bool = True

    @field_validator("labels", mode="after")
    @classmethod
    def _labels(cls, v: list[str] | None) -> list[str] | None:
        return normalise_labels(v)

    @field_validator("repro_steps", mode="after")
    @classmethod
    def _steps(cls, v: list[ReproStepIn] | None) -> list[ReproStepIn] | None:
        return _check_step_count(v)

    @model_validator(mode="after")
    def _require_project_or_step_or_run(self) -> "DefectCreateRequest":
        if (
            self.execution_step_id is None
            and self.test_run_case_id is None
            and self.project_id is None
            and self.test_run_id is None
        ):
            raise ValueError(
                "One of execution_step_id, test_run_case_id, test_run_id, or project_id is required"
            )
        return self


class DefectUpdateRequest(BaseModel):
    """Generic edit (PATCH). Only the fields sent are changed; the status has its own
    endpoint. A legacy row is never refused for an empty mandatory field it already
    had, only for a mandatory field this request clears."""

    title: Title | None = None
    severity: Severity | None = None
    priority: Priority | None = None
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    preconditions: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    repro_steps: list[ReproStepIn] | None = None
    steps_to_reproduce: str | None = Field(default=None, max_length=DESCRIPTION_MAX)
    actual_result: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    expected_result: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)
    environment: str | None = Field(default=None, max_length=SHORT_TEXT_MAX)
    environment_id: UUID | None = None
    build_found: str | None = Field(default=None, max_length=BUILD_FOUND_MAX)
    found_in_build_id: UUID | None = None
    fix_version: str | None = Field(default=None, max_length=FIX_VERSION_MAX)
    fixed_in_release_id: UUID | None = None
    resolution: Resolution | None = None
    root_cause: RootCause | None = None
    root_cause_notes: str | None = Field(default=None, max_length=ROOT_CAUSE_NOTES_MAX)
    labels: list[str] | None = None
    assigned_to: UUID | None = None
    module_id: UUID | None = None
    # ADR-127: the task this defect belongs to (same project); null detaches it.
    task_id: UUID | None = None

    @field_validator("labels", mode="after")
    @classmethod
    def _labels(cls, v: list[str] | None) -> list[str] | None:
        return normalise_labels(v)

    @field_validator("repro_steps", mode="after")
    @classmethod
    def _steps(cls, v: list[ReproStepIn] | None) -> list[ReproStepIn] | None:
        return _check_step_count(v)

    # ADR-136: the `row_version` the caller read. Omit to skip the check.
    expected_version: int | None = None


class DefectStatusUpdateRequest(BaseModel):
    status: DefectStatusInput
    # Spec: "Closing requires verification confirmation" -- a distinct,
    # explicit gesture at Closed time, not merely the existence of the
    # Verified status earlier in the sequence.
    verification_confirmed: bool = False
    # ADR-118: validated against the target status (Rejected needs one, Closed needs
    # one, Fixed defaults to 'Fixed', open statuses must not carry one).
    resolution: Resolution | None = None
    comment: str | None = Field(default=None, max_length=2000)
    # ADR-136: the `row_version` the caller read. Omit to skip the check.
    expected_version: int | None = None


class DefectRootCauseUpdateRequest(BaseModel):
    # None clears a previously-set root cause.
    root_cause: RootCause | None = None


class DefectEnvironmentUpdateRequest(BaseModel):
    environment_id: UUID | None = None


class DefectBuildReleaseUpdateRequest(BaseModel):
    """Tier 2 (PV-8.2): either field, both optional, None clears it."""

    found_in_build_id: UUID | None = None
    fixed_in_release_id: UUID | None = None


class DefectRetestRequest(BaseModel):
    """`POST /defects/{id}/retest`: a new test run of type 'Retest' with the linked
    test cases (latest versions)."""

    # The tester who executes the retest (default: the defect's reporter).
    tester_id: UUID | None = None
    name: str | None = Field(default=None, min_length=3, max_length=200)
    comment: str | None = Field(default=None, max_length=2000)


class DefectRetestResultRequest(BaseModel):
    result: Literal["pass", "fail"]
    run_case_id: UUID
    comment: str | None = Field(default=None, max_length=CONTENT_TEXT_MAX)


class DefectLinkCreateRequest(BaseModel):
    linkable_type: LinkableType
    linkable_id: UUID
    link_type: LinkType = "relates_to"


class DefectLinkOut(BaseModel):
    id: UUID
    linkable_type: LinkableType
    linkable_id: UUID
    link_type: LinkType
    created_at: datetime


class ExecutionEvidenceOut(BaseModel):
    """Snapshot of the originating execution step, shown on the defect
    detail page so a reader doesn't have to cross-reference the run
    separately to see what actually happened (FR-DEF traceability)."""

    execution_step_id: UUID
    test_run_case_id: UUID
    verdict: Verdict | None
    opened_at: datetime | None
    closed_at: datetime | None
    duration_ms: int | None
    executed_by: UUID | None
    executed_by_name: str | None


class PossibleDuplicateOut(BaseModel):
    """Tier 2 duplicate-defect detection: a text-similarity heuristic
    (rapidfuzz), suggestion-only -- never auto-merges or auto-rejects."""

    defect_id: UUID
    title: str
    status: DefectStatus
    similarity: float


class DefectHistoryEntryOut(BaseModel):
    id: UUID
    action: str
    user_id: UUID | None
    user_name: str | None
    event_metadata: dict
    created_at: datetime
    # ADR-118: `{field: {"from": ..., "to": ...}}` lifted out of the event metadata
    # (status, severity, priority, assignee, link / unlink, field edits) so a client
    # does not have to know each event's shape. Empty when the event has none.
    changes: dict = {}


class LinkedTestCaseOut(BaseModel):
    """A test case linked to a defect (primary FK or defect link), with its latest
    execution."""

    id: UUID
    display_id: str | None
    title: str
    module_name: str | None = None
    module_path: str | None = None
    is_primary: bool = False
    latest_execution_status: str = "Not Run"
    latest_execution_at: datetime | None = None
    latest_executed_by: UUID | None = None
    latest_executed_by_name: str | None = None
    test_run_id: UUID | None = None
    test_run_name: str | None = None
    test_run_case_id: UUID | None = None
    raised_from_run_case_id: UUID | None = None
    linked_at: datetime | None = None


class LinkedDefectForCaseOut(BaseModel):
    id: UUID
    display_id: str | None
    title: str
    status: DefectStatus
    severity: Severity
    priority: Priority
    assigned_to: UUID | None
    assigned_to_name: str | None


class RetestEntryOut(BaseModel):
    """One retest of a defect: a run case in a 'Retest' run."""

    test_run_id: UUID
    test_run_name: str
    test_run_case_id: UUID
    test_case_id: UUID
    test_case_display_id: str | None
    test_case_title: str
    run_case_status: str
    assigned_to: UUID | None
    assigned_to_name: str | None
    executed_by: UUID | None
    executed_by_name: str | None
    executed_at: datetime | None
    result: str | None
    result_recorded_at: datetime | None
    created_at: datetime


class DefectRetestOut(BaseModel):
    defect_id: UUID
    status: DefectStatus
    test_run_id: UUID
    test_run_name: str
    run_case_ids: list[UUID]
    test_case_ids: list[UUID]


class DefectRetestResultOut(BaseModel):
    defect_id: UUID
    result: Literal["pass", "fail"]
    status: DefectStatus
    closed: bool
    reopened_count: int


class DraftStepOut(BaseModel):
    step_no: int
    action: str
    test_data: str | None = None
    expected_result: str | None = None
    failed: bool = False


class DraftEvidenceOut(BaseModel):
    attachment_id: UUID
    file_name: str
    size_bytes: int
    execution_step_id: UUID


class DefectDraftOut(BaseModel):
    """A prefilled defect for a failed execution (`GET /test-run-cases/{id}/defect-draft`).
    Nothing is stored; post the fields (plus severity and priority) to `POST /defects`
    or just send `test_run_case_id` and let the server derive them."""

    project_id: UUID
    test_run_case_id: UUID
    test_run_id: UUID
    test_run_name: str
    test_case_id: UUID
    test_case_display_id: str | None
    test_case_title: str
    test_case_version_number: int
    title: str
    description: str
    module_id: UUID | None
    module_name: str | None
    module_path: str | None
    preconditions: str | None
    repro_steps: list[DraftStepOut]
    failing_step_no: int | None
    failing_execution_step_id: UUID | None
    expected_result: str | None
    actual_result: str | None
    environment: str | None
    build_found: str | None
    tester_id: UUID | None
    tester_name: str | None
    executed_at: datetime | None
    run_case_status: str
    evidence: list[DraftEvidenceOut]
    existing_defects: list[LinkedDefectForCaseOut]


class DefectOut(BaseModel):
    id: UUID
    project_id: UUID
    # ADR-136: send back as `expected_version` when saving.
    row_version: int
    project_name: str
    test_case_id: UUID | None
    test_case_title: str | None
    test_case_version_id: UUID | None
    test_case_version_number: int | None
    test_run_id: UUID | None
    test_run_name: str | None
    test_run_case_id: UUID | None
    test_case_version_step_id: UUID | None
    step_number: int | None
    title: str
    severity: Severity
    priority: Priority
    status: DefectStatus
    status_label: str
    description: str | None
    steps_to_reproduce: str | None
    actual_result: str | None
    expected_result: str | None
    environment: str | None
    environment_id: UUID | None
    environment_name: str | None
    task_id: UUID | None = None
    task_display_id: str | None = None
    task_title: str | None = None
    found_in_build_id: UUID | None
    found_in_build_name: str | None
    fixed_in_release_id: UUID | None
    fixed_in_release_name: str | None
    root_cause: RootCause | None
    module_id: UUID | None
    module_name: str | None
    assigned_to: UUID | None
    assigned_to_name: str | None
    reported_by: UUID
    reported_by_name: str | None
    created_at: datetime
    closed_at: datetime | None
    age_days: int
    sla_breached: bool
    reopened_count: int
    last_reopened_at: datetime | None
    links: list[DefectLinkOut] = []
    execution_evidence: ExecutionEvidenceOut | None = None
    custom_fields: dict[str, object] = {}
    # ADR-115/118: 22-field standard (display_id is immutable and absent from every
    # create/update schema).
    display_id: str | None = None
    preconditions: str | None = None
    resolution: str | None = None
    labels: list[str] = []
    repro_steps: list[dict] | None = None
    build_found: str | None = None
    fix_version: str | None = None
    root_cause_notes: str | None = None
    # Aliases named after the brief's fields.
    reporter: UUID | None = None
    assignee: UUID | None = None
    date_reported: datetime | None = None
    attachment_count: int = 0
    linked_test_cases: list[LinkedTestCaseOut] = []
    linked_test_case_count: int = 0


class DefectListResponse(BaseModel):
    """One page of defects (`GET /defects?page_size=...`) with the total that match."""

    items: list[DefectOut]
    total: int


class DefectStatusCountsOut(BaseModel):
    """How many matching defects there are in each status (`GET /defects/status-counts`)."""

    counts: dict[str, int]
    total: int


class DefectFieldSpecOut(BaseModel):
    key: str
    label: str
    type: str
    group: str
    sortable: bool
    filterable: bool
    editable: bool
    mandatory_on_create: bool
    default_visible: bool


class DefectFieldCatalogOut(BaseModel):
    fields: list[DefectFieldSpecOut]
    default_columns: list[str]
    sortable: list[str]
    filters: list[str]
    statuses: list[str]
    resolutions: list[str]
    transitions: dict[str, list[str]]
    export_columns: list[str]
