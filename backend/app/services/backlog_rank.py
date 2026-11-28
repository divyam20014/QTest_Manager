"""ADR-144: positions in a project's one backlog order.

A task's `backlog_rank` is an exact decimal. A new task goes to the end; a moved task takes
the exact midpoint of its new neighbours, so no other task is rewritten. Everything that
picks a rank holds the project's backlog lock until it commits.
"""

from decimal import Decimal, localcontext
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.task import Task

STEP = Decimal(1000)
# Enough digits for a midpoint to stay exact after thousands of moves into one gap.
_PRECISION = 2000


def lock_backlog(db: Session, project_id: UUID) -> None:
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"backlog:{project_id}"}
    )


def rank_at_end(db: Session, project_id: UUID, *, excluding: UUID | None = None) -> Decimal:
    """The caller holds the backlog lock."""
    query = select(func.max(Task.backlog_rank)).where(Task.project_id == project_id)
    if excluding is not None:
        query = query.where(Task.id != excluding)
    highest = db.execute(query.execution_options(include_deleted=True)).scalar_one()
    with localcontext() as context:
        context.prec = _PRECISION
        return STEP if highest is None else highest + STEP


def rank_before(db: Session, project_id: UUID, target: Task, *, excluding: UUID) -> Decimal:
    """Between `target` and whatever precedes it. The caller holds the backlog lock."""
    assert target.backlog_rank is not None
    previous = db.execute(
        select(func.max(Task.backlog_rank))
        .where(
            Task.project_id == project_id,
            Task.id != excluding,
            Task.backlog_rank < target.backlog_rank,
        )
        .execution_options(include_deleted=True)
    ).scalar_one()
    with localcontext() as context:
        context.prec = _PRECISION
        if previous is None:
            return target.backlog_rank - STEP
        return (previous + target.backlog_rank) / 2


def new_task_rank(db: Session, project_id: UUID) -> Decimal:
    lock_backlog(db, project_id)
    return rank_at_end(db, project_id)
