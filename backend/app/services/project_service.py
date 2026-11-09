from typing import cast
from uuid import UUID

from sqlalchemy import case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.models.defect import Defect
from app.models.execution import TestRun
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.tenant import Tenant
from app.models.test_case import TestCase
from app.schemas.project import (
    Domain,
    Priority,
    ProjectCreateRequest,
    ProjectOut,
    ProjectStatus,
    ProjectUpdateRequest,
)

SORTABLE_FIELDS = {
    "name": Project.name,
    "created_at": Project.created_at,
    "start_date": Project.start_date,
    "end_date": Project.end_date,
    "priority": Project.priority,
    "status": Project.status,
    "budget": Project.budget,
}
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _assigned_user_ids(db: Session, project_id: UUID) -> list[UUID]:
    return list(
        db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        ).scalars()
    )


class _ProjectMetrics:
    __slots__ = (
        "test_case_count",
        "approved_test_case_count",
        "test_run_count",
        "open_defect_count",
    )

    def __init__(self) -> None:
        self.test_case_count = 0
        self.approved_test_case_count = 0
        self.test_run_count = 0
        self.open_defect_count = 0


def metrics_for_projects(db: Session, project_ids: list[UUID]) -> dict[UUID, _ProjectMetrics]:
    """One grouped aggregate query per module instead of N+1 per project."""
    metrics: dict[UUID, _ProjectMetrics] = {pid: _ProjectMetrics() for pid in project_ids}
    if not project_ids:
        return metrics

    tc_rows = db.execute(
        select(
            TestCase.project_id,
            func.count(TestCase.id),
            func.count(case((TestCase.status == "approved", 1))),
        )
        .where(TestCase.project_id.in_(project_ids))
        .group_by(TestCase.project_id)
    ).all()
    for project_id, total, approved in tc_rows:
        metrics[project_id].test_case_count = total
        metrics[project_id].approved_test_case_count = approved

    run_rows = db.execute(
        select(TestRun.project_id, func.count(TestRun.id))
        .where(TestRun.project_id.in_(project_ids))
        .group_by(TestRun.project_id)
    ).all()
    for project_id, total in run_rows:
        metrics[project_id].test_run_count = total

    defect_rows = db.execute(
        select(Defect.project_id, func.count(Defect.id))
        .where(Defect.project_id.in_(project_ids), Defect.status != "Closed")
        .group_by(Defect.project_id)
    ).all()
    for project_id, total in defect_rows:
        metrics[project_id].open_defect_count = total

    return metrics


def to_out(db: Session, project: Project, metrics: _ProjectMetrics | None = None) -> ProjectOut:
    if metrics is None:
        metrics = metrics_for_projects(db, [project.id])[project.id]
    return ProjectOut(
        id=project.id,
        name=project.name,
        domain=cast(Domain, project.domain),
        status=cast(ProjectStatus, project.status),
        priority=cast(Priority, project.priority),
        manager_name=project.manager_name,
        manager_user_id=project.manager_user_id,
        start_date=project.start_date,
        end_date=project.end_date,
        budget=project.budget,
        currency_code=project.currency_code,
        region=project.region,
        owner_id=project.owner_id,
        assigned_user_ids=_assigned_user_ids(db, project.id),
        created_at=project.created_at,
        test_case_count=metrics.test_case_count,
        approved_test_case_count=metrics.approved_test_case_count,
        test_run_count=metrics.test_run_count,
        open_defect_count=metrics.open_defect_count,
    )


def is_assigned(db: Session, project: Project, user_id: UUID) -> bool:
    if project.owner_id == user_id:
        return True
    return (
        db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id, ProjectMember.user_id == user_id
            )
        ).first()
        is not None
    )


def _require_manager_assigned_or_admin(
    db: Session, project: Project, role_code: str, user_id: UUID
) -> None:
    """ADR-018: Admin bypasses; Manager must be assigned (owner or member)."""
    if role_code == "admin":
        return
    if role_code == "manager" and is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def list_projects(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    *,
    search: str | None = None,
    domain: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    sort: str = "name",
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[Project], int]:
    query = select(Project).where(Project.tenant_id == tenant_id)
    if role_code == "tester":
        # FR-PROJ-002: testers only see assigned projects.
        query = query.where(
            (Project.owner_id == user_id)
            | Project.id.in_(
                select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
            )
        )
    if search:
        query = query.where(Project.name.ilike(f"%{search}%"))
    if domain:
        query = query.where(Project.domain == domain)
    if status:
        query = query.where(Project.status == status)
    if priority:
        query = query.where(Project.priority == priority)

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()

    sort_key = sort.lstrip("-")
    sort_field = SORTABLE_FIELDS.get(sort_key, Project.name)
    order_clause = sort_field.desc() if sort.startswith("-") else sort_field.asc()
    query = query.order_by(order_clause, Project.id)

    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
    page = max(page, 1)
    query = query.limit(page_size).offset((page - 1) * page_size)

    return list(db.execute(query).scalars()), total


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def get_project(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> Project:
    project = _get_project_or_404(db, tenant_id, project_id)
    if role_code == "tester" and not is_assigned(db, project, user_id):
        raise NotFoundError("Project not found")
    return project


def _validate_manager_user_id(db: Session, tenant_id: UUID, manager_user_id: UUID | None) -> None:
    if manager_user_id is None:
        return
    exists = db.execute(
        select(User.id).where(User.tenant_id == tenant_id, User.id == manager_user_id)
    ).scalar_one_or_none()
    if exists is None:
        raise NotFoundError("manager_user_id does not refer to a user in this tenant")


def create_project(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: ProjectCreateRequest
) -> Project:
    currency_code = req.currency_code
    if currency_code is None:
        currency_code = db.execute(
            select(Tenant.default_currency_code).where(Tenant.id == tenant_id)
        ).scalar_one()

    _validate_manager_user_id(db, tenant_id, req.manager_user_id)

    project = Project(
        tenant_id=tenant_id,
        name=req.name,
        domain=req.domain,
        status=req.status,
        priority=req.priority,
        manager_name=req.manager_name,
        manager_user_id=req.manager_user_id,
        start_date=req.start_date,
        end_date=req.end_date,
        budget=req.budget,
        currency_code=currency_code,
        region=req.region,
        owner_id=actor_user_id,
    )
    db.add(project)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A project with this name already exists in this tenant") from exc

    # The creator is immediately "assigned" (ADR-018), so a Manager who
    # creates a project can also edit/delete what they just made.
    db.add(ProjectMember(project_id=project.id, user_id=actor_user_id))

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="project.created",
        entity_type="project",
        entity_id=project.id,
        metadata={"name": project.name, "domain": project.domain},
    )
    db.commit()
    return project


def update_project(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    role_code: str,
    project_id: UUID,
    req: ProjectUpdateRequest,
) -> Project:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)

    changes = req.model_dump(exclude_unset=True)
    if "manager_user_id" in changes:
        _validate_manager_user_id(db, tenant_id, changes["manager_user_id"])
    for field, value in changes.items():
        setattr(project, field, value)

    effective_start = project.start_date
    effective_end = project.end_date
    if effective_end < effective_start:
        db.rollback()
        raise ConflictError("Start date cannot be after end date.")

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A project with this name already exists in this tenant") from exc

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="project.updated",
        entity_type="project",
        entity_id=project.id,
        metadata=changes,
    )
    db.commit()
    return project


def delete_project(
    db: Session, tenant_id: UUID, actor_user_id: UUID, role_code: str, project_id: UUID
) -> None:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)

    active_run_exists = (
        db.execute(
            select(TestRun).where(TestRun.project_id == project.id, TestRun.finished_at.is_(None))
        ).first()
        is not None
    )
    if active_run_exists:
        raise ConflictError("Cannot delete a project with active test runs")

    # test_cases/test_runs/defects all FK to projects with no ON DELETE
    # CASCADE (by design -- physically removing test history/audit trail
    # data is never safe). Without this check, a project with *finished*
    # runs or any test cases would hit a raw, unhandled FK IntegrityError
    # instead of a clean error.
    has_test_cases = db.execute(
        select(TestCase.id).where(TestCase.project_id == project.id).limit(1)
    ).first()
    has_test_runs = db.execute(
        select(TestRun.id).where(TestRun.project_id == project.id).limit(1)
    ).first()
    has_defects = db.execute(
        select(Defect.id).where(Defect.project_id == project.id).limit(1)
    ).first()
    if has_test_cases or has_test_runs or has_defects:
        raise ConflictError(
            "Cannot delete a project with existing test cases, test runs, or defects"
        )

    db.execute(delete(ProjectMember).where(ProjectMember.project_id == project.id))
    db.delete(project)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="project.deleted",
        entity_type="project",
        entity_id=project.id,
    )
    db.commit()


def add_member(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    role_code: str,
    project_id: UUID,
    member_user_id: UUID,
) -> Project:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)

    user_exists = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == member_user_id)
    ).scalar_one_or_none()
    if user_exists is None:
        raise NotFoundError("User not found")

    already_member = (
        db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id, ProjectMember.user_id == member_user_id
            )
        ).first()
        is not None
    )
    if not already_member:
        db.add(ProjectMember(project_id=project_id, user_id=member_user_id))
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="project.member_added",
            entity_type="project",
            entity_id=project.id,
            metadata={"user_id": str(member_user_id)},
        )
        db.commit()
    return project


def remove_member(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    role_code: str,
    project_id: UUID,
    member_user_id: UUID,
) -> Project:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)

    db.execute(
        delete(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == member_user_id
        )
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="project.member_removed",
        entity_type="project",
        entity_id=project.id,
        metadata={"user_id": str(member_user_id)},
    )
    db.commit()
    return project
