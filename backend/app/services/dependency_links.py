"""ADR-147: reading and clearing task dependencies. (Adding one is in dependency_service.)"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.models.planning import TaskDependency
from app.models.task import Task, TaskStatus
from app.schemas.task import TaskDependencyRef
from app.services import task_status_service


def lock_dependencies(db: Session, project_id: UUID) -> None:
    # The database trigger takes the same lock.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"dependencies:{project_id}"},
    )


def open_counts(db: Session, task_ids: Sequence[UUID]) -> dict[UUID, int]:
    """For each task, how many of the tasks it depends on are not done."""
    rows = db.execute(
        select(TaskDependency.task_id, func.count(Task.id))
        .join(Task, Task.id == TaskDependency.depends_on_task_id)
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(TaskDependency.task_id.in_(task_ids), TaskStatus.category != "done")
        .group_by(TaskDependency.task_id)
    )
    return {task_id: count for task_id, count in rows}


def _refs(
    db: Session,
    task_id: UUID,
    near: InstrumentedAttribute[UUID],
    far: InstrumentedAttribute[UUID],
) -> list[TaskDependencyRef]:
    rows = db.execute(
        select(Task, TaskStatus)
        .join(TaskDependency, far == Task.id)
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(near == task_id)
        .order_by(Task.display_seq, Task.created_at)
    )
    return [
        TaskDependencyRef(
            task_id=task.id,
            display_id=task.display_id,
            title=task.title,
            status=task_status_service.to_ref(status),
        )
        for task, status in rows
    ]


def depends_on(db: Session, task_id: UUID) -> list[TaskDependencyRef]:
    return _refs(db, task_id, TaskDependency.task_id, TaskDependency.depends_on_task_id)


def blocks(db: Session, task_id: UUID) -> list[TaskDependencyRef]:
    return _refs(db, task_id, TaskDependency.depends_on_task_id, TaskDependency.task_id)


def remove_all(db: Session, project_id: UUID, task_ids: Sequence[UUID]) -> None:
    """For tasks being deleted: nothing waits for them any more."""
    lock_dependencies(db, project_id)
    db.execute(
        delete(TaskDependency).where(
            or_(
                TaskDependency.task_id.in_(task_ids),
                TaskDependency.depends_on_task_id.in_(task_ids),
            )
        )
    )
