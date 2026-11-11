import re
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.ai.base import AIProviderError, ChangeImpactCandidate, ReviewStep
from app.core.ai.registry import get_provider
from app.core.audit import record_audit_event
from app.core.crypto import decrypt_secret
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, NotFoundError
from app.models.ai_usage import AIUsageLog
from app.models.defect import Defect
from app.models.requirement import Requirement
from app.models.tenant import Tenant
from app.models.test_case import TestCase
from app.schemas.ai import (
    AIUsageSummaryOut,
    AnalyzeRequirementChangeResponse,
    AssistantQueryResponse,
    ChangeImpactFindingOut,
    GenerateTestCasesResponse,
    ReviewSuggestionOut,
    ReviewTestCaseResponse,
    RootCauseSuggestionOut,
)
from app.schemas.test_case import StepIn, TestCaseCreateRequest
from app.services import plan_limits, project_service, requirement_service, test_case_service

_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "what", "which", "who",
    "how", "many", "much", "for", "of", "in", "on", "to", "do", "does",
    "did", "i", "my", "our", "show", "me", "and", "or", "about", "with",
    "list", "all", "any", "there", "have", "has", "can", "you",
}
_ROOT_CAUSE_TAXONOMY = [
    "requirements_gap",
    "code_defect",
    "design_flaw",
    "test_data_issue",
    "environment_issue",
    "third_party_integration",
    "other",
]
_MAX_CONTEXT_CHARS = 4000
_MAX_PROJECTS_SCANNED = 10
_MAX_ITEMS_PER_KIND = 10


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


# -- AI QA Assistant (ADR-060) -- conversational Q&A over tenant data ----
#
# First-version retrieval: simple keyword/ILIKE matching, scoped to the
# caller's own visible projects (reusing project_service.list_projects,
# which already applies the exact same tester-assignment visibility rule
# every other page in this app uses) -- not a vector-embedding RAG
# pipeline. A future version wanting better recall on paraphrased
# questions would need real embeddings + a vector index; deliberately not
# built here, see ADR-060 for the explicit scoping rationale.


def _extract_keywords(question: str) -> list[str]:
    words = re.findall(r"[a-zA-Z0-9]+", question.lower())
    keywords = [w for w in words if len(w) > 2 and w not in _STOPWORDS]
    # Longest-first: more specific terms are more useful as ILIKE anchors
    # than short, generic ones when only a handful can be used.
    return sorted(set(keywords), key=len, reverse=True)[:5]


def _build_assistant_context(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, question: str
) -> str:
    set_tenant_context(db, str(tenant_id))
    projects, _ = project_service.list_projects(
        db, tenant_id, role_code, user_id, page=1, page_size=_MAX_PROJECTS_SCANNED
    )
    project_ids = [p.id for p in projects]
    project_names = {p.id: p.name for p in projects}
    if not project_ids:
        return ""

    keywords = _extract_keywords(question)
    lines: list[str] = []

    if "coverage" in question.lower():
        for project in projects[:_MAX_PROJECTS_SCANNED]:
            report = requirement_service.get_coverage_report(
                db, tenant_id, role_code, user_id, project.id
            )
            lines.append(
                f"Project '{project.name}': requirement coverage "
                f"{report.covered_requirements}/{report.total_requirements} "
                f"({report.coverage_percentage:.0f}%)"
            )

    if keywords:
        ilike_clauses_tc = [TestCase.title.ilike(f"%{kw}%") for kw in keywords]
        cases = db.execute(
            select(TestCase)
            .where(TestCase.tenant_id == tenant_id, TestCase.project_id.in_(project_ids))
            .where(or_(*ilike_clauses_tc))
            .limit(_MAX_ITEMS_PER_KIND)
        ).scalars()
        for c in cases:
            lines.append(
                f"Test case '{c.title}' (project '{project_names.get(c.project_id, '?')}'): "
                f"status={c.status}, priority={c.priority}"
            )

        ilike_clauses_req = [Requirement.title.ilike(f"%{kw}%") for kw in keywords]
        reqs = db.execute(
            select(Requirement)
            .where(Requirement.tenant_id == tenant_id, Requirement.project_id.in_(project_ids))
            .where(or_(*ilike_clauses_req))
            .limit(_MAX_ITEMS_PER_KIND)
        ).scalars()
        for r in reqs:
            proj_name = project_names.get(r.project_id, "?")
            lines.append(f"Requirement '{r.title}' (project '{proj_name}')")

        ilike_clauses_defect = [Defect.title.ilike(f"%{kw}%") for kw in keywords]
        defects = db.execute(
            select(Defect)
            .where(Defect.tenant_id == tenant_id, Defect.project_id.in_(project_ids))
            .where(or_(*ilike_clauses_defect))
            .limit(_MAX_ITEMS_PER_KIND)
        ).scalars()
        for d in defects:
            lines.append(
                f"Defect '{d.title}' (project '{project_names.get(d.project_id, '?')}'): "
                f"status={d.status}, severity={d.severity}"
            )

    context = "\n".join(lines)
    return context[:_MAX_CONTEXT_CHARS]


def answer_assistant_question(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    question: str,
) -> AssistantQueryResponse:
    tenant = _get_tenant(db, tenant_id)
    _require_ai_enabled(tenant)
    plan_limits.enforce_ai_quota(db, tenant_id)
    assert tenant.ai_api_key_encrypted is not None

    context = _build_assistant_context(db, tenant_id, role_code, actor_user_id, question)
    api_key = decrypt_secret(tenant.ai_api_key_encrypted)
    provider = get_provider(tenant.ai_provider)

    try:
        result = provider.answer_question(api_key=api_key, question=question, context=context)
    except AIProviderError as exc:
        _record_usage(
            db, tenant_id, actor_user_id, tenant.ai_provider, "assistant_query", None, 0, 0, 0,
            success=False,
        )
        db.commit()
        raise ConflictError(f"AI provider request failed: {exc}") from exc

    _record_usage(
        db,
        tenant_id,
        actor_user_id,
        tenant.ai_provider,
        "assistant_query",
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
        action="ai.assistant_queried",
        entity_type="user",
        entity_id=actor_user_id,
        metadata={"provider": tenant.ai_provider, "total_tokens": result.total_tokens},
    )
    db.commit()

    return AssistantQueryResponse(
        answer=result.answer,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
    )


# -- AI Defect Assistant (ADR-060) -- root-cause/fix suggestions ---------
#
# Strictly suggestion-only, same no-auto-mutation invariant as Phase 4's
# AI Test Case Reviewer: this NEVER sets Defect.root_cause itself. A human
# applies the suggestion manually via the existing, unchanged
# PATCH /defects/{id}/root-cause endpoint if they agree with it.


def suggest_defect_root_cause(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect: Defect,
) -> RootCauseSuggestionOut:
    tenant = _get_tenant(db, tenant_id)
    _require_ai_enabled(tenant)
    plan_limits.enforce_ai_quota(db, tenant_id)
    assert tenant.ai_api_key_encrypted is not None

    api_key = decrypt_secret(tenant.ai_api_key_encrypted)
    provider = get_provider(tenant.ai_provider)

    try:
        result = provider.suggest_defect_root_cause(
            api_key=api_key,
            title=defect.title,
            description=defect.description or "",
            actual_result=defect.actual_result,
            expected_result=defect.expected_result,
            environment=defect.environment,
            severity=defect.severity,
            taxonomy=_ROOT_CAUSE_TAXONOMY,
        )
    except AIProviderError as exc:
        _record_usage(
            db, tenant_id, actor_user_id, tenant.ai_provider, "defect_root_cause_suggested",
            None, 0, 0, 0, success=False,
        )
        db.commit()
        raise ConflictError(f"AI provider request failed: {exc}") from exc

    # Never trust the model's category choice blindly -- it must be a
    # value the rest of the app's fixed taxonomy actually recognizes.
    category = result.category if result.category in _ROOT_CAUSE_TAXONOMY else "other"

    _record_usage(
        db,
        tenant_id,
        actor_user_id,
        tenant.ai_provider,
        "defect_root_cause_suggested",
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
        action="ai.defect_root_cause_suggested",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "suggested_category": category,
            "provider": tenant.ai_provider,
            "total_tokens": result.total_tokens,
        },
    )
    db.commit()

    return RootCauseSuggestionOut(
        category=category,
        reasoning=result.reasoning,
        next_steps=result.next_steps,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        total_tokens=result.total_tokens,
    )
