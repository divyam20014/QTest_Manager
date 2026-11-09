from typing import cast
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.models.execution import TestRun
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.tenant import Tenant
from app.schemas.project import (
    Domain,
    Priority,
    ProjectCreateRequest,
    ProjectOut,
    ProjectStatus,
    ProjectUpdateRequest,
)


def _assigned_user_ids(db: Session, project_id: UUID) -> list[UUID]:
    return list(
        db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        ).scalars()
    )


def to_out(db: Session, project: Project) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        domain=cast(Domain, project.domain),
        status=cast(ProjectStatus, project.status),
        priority=cast(Priority, project.priority),
        manager_name=project.manager_name,
        start_date=project.start_date,
        end_date=project.end_date,
        budget=project.budget,
        currency_code=project.currency_code,
        region=project.region,
        owner_id=project.owner_id,
        assigned_user_ids=_assigned_user_ids(db, project.id),
        created_at=project.created_at,
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


def list_projects(db: Session, tenant_id: UUID, role_code: str, user_id: UUID) -> list[Project]:
    query = select(Project).where(Project.tenant_id == tenant_id).order_by(Project.created_at)
    if role_code == "tester":
        # FR-PROJ-002: testers only see assigned projects.
        query = query.where(
            (Project.owner_id == user_id)
            | Project.id.in_(
                select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
            )
        )
    return list(db.execute(query).scalars())


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


def create_project(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: ProjectCreateRequest
) -> Project:
    currency_code = req.currency_code
    if currency_code is None:
        currency_code = db.execute(
            select(Tenant.default_currency_code).where(Tenant.id == tenant_id)
        ).scalar_one()

    project = Project(
        tenant_id=tenant_id,
        name=req.name,
        domain=req.domain,
        status=req.status,
        priority=req.priority,
        manager_name=req.manager_name,
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
