"""ADR-147: adding and removing task dependencies."""

from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.models.planning import TaskDependency
from app.models.task import Task
from app.services import task_service
from app.services.dependency_links import lock_dependencies

# Does `start` already wait, directly or through others, for `target`?
_WAITS_FOR_SQL = text(
    """
    WITH RECURSIVE chain(id) AS (
        SELECT CAST(:start AS uuid)
        UNION
        SELECT d.depends_on_task_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id
    )
    SELECT 1 FROM chain WHERE id = CAST(:target AS uuid)
    """
)

_ANCESTORS_SQL = text(
    """
    WITH RECURSIVE up(id) AS (
        SELECT parent_task_id FROM tasks WHERE id = CAST(:task AS uuid)
        UNION
        SELECT t.parent_task_id FROM tasks t JOIN up ON t.id = up.id
    )
    SELECT id FROM up WHERE id IS NOT NULL
    """
)


def _refuse(message: str) -> ValidationAppError:
    return ValidationAppError(message, fields={"depends_on_task_id": message})


def _link(db: Session, task_id: UUID, other_id: UUID) -> TaskDependency | None:
    return db.execute(
        select(TaskDependency).where(
            TaskDependency.task_id == task_id, TaskDependency.depends_on_task_id == other_id
        )
    ).scalar_one_or_none()


def add_dependency(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    other_id: UUID,
) -> Task:
    """`task_id` will wait for `other_id`. Adding a link that exists changes nothing."""
    task = task_service.get_task(db, tenant_id, role_code, actor_user_id, task_id)
    lock_dependencies(db, task.project_id)
    # Both read again now that no one else can link or delete them.
    found = {
        t.id: t
        for t in db.execute(
            select(Task)
            .where(
                Task.tenant_id == tenant_id,
                Task.project_id == task.project_id,
                Task.id.in_([task_id, other_id]),
            )
            .execution_options(populate_existing=True)
        ).scalars()
    }
    if task_id not in found:
        raise NotFoundError("Task not found")
    other = found.get(other_id)
    if other is None:
        raise _refuse("That task was not found in this project")
    if other.id == task.id:
        raise _refuse("A task cannot depend on itself")
    if _link(db, task.id, other.id) is not None:
        return task
    for lower, upper in ((task.id, other.id), (other.id, task.id)):
        if upper in db.execute(_ANCESTORS_SQL, {"task": lower}).scalars().all():
            raise ConflictError("A task and its own sub-task cannot depend on each other")
    if db.execute(_WAITS_FOR_SQL, {"start": other.id, "target": task.id}).first() is not None:
        raise ConflictError(
            f"That would make a circle: {other.display_id} already waits for {task.display_id}"
        )
    db.add(
        TaskDependency(
            tenant_id=tenant_id,
            project_id=task.project_id,
            task_id=task.id,
            depends_on_task_id=other.id,
            created_by=actor_user_id,
        )
    )
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.dependency_added",
        entity_type="task",
        entity_id=task.id,
        metadata={"depends_on_task_id": str(other.id), "depends_on": other.display_id},
    )
    db.commit()
    return task


def remove_dependency(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    other_id: UUID,
) -> Task:
    task = task_service.get_task(db, tenant_id, role_code, actor_user_id, task_id)
    link = _link(db, task.id, other_id)
    if link is None:
        raise NotFoundError("This task does not depend on that one")
    db.delete(link)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.dependency_removed",
        entity_type="task",
        entity_id=task.id,
        metadata={"depends_on_task_id": str(other_id)},
    )
    db.commit()
    return task
