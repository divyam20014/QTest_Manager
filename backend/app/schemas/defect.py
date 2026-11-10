from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

Severity = Literal["Low", "Medium", "High", "Critical"]
DefectStatus = Literal["New", "Open", "Fixed", "Verified", "Closed"]
LinkableType = Literal["execution_step", "test_case", "defect"]
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


class DefectCreateRequest(BaseModel):
    # FR-EXEC-003: when created from a failed execution step, the backend
    # derives project/test_case/test_run/step traceability itself rather
    # than trusting the client to resend ids it already has server-side.
    execution_step_id: UUID | None = None
    project_id: UUID | None = None
    test_case_id: UUID | None = None
    # In-run, not-step-specific creation (FR-DEF module): a general issue
    # about this run, without pinning a particular step.
    test_run_id: UUID | None = None
    title: str | None = Field(default=None, min_length=5)
    severity: Severity
    description: str | None = None
    actual_result: str | None = None
    expected_result: str | None = None
    environment: str | None = None
    environment_id: UUID | None = None

    @model_validator(mode="after")
    def _require_project_or_step_or_run(self) -> "DefectCreateRequest":
        if self.execution_step_id is None and self.project_id is None and self.test_run_id is None:
            raise ValueError("One of execution_step_id, test_run_id, or project_id is required")
        if self.execution_step_id is None and self.title is None:
            raise ValueError("title is required unless created from a failed execution step")
        return self


class DefectStatusUpdateRequest(BaseModel):
    status: DefectStatus
    # Spec: "Closing requires verification confirmation" -- a distinct,
    # explicit gesture at Closed time, not merely the existence of the
    # Verified status earlier in the sequence.
    verification_confirmed: bool = False


class DefectRootCauseUpdateRequest(BaseModel):
    # None clears a previously-set root cause.
    root_cause: RootCause | None = None


class DefectEnvironmentUpdateRequest(BaseModel):
    environment_id: UUID | None = None


class DefectBuildReleaseUpdateRequest(BaseModel):
    """Tier 2 (PV-8.2): either field, both optional, None clears it."""

    found_in_build_id: UUID | None = None
    fixed_in_release_id: UUID | None = None


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


class DefectOut(BaseModel):
    id: UUID
    project_id: UUID
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
    status: DefectStatus
    description: str | None
    actual_result: str | None
    expected_result: str | None
    environment: str | None
    environment_id: UUID | None
    environment_name: str | None
    found_in_build_id: UUID | None
    found_in_build_name: str | None
    fixed_in_release_id: UUID | None
    fixed_in_release_name: str | None
    root_cause: RootCause | None
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
