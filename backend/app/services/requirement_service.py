from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.concurrency import bump_row_version, check_row_version
from app.core.db import set_tenant_context
from app.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    StaleWriteError,
    ValidationAppError,
)
from app.core.field_standards import DEFAULT_REQUIREMENT_PRIORITY, DEFAULT_REQUIREMENT_TYPE
from app.models.audit import AuditLog
from app.models.identity import User
from app.models.project import Project
from app.models.requirement import (
    Requirement,
    RequirementAcceptanceCriterion,
    RequirementTestCaseLink,
    RequirementVersion,
)
from app.models.task import Task
from app.models.test_case import TestCase
from app.schemas.requirement import (
    LinkedTestCaseOut,
    RequirementCoverageEntry,
    RequirementCoverageReport,
    RequirementCreateRequest,
    RequirementDetailOut,
    RequirementHistoryEntryOut,
    RequirementOut,
    RequirementUpdateRequest,
    RequirementVersionOut,
)
from app.services import (
    custom_field_service,
    display_id_service,
    field_option_service,
    lookups,
    requirement_links,
    task_service,
    tester_visibility,
)
from app.services.project_service import is_assigned

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
    """Same visibility rule as test cases (ADR-019): tenant-wide for
    Admin/Manager; Tester must be assigned to the project."""
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _get_requirement_or_404(
    db: Session, tenant_id: UUID, requirement_id: UUID, *, for_update: bool = False
) -> Requirement:
    query = select(Requirement).where(
        Requirement.tenant_id == tenant_id, Requirement.id == requirement_id
    )
    if for_update:
        # ADR-136: locked while it is changed, and read as it is once locked.
        query = query.with_for_update().execution_options(populate_existing=True)
    req = db.execute(query).scalar_one_or_none()
    if req is None:
        raise NotFoundError("Requirement not found")
    return req


def _get_current_version(db: Session, req: Requirement) -> RequirementVersion:
    version = db.execute(
        select(RequirementVersion).where(RequirementVersion.id == req.current_version_id)
    ).scalar_one()
    return version


def _authorize_requirement_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, req: Requirement
) -> None:
    project = _get_project_or_404(db, tenant_id, req.project_id)
    _require_project_access(db, project, role_code, user_id)


def _check_option(
    db: Session, tenant_id: UUID, field_key: str, field: str, value: str, errors: dict[str, str]
) -> None:
    try:
        field_option_service.validate_code(db, tenant_id, field_key, value)
    except ValidationAppError as exc:
        errors[field] = exc.message


def default_option(db: Session, tenant_id: UUID, field_key: str, preferred: str) -> str:
    """The usual default, or the organization's first value if it has removed that one."""
    codes = [o.code for o in field_option_service.list_options(db, tenant_id, field_key)]
    return preferred if preferred in codes or not codes else codes[0]


def _check_owner(
    db: Session, project: Project, owner_id: UUID | None, errors: dict[str, str]
) -> None:
    if owner_id is None:
        return
    owner = db.execute(select(User).where(User.id == owner_id)).scalar_one_or_none()
    if owner is None or owner.tenant_id != project.tenant_id or not owner.is_active:
        errors["owner_id"] = "owner_id must be an active user in this tenant"
    elif not is_assigned(db, project, owner_id):
        errors["owner_id"] = "owner_id must be a member of this project"


def criteria_by_version(db: Session, version_ids: list[UUID]) -> dict[UUID, list[str]]:
    result: dict[UUID, list[str]] = {version_id: [] for version_id in version_ids}
    rows = db.execute(
        select(RequirementAcceptanceCriterion)
        .where(RequirementAcceptanceCriterion.requirement_version_id.in_(version_ids))
        .order_by(RequirementAcceptanceCriterion.position)
    ).scalars()
    for row in rows:
        result[row.requirement_version_id].append(row.text)
    return result


def _add_criteria(db: Session, version: RequirementVersion, criteria: list[str]) -> None:
    db.add_all(
        RequirementAcceptanceCriterion(
            tenant_id=version.tenant_id,
            requirement_version_id=version.id,
            position=position,
            text=text,
        )
        for position, text in enumerate(criteria)
    )


def _linked_test_case_count(db: Session, requirement_id: UUID) -> int:
    return db.execute(
        select(func.count(RequirementTestCaseLink.id))
        # ADR-116: links to soft-deleted test cases do not count (ORM hook on TestCase).
        .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
        .where(RequirementTestCaseLink.requirement_id == requirement_id)
    ).scalar_one()


def _linked_test_case_counts(db: Session, requirement_ids: list[UUID]) -> dict[UUID, int]:
    """Batch form of `_linked_test_case_count` (ADR-113): one GROUP BY for all ids."""
    if not requirement_ids:
        return {}
    return dict(
        db.execute(
            select(RequirementTestCaseLink.requirement_id, func.count(RequirementTestCaseLink.id))
            .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
            .where(RequirementTestCaseLink.requirement_id.in_(requirement_ids))
            .group_by(RequirementTestCaseLink.requirement_id)
        )
        .tuples()
        .all()
    )


def to_out(db: Session, req: Requirement) -> RequirementOut:
    return to_out_many(db, [req])[0]


def to_out_many(db: Session, reqs: list[Requirement]) -> list[RequirementOut]:
    """A page of requirements with a constant number of queries (ADR-113)."""
    if not reqs:
        return []
    tenant_id = reqs[0].tenant_id
    # Mirrors test_case_service.to_out: re-assert tenant context in case the
    # caller invoked this right after a commit ended the prior transaction.
    set_tenant_context(db, str(tenant_id))
    versions = {
        v.id: v
        for v in db.execute(
            select(RequirementVersion).where(
                RequirementVersion.id.in_([r.current_version_id for r in reqs])
            )
        ).scalars()
    }
    counts = _linked_test_case_counts(db, [r.id for r in reqs])
    criteria = criteria_by_version(db, list(versions))
    reviews = requirement_links.review_counts(db, [r.id for r in reqs])
    task_refs = {
        t_id: (display_id, title)
        for t_id, display_id, title in db.execute(
            select(Task.id, Task.display_id, Task.title).where(
                Task.id.in_({r.task_id for r in reqs if r.task_id is not None})
            )
        )
    }
    owner_names = lookups.value_map(db, User.id, User.name, (r.owner_id for r in reqs))
    custom_fields = custom_field_service.get_values_for_owners(
        db, tenant_id, "requirement", [r.id for r in reqs]
    )
    out: list[RequirementOut] = []
    for req in reqs:
        version = versions[cast(UUID, req.current_version_id)]
        out.append(
            RequirementOut(
                id=req.id,
                project_id=req.project_id,
                display_id=req.display_id,
                title=req.title,
                description=version.description,
                version_number=version.version_number,
                requirement_type=req.requirement_type,
                priority=req.priority,
                status=req.status,  # type: ignore[arg-type]
                owner_id=req.owner_id,
                owner_name=owner_names.get(req.owner_id) if req.owner_id else None,
                acceptance_criteria=criteria[version.id],
                review_count=reviews.get(req.id, 0),
                row_version=req.row_version,
                created_by=req.created_by,
                created_at=req.created_at,
                linked_test_case_count=counts.get(req.id, 0),
                task_id=req.task_id,
                task_display_id=task_refs[req.task_id][0] if req.task_id in task_refs else None,
                task_title=task_refs[req.task_id][1] if req.task_id in task_refs else None,
                custom_fields=custom_fields[req.id],
            )
        )
    return out


def to_detail_out(
    db: Session, req: Requirement, viewer: tuple[str, UUID] | None = None
) -> RequirementDetailOut:
    """`viewer` = (role_code, user_id): a scoped Tester (ADR-093) only receives the
    linked cases they may see."""
    base = to_out(db, req)
    link_query = (
        select(RequirementTestCaseLink, TestCase)
        .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
        .where(RequirementTestCaseLink.requirement_id == req.id)
        .order_by(RequirementTestCaseLink.linked_at)
    )
    if viewer is not None:
        link_query = tester_visibility.scope_case_query(
            db, req.tenant_id, viewer[0], viewer[1], link_query
        )
    links = db.execute(link_query).all()
    numbers = dict(
        db.execute(
            select(RequirementVersion.id, RequirementVersion.version_number).where(
                RequirementVersion.requirement_id == req.id
            )
        )
        .tuples()
        .all()
    )

    def stale(link: RequirementTestCaseLink) -> bool:
        seen = link.requirement_version_id or link.unrecorded_baseline_version_id
        return req.status != "retired" and seen is not None and seen != req.current_version_id

    linked = [
        LinkedTestCaseOut(
            test_case_id=case.id,
            test_case_title=case.title,
            test_case_status=case.status,
            covers_version_number=(
                numbers[link.requirement_version_id] if link.requirement_version_id else None
            ),
            needs_review=stale(link),
            linked_by=link.linked_by,
            linked_at=link.linked_at,
        )
        for link, case in links
    ]
    return RequirementDetailOut(**base.model_dump(), linked_test_cases=linked)


def list_requirements(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    page: int,
    page_size: int,
    task_id: UUID | None = None,
    include_sub_tasks: bool = False,
    *,
    q: str | None = None,
    requirement_type: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    owner_id: UUID | None = None,
    covered: bool | None = None,
    needs_review: bool | None = None,
) -> tuple[list[Requirement], int]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)

    base_query = select(Requirement).where(
        Requirement.tenant_id == tenant_id, Requirement.project_id == project_id
    )
    if task_id is not None:
        task_ids = (
            task_service.subtree_task_ids(db, tenant_id, task_id)
            if include_sub_tasks
            else [task_id]
        )
        base_query = base_query.where(Requirement.task_id.in_(task_ids))
    if q and q.strip():
        needle = q.strip()
        base_query = base_query.where(
            or_(
                Requirement.title.icontains(needle, autoescape=True),
                Requirement.display_id.icontains(needle, autoescape=True),
            )
        )
    for column, value in (
        (Requirement.requirement_type, requirement_type),
        (Requirement.status, status),
        (Requirement.priority, priority),
        (Requirement.owner_id, owner_id),
    ):
        if value is not None:
            base_query = base_query.where(column == value)
    if covered is not None:
        has_test = (
            select(RequirementTestCaseLink.id)
            .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
            .where(RequirementTestCaseLink.requirement_id == Requirement.id)
            .exists()
        )
        base_query = base_query.where(has_test if covered else ~has_test)
    if needs_review is not None:
        stale_link = (
            select(RequirementTestCaseLink.id)
            .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
            .where(
                RequirementTestCaseLink.requirement_id == Requirement.id,
                requirement_links.NEEDS_REVIEW,
            )
            .correlate(Requirement)
            .exists()
        )
        base_query = base_query.where(stale_link if needs_review else ~stale_link)
    total = db.execute(select(func.count()).select_from(base_query.subquery())).scalar_one()
    rows = db.execute(
        base_query.order_by(Requirement.created_at.desc(), Requirement.display_seq.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars()
    return list(rows), total


def get_requirement(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, requirement_id: UUID
) -> Requirement:
    req = _get_requirement_or_404(db, tenant_id, requirement_id)
    _authorize_requirement_access(db, tenant_id, role_code, user_id, req)
    return req


def get_requirement_history(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, requirement_id: UUID
) -> list[RequirementHistoryEntryOut]:
    """Per-entity activity timeline (PV-9.3) -- see
    test_case_service.get_test_case_history / defect_service.get_defect_history
    for the shared pattern this mirrors."""
    req = get_requirement(db, tenant_id, role_code, user_id, requirement_id)
    set_tenant_context(db, str(tenant_id))

    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "requirement",
            AuditLog.entity_id == req.id,
        )
        .order_by(AuditLog.created_at.asc())
    ).all()
    return [
        RequirementHistoryEntryOut(
            id=log.id,
            action=log.action,
            user_id=log.user_id,
            user_name=user_name,
            event_metadata=log.event_metadata or {},
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def list_versions(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, requirement_id: UUID
) -> list[RequirementVersionOut]:
    req = get_requirement(db, tenant_id, role_code, user_id, requirement_id)
    rows = db.execute(
        select(RequirementVersion)
        .where(RequirementVersion.requirement_id == req.id)
        .order_by(RequirementVersion.version_number.desc())
    ).scalars()
    versions = list(rows)
    criteria = criteria_by_version(db, [v.id for v in versions])
    return [
        RequirementVersionOut(
            version_number=v.version_number,
            title=v.title,
            description=v.description,
            acceptance_criteria=criteria[v.id],
            created_by=v.created_by,
            created_at=v.created_at,
        )
        for v in versions
    ]


def create_requirement(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: RequirementCreateRequest,
) -> Requirement:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    errors: dict[str, str] = {}
    task_service.check_task_for_project(db, tenant_id, project_id, req.task_id, errors)
    requirement_type = req.requirement_type or default_option(
        db, tenant_id, "requirement_type", DEFAULT_REQUIREMENT_TYPE
    )
    _check_option(db, tenant_id, "requirement_type", "requirement_type", requirement_type, errors)
    priority = req.priority or default_option(
        db, tenant_id, "requirement_priority", DEFAULT_REQUIREMENT_PRIORITY
    )
    _check_option(db, tenant_id, "requirement_priority", "priority", priority, errors)
    _check_owner(db, project, req.owner_id, errors)
    if errors:
        raise ValidationAppError("Invalid fields: " + ", ".join(errors), fields=errors)
    # ADR-128: a requirement always belongs to a task; without one it is filed under the project's
    # "Unassigned requirements" task.
    task_id = req.task_id
    if task_id is None:
        task_id = task_service.get_or_create_requirements_home(
            db, tenant_id, project_id, actor_user_id
        ).id

    display_seq, display_id = display_id_service.next_display_id(db, tenant_id, "requirement")
    requirement = Requirement(
        tenant_id=tenant_id,
        project_id=project_id,
        task_id=task_id,
        display_seq=display_seq,
        display_id=display_id,
        requirement_type=requirement_type,
        priority=priority,
        status=req.status,
        owner_id=req.owner_id,
        title=req.title,
        created_by=actor_user_id,
    )
    db.add(requirement)
    db.flush()

    version = RequirementVersion(
        tenant_id=tenant_id,
        requirement_id=requirement.id,
        version_number=1,
        title=req.title,
        description=req.description,
        created_by=actor_user_id,
    )
    db.add(version)
    db.flush()
    _add_criteria(db, version, req.acceptance_criteria)
    requirement.current_version_id = version.id

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.created",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={
            "title": requirement.title,
            "project_id": str(project_id),
            "task_id": str(task_id),
        },
    )
    db.commit()
    return requirement


def update_requirement(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    req: RequirementUpdateRequest,
) -> Requirement:
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id, for_update=True)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)
    check_row_version(requirement, req.expected_version, "requirement")
    project = _get_project_or_404(db, tenant_id, requirement.project_id)

    # --- type, priority, status, owner: checked only when they change
    errors: dict[str, str] = {}
    sent = req.model_fields_set
    details: dict[str, Any] = {}
    for name, field_key in (
        ("requirement_type", "requirement_type"),
        ("priority", "requirement_priority"),
    ):
        value = getattr(req, name)
        if name in sent and value is None:
            errors[name] = f"{name} cannot be cleared"
        elif value is not None and value != getattr(requirement, name):
            _check_option(db, tenant_id, field_key, name, value, errors)
            details[name] = value
    if "status" in sent and req.status is None:
        errors["status"] = "status cannot be cleared"
    elif req.status is not None and req.status != requirement.status:
        details["status"] = req.status
    if "owner_id" in sent and req.owner_id != requirement.owner_id:
        _check_owner(db, project, req.owner_id, errors)
        details["owner_id"] = req.owner_id

    # `task_id: null` files the requirement under the project's "Unassigned requirements" task.
    target_task_id: UUID = requirement.task_id
    if "task_id" in sent:
        if req.task_id is not None:
            target_task_id = req.task_id
        else:
            target_task_id = task_service.get_or_create_requirements_home(
                db, tenant_id, requirement.project_id, actor_user_id
            ).id
    task_changed = target_task_id != requirement.task_id
    if task_changed:
        task_service.check_task_for_project(
            db, tenant_id, requirement.project_id, target_task_id, errors
        )
    if errors:
        db.rollback()
        raise ValidationAppError("Invalid fields: " + ", ".join(errors), fields=errors)

    # --- the wording: a new version only when it really changes (ADR-001, ADR-148)
    current_version = _get_current_version(db, requirement)
    new_title = req.title if req.title is not None else current_version.title
    new_description = (
        req.description if req.description is not None else current_version.description
    )
    current_criteria = criteria_by_version(db, [current_version.id])[current_version.id]
    new_criteria = (
        req.acceptance_criteria if req.acceptance_criteria is not None else current_criteria
    )
    reworded = (new_title, new_description, new_criteria) != (
        current_version.title,
        current_version.description,
        current_criteria,
    )
    # Approval was of the old wording. Approving the new one is a separate save.
    reapproval = reworded and requirement.status == "approved" and req.status != "retired"
    if reapproval:
        details["status"] = "draft"

    if not (reworded or details or task_changed):
        db.commit()
        return requirement

    if task_changed:
        previous_task_id = requirement.task_id
        requirement.task_id = target_task_id
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="requirement.task_changed",
            entity_type="requirement",
            entity_id=requirement.id,
            metadata={"from": str(previous_task_id), "to": str(target_task_id)},
        )
    if details:
        before = {name: getattr(requirement, name) for name in details}
        for name, value in details.items():
            setattr(requirement, name, value)
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="requirement.details_changed",
            entity_type="requirement",
            entity_id=requirement.id,
            metadata={"changes": audit_diff(before, details), "reapproval_needed": reapproval},
        )
    if reworded:
        next_number = current_version.version_number + 1
        version = RequirementVersion(
            tenant_id=tenant_id,
            requirement_id=requirement.id,
            version_number=next_number,
            title=new_title,
            description=new_description,
            created_by=actor_user_id,
        )
        db.add(version)
        db.flush()
        _add_criteria(db, version, new_criteria)
        requirement.current_version_id = version.id
        requirement.title = new_title
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="requirement.updated",
            entity_type="requirement",
            entity_id=requirement.id,
            metadata={"version_number": next_number},
        )
    bump_row_version(requirement)
    db.commit()
    return requirement


def delete_requirement(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, requirement_id: UUID
) -> None:
    """ADR-148: hidden everywhere, but its versions, links and attachments are kept."""
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id, for_update=True)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)
    requirement.deleted_at = datetime.now(UTC)
    bump_row_version(requirement)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.deleted",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={"title": requirement.title, "display_id": requirement.display_id},
    )
    db.commit()


def link_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    test_case_id: UUID,
) -> Requirement:
    # Locked, so the version recorded is the one current when the link is saved.
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id, for_update=True)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)

    case = db.execute(
        select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    ).scalar_one_or_none()
    if case is None:
        raise NotFoundError("Test case not found")
    if case.project_id != requirement.project_id:
        raise ConflictError("Test case belongs to a different project than the requirement")

    existing = db.execute(
        select(RequirementTestCaseLink).where(
            RequirementTestCaseLink.requirement_id == requirement_id,
            RequirementTestCaseLink.test_case_id == test_case_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return requirement

    db.add(
        RequirementTestCaseLink(
            tenant_id=tenant_id,
            requirement_id=requirement_id,
            test_case_id=test_case_id,
            requirement_version_id=requirement.current_version_id,
            linked_by=actor_user_id,
        )
    )
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.linked",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={"test_case_id": str(test_case_id)},
    )
    # ADR-116: the case's own history shows the link too.
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.requirement_linked",
        entity_type="test_case",
        entity_id=test_case_id,
        metadata={
            "requirement_id": str(requirement.id),
            "requirement_title": requirement.title,
            "changes": {"requirement_links": {"from": None, "to": requirement.title}},
        },
    )
    db.commit()
    return requirement


def confirm_link(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    test_case_id: UUID,
    version_number: int,
) -> Requirement:
    """ADR-150: someone who manages requirements has looked, and the case still covers it."""
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id, for_update=True)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)
    link = db.execute(
        select(RequirementTestCaseLink)
        .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
        .where(
            RequirementTestCaseLink.requirement_id == requirement.id,
            RequirementTestCaseLink.test_case_id == test_case_id,
        )
    ).scalar_one_or_none()
    if link is None:
        raise NotFoundError("That test case is not linked to this requirement")
    current = _get_current_version(db, requirement)
    if version_number != current.version_number:
        raise StaleWriteError(
            "This requirement was changed after you opened it, so nothing was confirmed. "
            "Read the latest wording, then confirm again."
        )
    if link.requirement_version_id == current.id:
        db.commit()
        return requirement
    link.requirement_version_id = current.id
    link.unrecorded_baseline_version_id = None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.link_confirmed",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={"test_case_id": str(test_case_id), "version_number": current.version_number},
    )
    db.commit()
    return requirement


def unlink_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    test_case_id: UUID,
) -> Requirement:
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)

    deleted = (
        db.query(RequirementTestCaseLink)
        .filter(
            RequirementTestCaseLink.requirement_id == requirement_id,
            RequirementTestCaseLink.test_case_id == test_case_id,
        )
        .delete()
    )
    if deleted:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="requirement.unlinked",
            entity_type="requirement",
            entity_id=requirement.id,
            metadata={"test_case_id": str(test_case_id)},
        )
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="testcase.requirement_unlinked",
            entity_type="test_case",
            entity_id=test_case_id,
            metadata={
                "requirement_id": str(requirement.id),
                "requirement_title": requirement.title,
                "changes": {"requirement_links": {"from": requirement.title, "to": None}},
            },
        )
    db.commit()
    return requirement


def get_coverage_report(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    summary: bool = False,
    task_id: UUID | None = None,
    include_sub_tasks: bool = False,
) -> RequirementCoverageReport:
    """Coverage of a project requirements, or (ADR-127) of one task requirements -- with its
    sub-tasks too when `include_sub_tasks` -- through `task_id`."""
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)
    scope: list[Any] = [Requirement.tenant_id == tenant_id, Requirement.project_id == project_id]
    if task_id is not None:
        task_ids = (
            task_service.subtree_task_ids(db, tenant_id, task_id)
            if include_sub_tasks
            else [task_id]
        )
        scope.append(Requirement.task_id.in_(task_ids))
    retired = (
        db.scalar(select(func.count(Requirement.id)).where(*scope, Requirement.status == "retired"))
        or 0
    )
    needing_review = (
        db.scalar(
            select(func.count(func.distinct(RequirementTestCaseLink.requirement_id)))
            .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
            .join(Requirement, Requirement.id == RequirementTestCaseLink.requirement_id)
            .where(*scope, requirement_links.NEEDS_REVIEW)
        )
        or 0
    )
    # A requirement that no longer applies needs no coverage.
    scope.append(Requirement.status != "retired")

    if summary:
        # ADR-126: the project dashboard widget only needs the three totals. Two COUNTs instead of
        # one entry per requirement (about 368 KB for a project with thousands of them).
        total = db.scalar(select(func.count(Requirement.id)).where(*scope)) or 0
        covered = (
            db.scalar(
                select(func.count(func.distinct(RequirementTestCaseLink.requirement_id)))
                .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
                .join(Requirement, Requirement.id == RequirementTestCaseLink.requirement_id)
                .where(*scope)
            )
            or 0
        )
        return RequirementCoverageReport(
            project_id=project_id,
            total_requirements=total,
            covered_requirements=covered,
            coverage_percentage=round((covered / total) * 100, 1) if total else 0.0,
            retired_requirements=retired,
            requirements_needing_review=needing_review,
            requirements=[],
        )

    requirements = (
        db.execute(select(Requirement).where(*scope).order_by(Requirement.created_at))
        .scalars()
        .all()
    )

    entries = []
    covered_count = 0
    link_counts = _linked_test_case_counts(db, [r.id for r in requirements])
    reviews = requirement_links.review_counts(db, [r.id for r in requirements])
    for r in requirements:
        count = link_counts.get(r.id, 0)
        covered = count > 0
        if covered:
            covered_count += 1
        entries.append(
            RequirementCoverageEntry(
                requirement_id=r.id,
                display_id=r.display_id,
                requirement_title=r.title,
                status=r.status,  # type: ignore[arg-type]
                review_count=reviews.get(r.id, 0),
                linked_test_case_count=count,
                covered=covered,
            )
        )

    total = len(requirements)
    percentage = round((covered_count / total) * 100, 1) if total else 0.0
    return RequirementCoverageReport(
        project_id=project_id,
        total_requirements=total,
        covered_requirements=covered_count,
        coverage_percentage=percentage,
        retired_requirements=retired,
        requirements_needing_review=needing_review,
        requirements=entries,
    )
