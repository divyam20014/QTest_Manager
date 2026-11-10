from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.test_case import TestCaseOut


class GenerateTestCasesRequest(BaseModel):
    max_cases: int = Field(default=3, ge=1, le=5)


class GenerateTestCasesResponse(BaseModel):
    items: list[TestCaseOut]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ReviewSuggestionOut(BaseModel):
    category: str
    message: str


class ReviewTestCaseResponse(BaseModel):
    suggestions: list[ReviewSuggestionOut]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChangeImpactFindingOut(BaseModel):
    test_case_id: UUID
    test_case_title: str
    needs_review: bool
    reason: str


class AnalyzeRequirementChangeResponse(BaseModel):
    old_version_number: int
    new_version_number: int
    findings: list[ChangeImpactFindingOut]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class AIUsageSummaryOut(BaseModel):
    total_requests: int
    successful_requests: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int


class AIUsageLogOut(BaseModel):
    id: UUID
    user_id: UUID
    action: str
    requirement_id: UUID | None
    total_tokens: int
    success: bool
    created_at: datetime
