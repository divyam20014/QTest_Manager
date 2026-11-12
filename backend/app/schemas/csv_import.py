from uuid import UUID

from pydantic import BaseModel


class DetectedColumn(BaseModel):
    """Pass 3: one column found in an arbitrary uploaded CSV, with a few
    sample values so a user can tell what it actually contains before
    mapping it to a QTestHub field."""

    name: str
    sample_values: list[str]


class ColumnDetectionResult(BaseModel):
    columns: list[DetectedColumn]
    # Best-effort suggested mapping (target field -> detected source column
    # name), pre-filled from a preset if one was requested and matched;
    # the user confirms/adjusts this before import, never auto-applied.
    suggested_mapping: dict[str, str]
    target_fields: list[str]
    required_fields: list[str]


class ImportRowResult(BaseModel):
    row_number: int
    status: str  # "created" | "error"
    test_case_id: UUID | None = None
    errors: list[str] = []


class ImportReport(BaseModel):
    total_rows: int
    created_count: int
    error_count: int
    # Only error rows are itemized here (the BRD's "line-by-line validation
    # errors" acceptance criterion is about failures, not successes); a
    # successful row's outcome is already captured by created_count, and
    # omitting thousands of empty-errors entries keeps large-batch responses
    # small.
    rows: list[ImportRowResult]
