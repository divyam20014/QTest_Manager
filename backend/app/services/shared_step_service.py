from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, NotFoundError
from app.models.project import Project
from app.models.shared_step import SharedStep
from app.schemas.shared_step import (
    SharedStepCreateRequest,
    SharedStepOut,
    SharedStepUpdateRequest,
)
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


def _get_shared_step_or_404(db: Session, tenant_id: UUID, shared_step_id: UUID) -> SharedStep:
    step = db.execute(
        select(SharedStep).where(SharedStep.tenant_id == tenant_id, SharedStep.id == shared_step_id)
    ).scalar_one_or_none()
    if step is None:
        raise NotFoundError("Shared step not found")
    return step


def _to_out(step: SharedStep) -> SharedStepOut:
    return SharedStepOut(
        id=step.id,
        project_id=step.project_id,
        name=step.name,
        action=step.action,
        expected=step.expected,
        category=step.category,
        created_at=step.created_at,
    )


def list_shared_steps(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> list[SharedStepOut]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)
    rows = db.execute(
        select(SharedStep)
        .where(SharedStep.tenant_id == tenant_id, SharedStep.project_id == project_id)
        .order_by(SharedStep.name)
    ).scalars()
    return [_to_out(s) for s in rows]


def create_shared_step(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: SharedStepCreateRequest,
) -> SharedStepOut:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    step = SharedStep(
        tenant_id=tenant_id,
        project_id=project_id,
        name=req.name,
        action=req.action,
        expected=req.expected,
        category=req.category,
    )
    db.add(step)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="shared_step.created",
        entity_type="shared_step",
        entity_id=step.id,
        metadata={"name": req.name, "project_id": str(project_id)},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(step)


def update_shared_step(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    shared_step_id: UUID,
    req: SharedStepUpdateRequest,
) -> SharedStepOut:
    step = _get_shared_step_or_404(db, tenant_id, shared_step_id)
    project = _get_project_or_404(db, tenant_id, step.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if req.name is not None:
        step.name = req.name
    if req.action is not None:
        step.action = req.action
    if req.expected is not None:
        step.expected = req.expected
    if "category" in req.model_fields_set:
        step.category = req.category

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="shared_step.updated",
        entity_type="shared_step",
        entity_id=step.id,
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(step)


def delete_shared_step(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, shared_step_id: UUID
) -> None:
    step = _get_shared_step_or_404(db, tenant_id, shared_step_id)
    project = _get_project_or_404(db, tenant_id, step.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="shared_step.deleted",
        entity_type="shared_step",
        entity_id=step.id,
    )
    db.delete(step)
    db.commit()
