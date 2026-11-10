from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.models.project import Project
from app.models.test_case import TestCase
from app.models.test_module import TestModule
from app.schemas.test_module import TestModuleCreateRequest, TestModuleOut, TestModuleUpdateRequest
from app.services.project_service import is_assigned


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _get_module_or_404(db: Session, tenant_id: UUID, module_id: UUID) -> TestModule:
    module = db.execute(
        select(TestModule).where(TestModule.tenant_id == tenant_id, TestModule.id == module_id)
    ).scalar_one_or_none()
    if module is None:
        raise NotFoundError("Module not found")
    return module


def _to_out(db: Session, module: TestModule) -> TestModuleOut:
    set_tenant_context(db, str(module.tenant_id))
    count = db.execute(
        select(func.count()).select_from(TestCase).where(TestCase.module_id == module.id)
    ).scalar_one()
    return TestModuleOut(
        id=module.id,
        project_id=module.project_id,
        parent_id=module.parent_id,
        name=module.name,
        test_case_count=count,
        created_at=module.created_at,
    )


def list_modules(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> list[TestModuleOut]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)
    rows = db.execute(
        select(TestModule)
        .where(TestModule.tenant_id == tenant_id, TestModule.project_id == project_id)
        .order_by(TestModule.name)
    ).scalars()
    return [_to_out(db, m) for m in rows]


def _validate_parent(
    db: Session, tenant_id: UUID, project_id: UUID, parent_id: UUID | None, self_id: UUID | None
) -> None:
    if parent_id is None:
        return
    if parent_id == self_id:
        raise ConflictError("A module cannot be its own parent")
    parent = db.execute(
        select(TestModule).where(
            TestModule.tenant_id == tenant_id,
            TestModule.id == parent_id,
            TestModule.project_id == project_id,
        )
    ).scalar_one_or_none()
    if parent is None:
        raise NotFoundError("Parent module not found")


def create_module(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: TestModuleCreateRequest,
) -> TestModuleOut:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    _validate_parent(db, tenant_id, project_id, req.parent_id, None)

    module = TestModule(
        tenant_id=tenant_id, project_id=project_id, parent_id=req.parent_id, name=req.name
    )
    db.add(module)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="test_module.created",
        entity_type="test_module",
        entity_id=module.id,
        metadata={"name": req.name, "project_id": str(project_id)},
    )
    db.commit()
    return _to_out(db, module)


def update_module(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    module_id: UUID,
    req: TestModuleUpdateRequest,
) -> TestModuleOut:
    module = _get_module_or_404(db, tenant_id, module_id)
    project = _get_project_or_404(db, tenant_id, module.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if req.parent_id is not None or "parent_id" in req.model_fields_set:
        _validate_parent(db, tenant_id, module.project_id, req.parent_id, module.id)
        module.parent_id = req.parent_id
    if req.name is not None:
        module.name = req.name

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="test_module.updated",
        entity_type="test_module",
        entity_id=module.id,
    )
    db.commit()
    return _to_out(db, module)


def delete_module(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, module_id: UUID
) -> None:
    """Reassigns child modules and test cases to this module's own parent
    (never cascade-deletes test cases)."""
    module = _get_module_or_404(db, tenant_id, module_id)
    project = _get_project_or_404(db, tenant_id, module.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    db.execute(
        update(TestModule)
        .where(TestModule.tenant_id == tenant_id, TestModule.parent_id == module_id)
        .values(parent_id=module.parent_id)
    )
    db.execute(
        update(TestCase)
        .where(TestCase.tenant_id == tenant_id, TestCase.module_id == module_id)
        .values(module_id=module.parent_id)
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="test_module.deleted",
        entity_type="test_module",
        entity_id=module.id,
    )
    db.delete(module)
    db.commit()


def assign_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    module_id: UUID | None,
) -> None:
    case = db.execute(
        select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    ).scalar_one_or_none()
    if case is None:
        raise NotFoundError("Test case not found")
    project = _get_project_or_404(db, tenant_id, case.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if module_id is not None:
        module = _get_module_or_404(db, tenant_id, module_id)
        if module.project_id != case.project_id:
            raise ConflictError("Module belongs to a different project")

    case.module_id = module_id
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.module_assigned",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"module_id": str(module_id) if module_id else None},
    )
    db.commit()


def bulk_assign_test_cases(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_ids: list[UUID],
    module_id: UUID | None,
) -> int:
    """Gap-closure pass (ADR-057): a bulk-move for the module-assignment
    action that was previously one-test-case-at-a-time only. Each row
    gets the same existing validation `assign_test_case` applies (project
    access, same-project module check) so this isn't a weaker bulk path --
    just one commit instead of N. Returns the count actually reassigned."""
    target_module: TestModule | None = None
    if module_id is not None:
        target_module = _get_module_or_404(db, tenant_id, module_id)

    reassigned = 0
    for test_case_id in test_case_ids:
        case = db.execute(
            select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
        ).scalar_one_or_none()
        if case is None:
            raise NotFoundError(f"Test case not found: {test_case_id}")
        project = _get_project_or_404(db, tenant_id, case.project_id)
        _require_project_access(db, project, role_code, actor_user_id)
        if target_module is not None and target_module.project_id != case.project_id:
            raise ConflictError(
                f"Module belongs to a different project than test case {test_case_id}"
            )
        case.module_id = module_id
        reassigned += 1

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.module_bulk_assigned",
        entity_type="test_case",
        entity_id=module_id or test_case_ids[0],
        metadata={
            "module_id": str(module_id) if module_id else None,
            "test_case_ids": [str(i) for i in test_case_ids],
            "count": reassigned,
        },
    )
    db.commit()
    return reassigned
