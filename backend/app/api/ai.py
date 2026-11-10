from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.config import get_settings
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.ai import GenerateTestCasesRequest
from app.services import ai_service

router = APIRouter(tags=["ai"])


@router.post("/requirements/{requirement_id}/generate-test-cases")
def generate_test_cases(
    requirement_id: UUID,
    req: GenerateTestCasesRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    max_cases = min(req.max_cases, get_settings().ai_max_cases_per_request)
    result = ai_service.generate_test_cases_for_requirement(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id, max_cases
    )
    return envelope(result.model_dump(mode="json"))


@router.post("/test-cases/{test_case_id}/ai-review")
def review_test_case(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    result = ai_service.review_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope(result.model_dump(mode="json"))


@router.post("/requirements/{requirement_id}/analyze-change")
def analyze_requirement_change(
    requirement_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    result = ai_service.analyze_requirement_change(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, requirement_id
    )
    return envelope(result.model_dump(mode="json"))


@router.get("/ai/usage")
def get_ai_usage(
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    summary = ai_service.get_usage_summary(db, ctx.tenant_id)
    return envelope(summary.model_dump(mode="json"))
