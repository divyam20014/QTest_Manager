"""Phase 2: planning a project's work (ADR-144 onwards)."""

from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import NotFoundError
from app.models.planning import Sprint
from app.models.task import Task, TaskStatus
from app.schemas.planning import BacklogOut
from app.services import backlog_rank, task_service

MAX_BACKLOG_PAGE = 500


def _backlog_query(tenant_id: UUID, project_id: UUID):
    """Open work still to be planned: not in a planned or active sprint (ADR-146). The
    "Unassigned requirements" holder is not work."""
    taken = select(Sprint.id).where(Sprint.project_id == project_id, Sprint.state != "closed")
    return (
        select(Task)
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(
            Task.tenant_id == tenant_id,
            Task.project_id == project_id,
            Task.is_requirements_home.is_(False),
            TaskStatus.category != "done",
            or_(Task.sprint_id.is_(None), Task.sprint_id.not_in(taken)),
        )
    )


def backlog(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    *,
    limit: int,
    offset: int,
) -> BacklogOut:
    task_service.check_project_access(db, tenant_id, role_code, user_id, project_id)
    query = _backlog_query(tenant_id, project_id)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    page = (
        db.execute(
            query.order_by(Task.backlog_rank.asc().nulls_last(), Task.id)
            .limit(min(max(limit, 1), MAX_BACKLOG_PAGE))
            .offset(max(offset, 0))
        )
        .scalars()
        .all()
    )
    return BacklogOut(items=task_service.to_out_many(db, list(page)), total=total)


def move_in_backlog(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    before_task_id: UUID | None,
) -> Task:
    """Places the task immediately before `before_task_id`, or at the end without one."""
    task = task_service.get_task(db, tenant_id, role_code, actor_user_id, task_id)
    if before_task_id == task.id:
        return task
    backlog_rank.lock_backlog(db, task.project_id)
    if before_task_id is None:
        task.backlog_rank = backlog_rank.rank_at_end(db, task.project_id, excluding=task.id)
    else:
        # Read after the lock, so the position is the one the last move left.
        target = db.execute(
            select(Task)
            .where(
                Task.tenant_id == tenant_id,
                Task.project_id == task.project_id,
                Task.id == before_task_id,
            )
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if target is None or target.backlog_rank is None:
            raise NotFoundError("That task is not in this project's backlog")
        task.backlog_rank = backlog_rank.rank_before(db, task.project_id, target, excluding=task.id)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.reordered",
        entity_type="task",
        entity_id=task.id,
        metadata={"before_task_id": str(before_task_id) if before_task_id else None},
    )
    db.commit()
    return task
