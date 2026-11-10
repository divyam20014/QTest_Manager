from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.ai.base import AIProviderError, ChangeImpactCandidate, ReviewStep
from app.core.ai.registry import get_provider
from app.core.audit import record_audit_event
from app.core.crypto import decrypt_secret
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, NotFoundError
from app.models.ai_usage import AIUsageLog
from app.models.tenant import Tenant
from app.models.test_case import TestCase
from app.schemas.ai import (
    AIUsageSummaryOut,
    AnalyzeRequirementChangeResponse,
    ChangeImpactFindingOut,
    GenerateTestCasesResponse,
    ReviewSuggestionOut,
    ReviewTestCaseResponse,
)
from app.schemas.test_case import StepIn, TestCaseCreateRequest
from app.services import plan_limits, requirement_service, test_case_service


def _get_tenant(db: Session, tenant_id: UUID) -> Tenant:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("Tenant not found")
    return tenant


def _record_usage(
    db: Session,
    tenant_id: UUID,
    user_id: UUID,
    provider: str,
    action: str,
    requirement_id: UUID | None,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    *,
    success: bool,
) -> None:
    set_tenant_context(db, str(tenant_id))
    db.add(
        AIUsageLog(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider,
            action=action,
            requirement_id=requirement_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            success=success,
        )
    )
    db.flush()


def _require_ai_enabled(tenant: Tenant) -> None:
    if not tenant.ai_enabled or tenant.ai_api_key_encrypted is None:
        raise ConflictError("AI is not enabled for this tenant")


def generate_test_cases_for_requirement(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    max_cases: int,
) -> GenerateTestCasesResponse:
    requirement = requirement_service.get_requirement(
        db, tenant_id, role_code, actor_user_id, requirement_id
    )

    tenant = _get_tenant(db, tenant_id)
    _require_ai_enabled(tenant)
    plan_limits.enforce_ai_quota(db, tenant_id)
    assert tenant.ai_api_key_encrypted is not None

    requirement_description = requirement_service.to_out(db, requirement).description
    api_key = decrypt_secret(tenant.ai_api_key_encrypted)
    provider = get_provider(tenant.ai_provider)

    try:
        result = provider.generate_test_cases(
            api_key=api_key,
            requirement_title=requirement.title,
            requirement_description=requirement_description,
            max_cases=max_cases,
        )
    except AIProviderError as exc:
        _record_usage(
            db,
            tenant_id,
            actor_user_id,
            tenant.ai_provider,
            "generate_test_cases",
            requirement_id,
            0,
            0,
            0,
            success=False,
        )
        db.commit()
        raise ConflictError(f"AI provider request failed: {exc}") from exc

    created_cases: list[TestCase] = []
    for draft in result.test_cases:
        if len(draft.title) < 5 or not draft.steps:
            continue
        set_tenant_context(db, str(tenant_id))
        case = test_case_service.create_test_case(
            db,
            tenant_id,
            role_code,
            actor_user_id,
            requirement.project_id,
            TestCaseCreateRequest(
                title=draft.title,
                description=draft.description,
                priority="Medium",
                steps=[StepIn(action=s.action, expected=s.expected) for s in draft.steps],
            ),
        )
        set_tenant_context(db, str(tenant_id))
        requirement_service.link_test_case(
            db, tenant_id, role_code, actor_user_id, requirement_id, case.id
        )
        created_cases.append(case)

    _record_usage(
        db,
        tenant_id,
        actor_user_id,
        tenant.ai_provider,
        "generate_test_cases",
        requirement_id,
        result.prompt_tokens,
        result.completion_tokens,
        result.total_tokens,
        success=True,
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="ai.test_cases_generated",
        entity_type="requirement",
        entity_id=requirement_id,
        metadata={
            "count": len(created_cases),
            "provider": tenant.ai_provider,
            "total_tokens": result.total_tokens,
        },
    )
    db.commit()

    return GenerateTestCasesResponse(
        items=[test_case_service.to_out(db, c) for c in created_cases],
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
    )


def review_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
) -> ReviewTestCaseResponse:
    """Phase 4 (ADR-046): read-only quality review -- never mutates the test
    case itself (no-auto-mutation invariant), only returns suggestions a
    human applies manually. Uses the same view-level access as GET
    /test-cases/{id}, not the create/edit permission, since this doesn't
    change anything."""
    case = test_case_service.get_test_case(db, tenant_id, role_code, actor_user_id, test_case_id)
    case_out = test_case_service.to_out(db, case)

    tenant = _get_tenant(db, tenant_id)
    _require_ai_enabled(tenant)
    plan_limits.enforce_ai_quota(db, tenant_id)
    assert tenant.ai_api_key_encrypted is not None

    api_key = decrypt_secret(tenant.ai_api_key_encrypted)
    provider = get_provider(tenant.ai_provider)

    try:
        result = provider.review_test_case(
            api_key=api_key,
            title=case_out.title,
            description=case_out.description,
            steps=[ReviewStep(action=s.action, expected=s.expected) for s in case_out.steps],
        )
    except AIProviderError as exc:
        _record_usage(
            db, tenant_id, actor_user_id, tenant.ai_provider, "review_test_case", None, 0, 0, 0,
            success=False,
        )
        db.commit()
        raise ConflictError(f"AI provider request failed: {exc}") from exc

    _record_usage(
        db,
        tenant_id,
        actor_user_id,
        tenant.ai_provider,
        "review_test_case",
        None,
        result.prompt_tokens,
        result.completion_tokens,
        result.total_tokens,
        success=True,
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="ai.test_case_reviewed",
        entity_type="test_case",
        entity_id=test_case_id,
        metadata={
            "suggestion_count": len(result.suggestions),
            "provider": tenant.ai_provider,
            "total_tokens": result.total_tokens,
        },
    )
    db.commit()

    return ReviewTestCaseResponse(
        suggestions=[
            ReviewSuggestionOut(category=s.category, message=s.message) for s in result.suggestions
        ],
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
    )


def analyze_requirement_change(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
) -> AnalyzeRequirementChangeResponse:
    """Phase 5 (ADR-047): compares the requirement's current version against
    its immediately-prior version and suggests which of its linked test
    cases may need re-review. Strictly suggestion-only (no-auto-mutation
    invariant) -- never flags/edits a test case or the requirement itself,
    same discipline as Phase 4's reviewer. Uses the same view-level access
    as GET /requirements/{id}, not requirement.manage."""
    requirement = requirement_service.get_requirement(
        db, tenant_id, role_code, actor_user_id, requirement_id
    )

    tenant = _get_tenant(db, tenant_id)
    _require_ai_enabled(tenant)
    plan_limits.enforce_ai_quota(db, tenant_id)
    assert tenant.ai_api_key_encrypted is not None

    versions = requirement_service.list_versions(
        db, tenant_id, role_code, actor_user_id, requirement_id
    )
    if len(versions) < 2:
        raise ConflictError("Requirement has no prior version to compare against")
    new_version, old_version = versions[0], versions[1]

    detail = requirement_service.to_detail_out(db, requirement)
    linked = detail.linked_test_cases

    if not linked:
        # Nothing to assess -- no provider call made, so nothing to meter.
        return AnalyzeRequirementChangeResponse(
            old_version_number=old_version.version_number,
            new_version_number=new_version.version_number,
            findings=[],
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
        )

    candidates = [
        ChangeImpactCandidate(index=i, title=lt.test_case_title)
        for i, lt in enumerate(linked, start=1)
    ]
    api_key = decrypt_secret(tenant.ai_api_key_encrypted)
    provider = get_provider(tenant.ai_provider)

    try:
        result = provider.analyze_requirement_change(
            api_key=api_key,
            old_title=old_version.title,
            old_description=old_version.description,
            new_title=new_version.title,
            new_description=new_version.description,
            candidates=candidates,
        )
    except AIProviderError as exc:
        _record_usage(
            db,
            tenant_id,
            actor_user_id,
            tenant.ai_provider,
            "analyze_requirement_change",
            requirement_id,
            0,
            0,
            0,
            success=False,
        )
        db.commit()
        raise ConflictError(f"AI provider request failed: {exc}") from exc

    by_index = {f.index: f for f in result.findings}
    findings_out = [
        ChangeImpactFindingOut(
            test_case_id=lt.test_case_id,
            test_case_title=lt.test_case_title,
            needs_review=by_index[i].needs_review if i in by_index else False,
            reason=by_index[i].reason if i in by_index else "No assessment returned.",
        )
        for i, lt in enumerate(linked, start=1)
    ]

    _record_usage(
        db,
        tenant_id,
        actor_user_id,
        tenant.ai_provider,
        "analyze_requirement_change",
        requirement_id,
        result.prompt_tokens,
        result.completion_tokens,
        result.total_tokens,
        success=True,
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="ai.requirement_change_analyzed",
        entity_type="requirement",
        entity_id=requirement_id,
        metadata={
            "old_version": old_version.version_number,
            "new_version": new_version.version_number,
            "flagged_count": sum(1 for f in findings_out if f.needs_review),
            "provider": tenant.ai_provider,
        },
    )
    db.commit()

    return AnalyzeRequirementChangeResponse(
        old_version_number=old_version.version_number,
        new_version_number=new_version.version_number,
        findings=findings_out,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
    )


def get_usage_summary(db: Session, tenant_id: UUID) -> AIUsageSummaryOut:
    set_tenant_context(db, str(tenant_id))
    row = db.execute(
        select(
            func.count(AIUsageLog.id),
            func.count(AIUsageLog.id).filter(AIUsageLog.success.is_(True)),
            func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
        ).where(AIUsageLog.tenant_id == tenant_id)
    ).one()
    return AIUsageSummaryOut(
        total_requests=row[0],
        successful_requests=row[1],
        total_prompt_tokens=row[2],
        total_completion_tokens=row[3],
        total_tokens=row[4],
    )
