from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.models.execution import TestRun
from app.models.project import Project
from app.models.test_case import TestCase
from app.models.test_suite import TestSuite, TestSuiteCase
from app.schemas.execution import TestRunCreateRequest
from app.schemas.test_suite import (
    CreateRunFromSuiteRequest,
    TestSuiteCaseSetRequest,
    TestSuiteCreateRequest,
    TestSuiteOut,
    TestSuiteUpdateRequest,
)
from app.services import execution_service
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


def _get_suite_or_404(db: Session, tenant_id: UUID, suite_id: UUID) -> TestSuite:
    suite = db.execute(
        select(TestSuite).where(TestSuite.tenant_id == tenant_id, TestSuite.id == suite_id)
    ).scalar_one_or_none()
    if suite is None:
        raise NotFoundError("Test suite not found")
    return suite


def _to_out(db: Session, suite: TestSuite) -> TestSuiteOut:
    case_ids = list(
        db.execute(
            select(TestSuiteCase.test_case_id).where(TestSuiteCase.test_suite_id == suite.id)
        ).scalars()
    )
    return TestSuiteOut(
        id=suite.id, project_id=suite.project_id, name=suite.name, description=suite.description,
        created_at=suite.created_at, test_case_ids=case_ids,
    )


def _validate_case_ids(
    db: Session, tenant_id: UUID, project_id: UUID, case_ids: list[UUID]
) -> None:
    found = set(
        db.execute(
            select(TestCase.id).where(
                TestCase.tenant_id == tenant_id, TestCase.project_id == project_id,
                TestCase.id.in_(case_ids),
            )
        ).scalars()
    )
    missing = set(case_ids) - found
    if missing:
        missing_str = ', '.join(str(m) for m in missing)
        raise ValidationAppError(f"Unknown test case id(s) for this project: {missing_str}")


def list_suites(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> list[TestSuiteOut]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)
    rows = db.execute(
        select(TestSuite)
        .where(TestSuite.tenant_id == tenant_id, TestSuite.project_id == project_id)
        .order_by(TestSuite.name)
    ).scalars()
    return [_to_out(db, s) for s in rows]


def create_suite(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, project_id: UUID,
    req: TestSuiteCreateRequest,
) -> TestSuiteOut:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    _validate_case_ids(db, tenant_id, project_id, req.test_case_ids)

    suite = TestSuite(
        tenant_id=tenant_id, project_id=project_id, name=req.name, description=req.description,
    )
    db.add(suite)
    db.flush()
    for case_id in req.test_case_ids:
        db.add(TestSuiteCase(tenant_id=tenant_id, test_suite_id=suite.id, test_case_id=case_id))

    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_suite.created",
        entity_type="test_suite", entity_id=suite.id,
        metadata={"name": req.name, "case_count": len(req.test_case_ids)},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, suite)


def update_suite(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, suite_id: UUID,
    req: TestSuiteUpdateRequest,
) -> TestSuiteOut:
    suite = _get_suite_or_404(db, tenant_id, suite_id)
    project = _get_project_or_404(db, tenant_id, suite.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if req.name is not None:
        suite.name = req.name
    if "description" in req.model_fields_set:
        suite.description = req.description

    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_suite.updated",
        entity_type="test_suite", entity_id=suite.id,
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, suite)


def set_suite_cases(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, suite_id: UUID,
    req: TestSuiteCaseSetRequest,
) -> TestSuiteOut:
    suite = _get_suite_or_404(db, tenant_id, suite_id)
    project = _get_project_or_404(db, tenant_id, suite.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    _validate_case_ids(db, tenant_id, suite.project_id, req.test_case_ids)

    db.query(TestSuiteCase).filter(TestSuiteCase.test_suite_id == suite.id).delete()
    for case_id in req.test_case_ids:
        db.add(TestSuiteCase(tenant_id=tenant_id, test_suite_id=suite.id, test_case_id=case_id))

    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_suite.cases_set",
        entity_type="test_suite", entity_id=suite.id,
        metadata={"case_count": len(req.test_case_ids)},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, suite)


def delete_suite(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, suite_id: UUID
) -> None:
    suite = _get_suite_or_404(db, tenant_id, suite_id)
    project = _get_project_or_404(db, tenant_id, suite.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    db.query(TestSuiteCase).filter(TestSuiteCase.test_suite_id == suite.id).delete()
    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_suite.deleted",
        entity_type="test_suite", entity_id=suite.id,
    )
    db.delete(suite)
    db.commit()


def create_run_from_suite(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, suite_id: UUID,
    req: CreateRunFromSuiteRequest,
) -> TestRun:
    """Reuses execution_service.create_test_run's existing bundling/
    approved-only/audit logic unchanged -- a Suite is just a saved
    selection of case ids fed into the same proven path."""
    suite = _get_suite_or_404(db, tenant_id, suite_id)
    case_ids = list(
        db.execute(
            select(TestSuiteCase.test_case_id).where(TestSuiteCase.test_suite_id == suite.id)
        ).scalars()
    )
    if not case_ids:
        raise ValidationAppError("This suite has no test cases to run")

    run_req = TestRunCreateRequest(name=req.name, run_type=req.run_type, test_case_ids=case_ids)
    run = execution_service.create_test_run(
        db, tenant_id, role_code, actor_user_id, suite.project_id, run_req
    )
    # create_test_run already committed internally -- the transaction-local
    # app.current_tenant GUC resets on every commit, so it must be
    # re-asserted before this function's own RLS-protected writes below
    # (this codebase's recurring bug class, e.g. ADR-...'s fixes elsewhere).
    set_tenant_context(db, str(tenant_id))
    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_suite.run_created",
        entity_type="test_suite", entity_id=suite.id, metadata={"test_run_id": str(run.id)},
    )
    db.commit()
    return run
