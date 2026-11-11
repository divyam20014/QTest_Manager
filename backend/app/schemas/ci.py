from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Normalized result-ingestion contract (ADR-059): a CI job maps whatever
# report format it natively produces (JUnit XML, a GitHub Actions summary,
# a GitLab CI test report) into this shape before POSTing -- this app
# doesn't try to parse every CI vendor's native format itself, matching
# how real-world webhook integrations are typically built (a thin
# adapter script in the CI pipeline, not a parser for every tool in this
# codebase).
_VALID_STATUSES = {"passed", "failed", "skipped"}


class CiTestResult(BaseModel):
    test_run_case_id: UUID
    status: str
    message: str | None = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def _status_in_taxonomy(cls, v: str) -> str:
        if v not in _VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(_VALID_STATUSES)}")
        return v


class CiWebhookRequest(BaseModel):
    results: list[CiTestResult] = Field(min_length=1, max_length=500)


class CiResultOutcome(BaseModel):
    test_run_case_id: UUID
    accepted: bool
    detail: str | None = None


class CiWebhookResponse(BaseModel):
    accepted_count: int
    rejected_count: int
    outcomes: list[CiResultOutcome]
