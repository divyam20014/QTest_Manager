"""ADR-146: the one place that moves a task into or out of a sprint.

Everything that changes a sprint or its membership holds the project's sprint lock until it
commits, and reads sprints and tasks again after taking it.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.models.planning import Sprint, SprintTaskHistory
from app.models.task import Task


def lock_sprints(db: Session, project_id: UUID) -> None:
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"sprints:{project_id}"}
    )


def history_row(db: Session, sprint_id: UUID, task_id: UUID) -> SprintTaskHistory | None:
    return db.execute(
        select(SprintTaskHistory).where(
            SprintTaskHistory.sprint_id == sprint_id, SprintTaskHistory.task_id == task_id
        )
    ).scalar_one_or_none()


def leave(db: Session, sprint: Sprint, task: Task) -> None:
    """Records that the task left. A planned sprint has no history, and a closed sprint's
    history never changes."""
    if sprint.state != "active":
        return
    row = history_row(db, sprint.id, task.id)
    if row is not None and row.removed_at is None:
        row.removed_at = datetime.now(UTC)
        row.estimate_at_end = task.estimate_hours


def join(db: Session, sprint: Sprint, task: Task) -> None:
    """Records that the task joined a running sprint. One that comes back is no longer
    removed, and counts as planned or added the way it first did."""
    if sprint.state != "active":
        return
    row = history_row(db, sprint.id, task.id)
    if row is not None:
        row.removed_at = None
        row.estimate_at_end = None
        return
    db.add(
        SprintTaskHistory(
            tenant_id=task.tenant_id,
            project_id=task.project_id,
            sprint_id=sprint.id,
            task_id=task.id,
            added_after_start=True,
            estimate_at_add=task.estimate_hours,
        )
    )


def release_deleted(db: Session, project_id: UUID, task_ids: Sequence[UUID]) -> None:
    """Tasks being deleted leave their planned or active sprint; a closed one keeps them."""
    lock_sprints(db, project_id)
    rows = db.execute(
        select(Task, Sprint)
        .join(Sprint, Sprint.id == Task.sprint_id)
        .where(Task.id.in_(task_ids), Sprint.state != "closed")
        .execution_options(populate_existing=True)
    ).all()
    for task, sprint in rows:
        leave(db, sprint, task)
    if rows:
        db.flush()
        db.execute(
            update(Task).where(Task.id.in_([task.id for task, _ in rows])).values(sprint_id=None)
        )
