from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import set_tenant_context
from app.data.insurance_templates import get_templates_by_ids, list_templates
from app.models.test_module import TestModule
from app.schemas.template import TemplateImportResultOut, TemplateOut
from app.schemas.test_case import StepIn, TestCaseCreateRequest
from app.schemas.test_module import TestModuleCreateRequest
from app.services import test_case_service, test_module_service


def list_available_templates() -> list[TemplateOut]:
    return [
        TemplateOut(
            id=t.id,
            category=t.category,
            title=t.title,
            description=t.description,
            priority=t.priority,
        )
        for t in list_templates()
    ]


def _get_or_create_module(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    category: str,
) -> TestModule:
    set_tenant_context(db, str(tenant_id))
    existing = db.execute(
        select(TestModule).where(
            TestModule.tenant_id == tenant_id,
            TestModule.project_id == project_id,
            TestModule.parent_id.is_(None),
            TestModule.name == category,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    # test_module_service.create_module commits its own transaction, which
    # resets the transaction-local RLS GUC (ADR-007) -- re-assert it before
    # the read that follows.
    out = test_module_service.create_module(
        db, tenant_id, role_code, actor_user_id, project_id, TestModuleCreateRequest(name=category)
    )
    set_tenant_context(db, str(tenant_id))
    return db.execute(select(TestModule).where(TestModule.id == out.id)).scalar_one()


def import_templates(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    template_ids: list[str],
) -> TemplateImportResultOut:
    """Tier 5 / PV-10.1 (Insurance QA Pack). Each import creates fresh
    TestCase rows -- deliberately not idempotent/tracked against a prior
    import, so re-importing the same templates produces a second, separate
    copy rather than being silently skipped. Simpler than inventing an
    import-tracking table for a feature whose whole purpose is handing the
    tenant a starting point they're expected to then edit freely."""
    templates = get_templates_by_ids(template_ids)

    modules_created: list[str] = []
    module_by_category: dict[str, TestModule] = {}
    for category in {t.category for t in templates}:
        set_tenant_context(db, str(tenant_id))
        existing_before = db.execute(
            select(TestModule.id).where(
                TestModule.tenant_id == tenant_id,
                TestModule.project_id == project_id,
                TestModule.parent_id.is_(None),
                TestModule.name == category,
            )
        ).scalar_one_or_none()
        module = _get_or_create_module(
            db, tenant_id, role_code, actor_user_id, project_id, category
        )
        module_by_category[category] = module
        if existing_before is None:
            modules_created.append(category)

    imported_ids: list[UUID] = []
    for template in templates:
        # test_case_service.create_test_case commits its own transaction --
        # re-assert tenant context (ADR-007) before every RLS-protected call
        # in this loop, since each of these also commits internally.
        set_tenant_context(db, str(tenant_id))
        case = test_case_service.create_test_case(
            db,
            tenant_id,
            role_code,
            actor_user_id,
            project_id,
            TestCaseCreateRequest(
                title=template.title,
                description=template.description,
                priority=template.priority,
                steps=[StepIn(action=a, expected=e) for a, e in template.steps],
            ),
        )
        set_tenant_context(db, str(tenant_id))
        test_module_service.assign_test_case(
            db,
            tenant_id,
            role_code,
            actor_user_id,
            case.id,
            module_by_category[template.category].id,
        )
        imported_ids.append(case.id)

    return TemplateImportResultOut(
        imported_test_case_ids=imported_ids, modules_created=modules_created
    )
