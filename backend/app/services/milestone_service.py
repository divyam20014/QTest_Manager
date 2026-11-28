"""ADR-145: milestones."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.errors import ConflictError, NotFoundError
from app.models.planning import Milestone
from app.models.task import Task, TaskStatus
from app.schemas.planning import MilestoneCreateRequest, MilestoneOut, MilestoneUpdateRequest
from app.services import task_service

_NAME_TAKEN = "This project already has a milestone with that name"
_TRACKED = ("name", "description", "due_date", "completed_at")
_NO_HOURS = Decimal("0.00")


def _get_or_404(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, milestone_id: UUID
) -> Milestone:
    milestone = db.execute(
        select(Milestone)
        .where(Milestone.tenant_id == tenant_id, Milestone.id == milestone_id)
        .with_for_update()
    ).scalar_one_or_none()
    if milestone is None:
        raise NotFoundError("Milestone not found")
    task_service.check_project_access(db, tenant_id, role_code, user_id, milestone.project_id)
    return milestone


def _check_name_free(db: Session, project_id: UUID, name: str, own_id: UUID | None) -> None:
    query = select(Milestone.id).where(
        Milestone.project_id == project_id, func.lower(Milestone.name) == name.lower()
    )
    if own_id is not None:
        query = query.where(Milestone.id != own_id)
    if db.execute(query).first() is not None:
        raise ConflictError(_NAME_TAKEN)


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:  # two requests took the same name at once
        db.rollback()
        raise ConflictError(_NAME_TAKEN) from exc


def to_out_many(db: Session, milestones: list[Milestone]) -> list[MilestoneOut]:
    progress: dict[UUID, dict[bool, tuple[int, Decimal]]] = {m.id: {} for m in milestones}
    if milestones:
        done = TaskStatus.category == "done"
        rows = db.execute(
            select(
                Task.milestone_id,
                done,
                func.count(Task.id),
                func.coalesce(func.sum(Task.estimate_hours), 0),
            )
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(Task.milestone_id.in_(progress))
            .group_by(Task.milestone_id, done)
        )
        for milestone_id, is_done, count, hours in rows:
            progress[milestone_id][is_done] = (count, Decimal(hours))
    result = []
    for m in milestones:
        finished = progress[m.id].get(True, (0, _NO_HOURS))
        unfinished = progress[m.id].get(False, (0, _NO_HOURS))
        result.append(
            MilestoneOut(
                id=m.id,
                project_id=m.project_id,
                name=m.name,
                description=m.description,
                due_date=m.due_date,
                completed_at=m.completed_at,
                task_count=finished[0] + unfinished[0],
                done_count=finished[0],
                estimate_hours=(finished[1] + unfinished[1]).quantize(_NO_HOURS),
                done_estimate_hours=finished[1].quantize(_NO_HOURS),
            )
        )
    return result


def list_milestones(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> list[MilestoneOut]:
    task_service.check_project_access(db, tenant_id, role_code, user_id, project_id)
    milestones = db.execute(
        select(Milestone)
        .where(Milestone.tenant_id == tenant_id, Milestone.project_id == project_id)
        .order_by(Milestone.due_date.asc().nulls_last(), func.lower(Milestone.name))
    ).scalars()
    return to_out_many(db, list(milestones))


def create_milestone(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: MilestoneCreateRequest,
) -> MilestoneOut:
    task_service.check_project_access(db, tenant_id, role_code, actor_user_id, project_id)
    _check_name_free(db, project_id, req.name, None)
    milestone = Milestone(
        tenant_id=tenant_id,
        project_id=project_id,
        name=req.name,
        description=req.description,
        due_date=req.due_date,
    )
    db.add(milestone)
    _flush(db)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="milestone.created",
        entity_type="milestone",
        entity_id=milestone.id,
        metadata={"name": milestone.name, "project_id": str(project_id)},
    )
    out = to_out_many(db, [milestone])[0]
    db.commit()
    return out


def update_milestone(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    milestone_id: UUID,
    req: MilestoneUpdateRequest,
) -> MilestoneOut:
    milestone = _get_or_404(db, tenant_id, role_code, actor_user_id, milestone_id)
    before = {name: getattr(milestone, name) for name in _TRACKED}
    sent = req.model_fields_set
    if req.name is not None and req.name != milestone.name:
        _check_name_free(db, milestone.project_id, req.name, milestone.id)
        milestone.name = req.name
    if "description" in sent:
        milestone.description = req.description
    if "due_date" in sent:
        milestone.due_date = req.due_date
    if req.completed is not None and req.completed != (milestone.completed_at is not None):
        milestone.completed_at = datetime.now(UTC) if req.completed else None
    _flush(db)
    diff = audit_diff(before, {name: getattr(milestone, name) for name in _TRACKED})
    if diff:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="milestone.updated",
            entity_type="milestone",
            entity_id=milestone.id,
            metadata={"fields": sorted(diff), "changes": diff},
        )
    out = to_out_many(db, [milestone])[0]
    db.commit()
    return out


def delete_milestone(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, milestone_id: UUID
) -> None:
    """The tasks stay; they just belong to no milestone."""
    milestone = _get_or_404(db, tenant_id, role_code, actor_user_id, milestone_id)
    # An UPDATE statement, so deleted tasks (which still reference it) are cleared too.
    db.execute(update(Task).where(Task.milestone_id == milestone.id).values(milestone_id=None))
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="milestone.deleted",
        entity_type="milestone",
        entity_id=milestone.id,
        metadata={"name": milestone.name, "project_id": str(milestone.project_id)},
    )
    db.delete(milestone)
    db.commit()
