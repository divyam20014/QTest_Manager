from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

Severity = Literal["Low", "Medium", "High", "Critical"]
DefectStatus = Literal["New", "Open", "Fixed", "Verified", "Closed"]
LinkableType = Literal["execution_step", "test_case", "defect"]
LinkType = Literal["relates_to", "duplicate_of", "caused_by"]


class DefectCreateRequest(BaseModel):
    # FR-EXEC-003: when created from a failed execution step, the backend
    # derives project/test_case/test_run/step traceability itself rather
    # than trusting the client to resend ids it already has server-side.
    execution_step_id: UUID | None = None
    project_id: UUID | None = None
    test_case_id: UUID | None = None
    title: str | None = Field(default=None, min_length=5)
    severity: Severity
    description: str | None = None

    @model_validator(mode="after")
    def _require_project_or_step(self) -> "DefectCreateRequest":
        if self.execution_step_id is None and self.project_id is None:
            raise ValueError("Either execution_step_id or project_id is required")
        if self.execution_step_id is None and self.title is None:
            raise ValueError("title is required for a standalone defect")
        return self


class DefectStatusUpdateRequest(BaseModel):
    status: DefectStatus


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


class DefectOut(BaseModel):
    id: UUID
    project_id: UUID
    project_name: str
    test_case_id: UUID | None
    test_case_title: str | None
    test_case_version_id: UUID | None
    test_run_id: UUID | None
    test_run_name: str | None
    test_case_version_step_id: UUID | None
    step_number: int | None
    title: str
    severity: Severity
    status: DefectStatus
    description: str | None
    reported_by: UUID
    created_at: datetime
    closed_at: datetime | None
    links: list[DefectLinkOut] = []
