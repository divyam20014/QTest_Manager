from uuid import UUID

from pydantic import BaseModel


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
