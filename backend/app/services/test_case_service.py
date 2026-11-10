from typing import cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.models.defect import Defect
from app.models.execution import TestRunCase
from app.models.identity import User
from app.models.project import Project
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.schemas.test_case import (
    Priority,
    StepDiff,
    StepIn,
    StepOut,
    TestCaseCreateRequest,
    TestCaseOut,
    TestCaseStatus,
    TestCaseUpdateRequest,
    TestCaseVersionOut,
    VersionCompareOut,
)
from app.services import notification_service
from app.services.project_service import is_assigned

SORTABLE_FIELDS = {
    "title": TestCase.title,
    "created_at": TestCase.created_at,
    "priority": TestCase.priority,
    "status": TestCase.status,
}
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    """ADR-019: tenant-wide for Admin/Manager; Tester must be assigned."""
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _steps_for_version(db: Session, version_id: UUID) -> list[StepOut]:
    rows = db.execute(
        select(TestCaseVersionStep)
        .where(TestCaseVersionStep.test_case_version_id == version_id)
        .order_by(TestCaseVersionStep.step_number)
    ).scalars()
    return [StepOut(step_number=r.step_number, action=r.action, expected=r.expected) for r in rows]


def _get_test_case_or_404(db: Session, tenant_id: UUID, test_case_id: UUID) -> TestCase:
    case = db.execute(
        select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    ).scalar_one_or_none()
    if case is None:
        raise NotFoundError("Test case not found")
    return case


def _get_current_version(db: Session, case: TestCase) -> TestCaseVersion:
    version = db.execute(
        select(TestCaseVersion).where(TestCaseVersion.id == case.current_version_id)
    ).scalar_one()
    return version


def _authorize_case_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, case: TestCase
) -> None:
    project = _get_project_or_404(db, tenant_id, case.project_id)
    _require_project_access(db, project, role_code, user_id)


def to_out(db: Session, case: TestCase) -> TestCaseOut:
    # Callers may invoke this right after a service function committed
    # (ending the transaction that held app.current_tenant); re-assert it
    # from the already-loaded object before issuing further RLS-protected
    # queries (test_case_versions/test_case_version_steps both have RLS).
    set_tenant_context(db, str(case.tenant_id))
    version = _get_current_version(db, case)
    return TestCaseOut(
        id=case.id,
        project_id=case.project_id,
        title=case.title,
        description=version.description,
        priority=cast(Priority, case.priority),
        status=cast(TestCaseStatus, case.status),
        assignee_id=case.assignee_id,
        version_number=version.version_number,
        created_by=case.created_by,
        created_at=case.created_at,
        steps=_steps_for_version(db, version.id),
    )


def list_test_cases(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    *,
    search: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    assignee_id: UUID | None = None,
    sort: str = "created_at",
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[TestCase], int]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)

    query = select(TestCase).where(
        TestCase.tenant_id == tenant_id, TestCase.project_id == project_id
    )
    if search:
        query = query.where(TestCase.title.ilike(f"%{search}%"))
    if priority:
        query = query.where(TestCase.priority == priority)
    if status:
        query = query.where(TestCase.status == status)
    if assignee_id:
        query = query.where(TestCase.assignee_id == assignee_id)

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()

    sort_key = sort.lstrip("-")
    sort_field = SORTABLE_FIELDS.get(sort_key, TestCase.created_at)
    order_clause = sort_field.desc() if sort.startswith("-") else sort_field.asc()
    query = query.order_by(order_clause, TestCase.id)

    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
    page = max(page, 1)
    query = query.limit(page_size).offset((page - 1) * page_size)

    return list(db.execute(query).scalars()), total


def get_test_case(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> TestCase:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    return case


def list_versions(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> list[TestCaseVersionOut]:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    set_tenant_context(db, str(tenant_id))
    versions = db.execute(
        select(TestCaseVersion)
        .where(TestCaseVersion.test_case_id == test_case_id)
        .order_by(TestCaseVersion.version_number)
    ).scalars()
    return [
        TestCaseVersionOut(
            version_number=v.version_number,
            title=v.title,
            description=v.description,
            approved_by=v.approved_by,
            approved_at=v.approved_at,
            created_by=v.created_by,
            created_at=v.created_at,
            steps=_steps_for_version(db, v.id),
        )
        for v in versions
    ]


def _get_version_by_number(
    db: Session, test_case_id: UUID, version_number: int
) -> TestCaseVersion:
    version = db.execute(
        select(TestCaseVersion).where(
            TestCaseVersion.test_case_id == test_case_id,
            TestCaseVersion.version_number == version_number,
        )
    ).scalar_one_or_none()
    if version is None:
        raise NotFoundError(f"Version {version_number} not found")
    return version


def compare_versions(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    test_case_id: UUID,
    from_version: int,
    to_version: int,
) -> VersionCompareOut:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    set_tenant_context(db, str(tenant_id))

    old = _get_version_by_number(db, test_case_id, from_version)
    new = _get_version_by_number(db, test_case_id, to_version)
    old_steps = {s.step_number: s for s in _steps_for_version(db, old.id)}
    new_steps = {s.step_number: s for s in _steps_for_version(db, new.id)}

    diffs: list[StepDiff] = []
    for step_number in sorted(set(old_steps) | set(new_steps)):
        old_step = old_steps.get(step_number)
        new_step = new_steps.get(step_number)
        if old_step is not None and new_step is None:
            diffs.append(
                StepDiff(
                    step_number=step_number,
                    change="removed",
                    old_action=old_step.action,
                    old_expected=old_step.expected,
                )
            )
        elif old_step is None and new_step is not None:
            diffs.append(
                StepDiff(
                    step_number=step_number,
                    change="added",
                    new_action=new_step.action,
                    new_expected=new_step.expected,
                )
            )
        elif old_step is not None and new_step is not None:
            changed = old_step.action != new_step.action or old_step.expected != new_step.expected
            diffs.append(
                StepDiff(
                    step_number=step_number,
                    change="modified" if changed else "unchanged",
                    old_action=old_step.action,
                    old_expected=old_step.expected,
                    new_action=new_step.action,
                    new_expected=new_step.expected,
                )
            )

    return VersionCompareOut(
        from_version=from_version,
        to_version=to_version,
        title_changed=old.title != new.title,
        old_title=old.title,
        new_title=new.title,
        description_changed=old.description != new.description,
        old_description=old.description,
        new_description=new.description,
        steps=diffs,
    )


def _write_version(
    db: Session,
    tenant_id: UUID,
    case: TestCase,
    title: str,
    description: str,
    steps: list[StepIn],
    actor_user_id: UUID,
) -> TestCaseVersion:
    next_number = (
        db.execute(
            select(TestCaseVersion.version_number)
            .where(TestCaseVersion.test_case_id == case.id)
            .order_by(TestCaseVersion.version_number.desc())
        )
        .scalars()
        .first()
        or 0
    ) + 1

    version = TestCaseVersion(
        tenant_id=tenant_id,
        test_case_id=case.id,
        version_number=next_number,
        title=title,
        description=description,
        created_by=actor_user_id,
    )
    db.add(version)
    db.flush()

    for i, step in enumerate(steps, start=1):
        db.add(
            TestCaseVersionStep(
                tenant_id=tenant_id,
                test_case_version_id=version.id,
                step_number=i,
                action=step.action,
                expected=step.expected,
            )
        )
    db.flush()
    case.current_version_id = version.id
    return version


def create_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: TestCaseCreateRequest,
) -> TestCase:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    case = TestCase(
        tenant_id=tenant_id,
        project_id=project_id,
        title=req.title,
        priority=req.priority,
        status="draft",
        assignee_id=req.assignee_id,
        created_by=actor_user_id,
    )
    db.add(case)
    db.flush()

    _write_version(db, tenant_id, case, req.title, req.description, req.steps, actor_user_id)

    if req.assignee_id is not None:
        _notify_assignee(db, tenant_id, actor_user_id, req.assignee_id, case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.created",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"title": case.title, "project_id": str(project_id)},
    )
    db.commit()
    return case


def _notify_assignee(
    db: Session, tenant_id: UUID, actor_user_id: UUID, assignee_id: UUID, case: TestCase
) -> None:
    assignee = db.execute(select(User).where(User.id == assignee_id)).scalar_one_or_none()
    if assignee is None:
        return
    notification_service.notify(
        db,
        tenant_id,
        actor_user_id,
        assignee_id,
        assignee.email,
        "test_case_assigned",
        "A test case was assigned to you",
        f'"{case.title}" was assigned to you.',
        "test_case",
        case.id,
    )


def update_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    req: TestCaseUpdateRequest,
) -> TestCase:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, case)

    changes = req.model_dump(exclude_unset=True)
    was_approved = case.status == "approved"
    current_version = _get_current_version(db, case)

    new_title: str = req.title if req.title is not None else current_version.title
    new_description: str = (
        req.description if req.description is not None else current_version.description
    )
    new_steps: list[StepIn]
    if req.steps is not None:
        new_steps = req.steps
    else:
        new_steps = [
            StepIn(action=s.action, expected=s.expected)
            for s in _steps_for_version(db, current_version.id)
        ]

    if was_approved:
        # ADR-020: any edit to an approved case forks a new version and
        # reverts to draft, pending re-approval.
        _write_version(db, tenant_id, case, new_title, new_description, new_steps, actor_user_id)
        case.status = "draft"
    else:
        # ADR-020: draft/ready_for_review edits mutate the current version
        # in place -- nothing has been approved or executed against it yet.
        current_version.title = new_title
        current_version.description = new_description
        if "steps" in changes:
            db.query(TestCaseVersionStep).filter(
                TestCaseVersionStep.test_case_version_id == current_version.id
            ).delete()
            db.flush()
            for i, step in enumerate(new_steps, start=1):
                db.add(
                    TestCaseVersionStep(
                        tenant_id=tenant_id,
                        test_case_version_id=current_version.id,
                        step_number=i,
                        action=step.action,
                        expected=step.expected,
                    )
                )

    if "title" in changes:
        case.title = changes["title"]
    if "priority" in changes:
        case.priority = changes["priority"]
    if "assignee_id" in changes:
        previous_assignee_id = case.assignee_id
        case.assignee_id = changes["assignee_id"]
        if case.assignee_id is not None and case.assignee_id != previous_assignee_id:
            _notify_assignee(db, tenant_id, actor_user_id, case.assignee_id, case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.updated",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"reverted_to_draft": was_approved, **{k: str(v) for k, v in changes.items()}},
    )
    db.commit()
    return case


def submit_for_review(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, test_case_id: UUID
) -> TestCase:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, case)

    if case.status != "draft":
        raise ConflictError(f"Cannot submit for review from status '{case.status}'")

    case.status = "ready_for_review"
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.submitted_for_review",
        entity_type="test_case",
        entity_id=case.id,
    )
    db.commit()
    return case


def approve_test_case(
    db: Session, tenant_id: UUID, actor_user_id: UUID, test_case_id: UUID
) -> TestCase:
    """Caller must already hold testcase.approve (manager/admin only)."""
    case = _get_test_case_or_404(db, tenant_id, test_case_id)

    if case.status != "ready_for_review":
        raise ConflictError(f"Cannot approve from status '{case.status}'")

    version = _get_current_version(db, case)
    from datetime import UTC, datetime

    version.approved_by = actor_user_id
    version.approved_at = datetime.now(UTC)
    case.status = "approved"

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.approved",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"version_number": version.version_number},
    )
    db.commit()
    return case


def deprecate_test_case(
    db: Session, tenant_id: UUID, actor_user_id: UUID, test_case_id: UUID
) -> TestCase:
    """Caller must already hold testcase.deprecate (manager/admin only)."""
    case = _get_test_case_or_404(db, tenant_id, test_case_id)

    if case.status == "deprecated":
        raise ConflictError("Test case is already deprecated")

    previous_status = case.status
    case.status = "deprecated"

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.deprecated",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"previous_status": previous_status},
    )
    db.commit()
    return case


def delete_test_case(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, test_case_id: UUID
) -> None:
    """ADR-019: Admin/Manager may delete any case; Tester only their own drafts."""
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, case)

    if role_code == "tester":
        if not (case.status == "draft" and case.created_by == actor_user_id):
            raise ForbiddenError("Testers may only delete their own draft test cases")
    elif role_code not in ("admin", "manager"):
        raise ForbiddenError("Not authorized to delete test cases")

    referenced_by_run = (
        db.execute(select(TestRunCase).where(TestRunCase.test_case_id == case.id)).first()
        is not None
    )
    if referenced_by_run:
        raise ConflictError("Cannot delete a test case that has been used in a test run")

    referenced_by_defect = (
        db.execute(select(Defect).where(Defect.test_case_id == case.id)).first() is not None
    )
    if referenced_by_defect:
        raise ConflictError("Cannot delete a test case that has linked defects")

    db.query(TestCaseVersionStep).filter(
        TestCaseVersionStep.test_case_version_id.in_(
            select(TestCaseVersion.id).where(TestCaseVersion.test_case_id == case.id)
        )
    ).delete(synchronize_session=False)
    case.current_version_id = None
    db.flush()
    db.query(TestCaseVersion).filter(TestCaseVersion.test_case_id == case.id).delete(
        synchronize_session=False
    )
    db.delete(case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.deleted",
        entity_type="test_case",
        entity_id=test_case_id,
    )
    db.commit()
