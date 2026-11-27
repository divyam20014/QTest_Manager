from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy import case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import allow_archived_write
from app.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ProjectArchivedError,
)
from app.core.field_standards import CLOSED_DEFECT_STATUSES
from app.models.defect import Defect
from app.models.execution import TestRun
from app.models.identity import Role, User
from app.models.project import Project, ProjectMember
from app.models.requirement import Requirement
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.test_case import TestCase
from app.models.test_module import TestModule
from app.schemas.project import (
    NO_DOMAIN,
    Priority,
    ProjectCreateRequest,
    ProjectMemberOut,
    ProjectOut,
    ProjectStatus,
    ProjectUpdateRequest,
)
from app.services import project_domains

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


def assigned_user_ids_many(db: Session, project_ids: list[UUID]) -> dict[UUID, list[UUID]]:
    """Batch form of `_assigned_user_ids` for list pages (ADR-113)."""
    out: dict[UUID, list[UUID]] = {pid: [] for pid in project_ids}
    if not project_ids:
        return out
    for project_id, user_id in db.execute(
        select(ProjectMember.project_id, ProjectMember.user_id).where(
            ProjectMember.project_id.in_(project_ids)
        )
    ):
        out[project_id].append(user_id)
    return out


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
        .where(Defect.project_id.in_(project_ids), Defect.status.notin_(CLOSED_DEFECT_STATUSES))
        .group_by(Defect.project_id)
    ).all()
    for project_id, total in defect_rows:
        metrics[project_id].open_defect_count = total

    return metrics


def to_out(
    db: Session,
    project: Project,
    metrics: _ProjectMetrics | None = None,
    assigned_user_ids: list[UUID] | None = None,
) -> ProjectOut:
    if metrics is None:
        metrics = metrics_for_projects(db, [project.id])[project.id]
    if assigned_user_ids is None:
        assigned_user_ids = _assigned_user_ids(db, project.id)
    return ProjectOut(
        id=project.id,
        name=project.name,
        domain=project.domain,
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
        assigned_user_ids=assigned_user_ids,
        created_at=project.created_at,
        version=project.version,
        archived_at=project.archived_at,
        nav_config=project.nav_config,  # type: ignore[arg-type]  # dict validated by pydantic
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
    archived: bool = False,
    sort: str = "name",
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[Project], int]:
    query = select(Project).where(
        Project.tenant_id == tenant_id,
        # ADR-140: archived projects are listed only when asked for.
        Project.archived_at.is_not(None) if archived else Project.archived_at.is_(None),
    )
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
    if domain == NO_DOMAIN:
        query = query.where(Project.domain.is_(None))
    elif domain:
        query = query.where(Project.domain == domain)
    if status:
        query = query.where(Project.status == status)
    if priority:
        query = query.where(Project.priority == priority)

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()

    sort_key = sort.lstrip("-")
    sort_field = SORTABLE_FIELDS.get(sort_key, Project.name)
    order_clause = sort_field.desc() if sort.startswith("-") else sort_field.asc()
    # A project without the value being sorted on comes last in both directions.
    order_clause = order_clause.nulls_last()
    query = query.order_by(order_clause, Project.id)

    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
    page = max(page, 1)
    query = query.limit(page_size).offset((page - 1) * page_size)

    return list(db.execute(query).scalars()), total


def _get_project_or_404(
    db: Session, tenant_id: UUID, project_id: UUID, *, for_update: bool = False
) -> Project:
    query = select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    if for_update:
        # GAP-68: row-locked so a concurrent update_project() call blocks
        # until this transaction commits/rolls back, instead of both
        # reading the same pre-update `version` and racing past the
        # expected_version check below.
        query = query.with_for_update()
    project = db.execute(query).scalar_one_or_none()
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


def _copy_modules(db: Session, tenant_id: UUID, source_id: UUID, target_id: UUID) -> int:
    """The source's module tree as new modules of the target, parents before children."""
    modules = db.execute(
        select(TestModule)
        .where(TestModule.tenant_id == tenant_id, TestModule.project_id == source_id)
        .order_by(TestModule.created_at, TestModule.id)
    ).scalars().all()
    children: dict[UUID | None, list[TestModule]] = {}
    for module in modules:
        children.setdefault(module.parent_id, []).append(module)
    copied = 0
    waiting: list[tuple[UUID | None, UUID | None]] = [(None, None)]  # (source, copy)
    while waiting:
        source_parent, new_parent = waiting.pop(0)
        for module in children.get(source_parent, []):
            copy = TestModule(
                tenant_id=tenant_id, project_id=target_id, parent_id=new_parent, name=module.name
            )
            db.add(copy)
            db.flush()
            copied += 1
            waiting.append((module.id, copy.id))
    return copied


def create_project(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    req: ProjectCreateRequest,
    role_code: str = "admin",
) -> Project:
    # ADR-142: only a project the user may open can be copied from. Checked before
    # anything is written. Internal callers (sample data) pass no template.
    template = (
        get_project(db, tenant_id, role_code, actor_user_id, req.template_project_id)
        if req.template_project_id is not None
        else None
    )
    currency_code = req.currency_code
    if currency_code is None:
        currency_code = db.execute(
            select(Tenant.default_currency_code).where(Tenant.id == tenant_id)
        ).scalar_one()

    _validate_manager_user_id(db, tenant_id, req.manager_user_id)
    if req.domain is not None:
        project_domains.check_domain(db, tenant_id, req.domain)

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
        nav_config=template.nav_config if template else None,
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

    template_details: dict[str, object] = {}
    if template is not None:
        template_details = {
            "template_project_id": str(template.id),
            "modules_copied": _copy_modules(db, tenant_id, template.id, project.id),
        }

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="project.created",
        entity_type="project",
        entity_id=project.id,
        metadata={"name": project.name, "domain": project.domain, **template_details},
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
    project = _get_project_or_404(db, tenant_id, project_id, for_update=True)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)
    if project.archived_at is not None:
        raise ProjectArchivedError()

    changes = req.model_dump(exclude_unset=True)
    expected_version = changes.pop("expected_version", None)
    current_version = project.version
    if expected_version is not None and expected_version != current_version:
        # Captured current_version above: db.rollback() expires every
        # object in the session, and re-accessing project.version after
        # that would trigger a reload query that runs without tenant
        # context (the RLS GUC is transaction-local and resets on
        # rollback), raising ObjectDeletedError instead of this message.
        db.rollback()
        raise ConflictError(
            f"Project was changed by someone else (expected version {expected_version}, "
            f"current version {current_version}). Reload and retry."
        )

    new_domain = changes.get("domain")
    # The domain a project already has stays valid, even if it has left the list.
    if new_domain is not None and new_domain != project.domain:
        project_domains.check_domain(db, tenant_id, new_domain)
    if "manager_user_id" in changes:
        _validate_manager_user_id(db, tenant_id, changes["manager_user_id"])
    for field, value in changes.items():
        setattr(project, field, value)
    if changes:
        project.version += 1

    effective_start = project.start_date
    effective_end = project.end_date
    if effective_start and effective_end and effective_end < effective_start:
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
        # JSON mode: dates, money and ids cannot go into the audit entry as they are.
        metadata=req.model_dump(mode="json", exclude_unset=True, exclude={"expected_version"}),
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
        select(TestCase.id)
        .where(TestCase.project_id == project.id)
        .limit(1)
        # ADR-116: soft-deleted cases still reference the project (FK).
        .execution_options(include_deleted=True)
    ).first()
    has_test_runs = db.execute(
        select(TestRun.id).where(TestRun.project_id == project.id).limit(1)
    ).first()
    has_defects = db.execute(
        select(Defect.id).where(Defect.project_id == project.id).limit(1)
    ).first()
    # ADR-127: tasks and requirements also FK to the project (soft-deleted tasks included).
    has_tasks = db.execute(
        select(Task.id)
        .where(Task.project_id == project.id)
        .limit(1)
        .execution_options(include_deleted=True)
    ).first()
    has_requirements = db.execute(
        select(Requirement.id).where(Requirement.project_id == project.id).limit(1)
    ).first()
    if has_test_cases or has_test_runs or has_defects or has_tasks or has_requirements:
        raise ConflictError(
            "Cannot delete a project with existing test cases, test runs, defects, "
            "requirements, or tasks"
        )

    # An empty project may be deleted while archived; its member list goes with it.
    allow_archived_write(db)
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


def set_archived(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    role_code: str,
    project_id: UUID,
    archived: bool,
) -> Project:
    """ADR-140: archive or restore. The same people who may delete the project may."""
    project = _get_project_or_404(db, tenant_id, project_id, for_update=True)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)
    if (project.archived_at is not None) == archived:
        state = "already archived" if archived else "not archived"
        raise ConflictError(f"This project is {state}")

    project.archived_at = datetime.now(UTC) if archived else None
    project.archived_by = actor_user_id if archived else None
    project.version += 1
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="project.archived" if archived else "project.restored",
        entity_type="project",
        entity_id=project.id,
        metadata={"name": project.name},
    )
    db.commit()
    return project


def get_project_for_member_change(
    db: Session, tenant_id: UUID, actor_user_id: UUID, role_code: str, project_id: UUID
) -> Project:
    """The project, if this user may change who is on it (ADR-018)."""
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)
    return project


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


def list_members_with_roles(
    db: Session, tenant_id: UUID, project_id: UUID
) -> list[ProjectMemberOut]:
    """RBAC Phase 1: members plus their tenant-wide role name and (if set)
    their project-scoped role override, for the Team Members management UI."""
    project_role = Role.__table__.alias("project_role")
    rows = db.execute(
        select(
            User.id,
            User.name,
            Role.name.label("tenant_role_name"),
            ProjectMember.role_id.label("project_role_id"),
            project_role.c.name.label("project_role_name"),
        )
        .select_from(ProjectMember)
        .join(User, User.id == ProjectMember.user_id)
        .join(Role, Role.id == User.role_id)
        .outerjoin(project_role, project_role.c.id == ProjectMember.role_id)
        .where(ProjectMember.project_id == project_id, User.tenant_id == tenant_id)
        .order_by(User.name)
    ).all()
    return [
        ProjectMemberOut(
            user_id=r.id,
            name=r.name,
            tenant_role_name=r.tenant_role_name,
            project_role_id=r.project_role_id,
            project_role_name=r.project_role_name,
        )
        for r in rows
    ]


def set_member_role(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    role_code: str,
    project_id: UUID,
    member_user_id: UUID,
    role_id: UUID | None,
) -> Project:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_manager_assigned_or_admin(db, project, role_code, actor_user_id)

    member = db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == member_user_id
        )
    ).scalar_one_or_none()
    if member is None:
        raise NotFoundError("That user is not a member of this project")

    if role_id is not None:
        # A role assignable here must be one the tenant can actually see --
        # a system role (tenant_id IS NULL) or this tenant's own custom role
        # -- never another tenant's custom role.
        role = db.execute(
            select(Role).where(
                Role.id == role_id,
                (Role.tenant_id.is_(None)) | (Role.tenant_id == tenant_id),
                Role.is_active.is_(True),
            )
        ).scalar_one_or_none()
        if role is None:
            raise NotFoundError("Role not found")

    member.role_id = role_id
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="project.member_role_set",
        entity_type="project",
        entity_id=project.id,
        metadata={"user_id": str(member_user_id), "role_id": str(role_id) if role_id else None},
    )
    db.commit()
    return project
