"""ADR-146: sprints.

planned -> active -> closed. While planned, a sprint's tasks are simply those pointing at it.
Starting writes a history row for each, and from then on the history says what was planned,
added and removed; closing records what was done and freezes it. Finished tasks stay with the
closed sprint, unfinished ones go where whoever closes it chooses.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.models.identity import User
from app.models.planning import Sprint, SprintTaskHistory
from app.models.task import Task, TaskStatus
from app.schemas.planning import (
    SprintCreateRequest,
    SprintDetailOut,
    SprintOut,
    SprintTaskOut,
    SprintTotal,
    SprintTotals,
    SprintUpdateRequest,
)
from app.services import lookups, task_service, task_status_service
from app.services.sprint_membership import history_row, join, leave, lock_sprints

_NAME_TAKEN = "This project already has a sprint with that name"
_TRACKED = ("name", "goal", "start_date", "end_date")
_NO_HOURS = Decimal("0.00")


def _get_or_404(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, sprint_id: UUID
) -> Sprint:
    sprint = db.execute(
        select(Sprint).where(Sprint.tenant_id == tenant_id, Sprint.id == sprint_id)
    ).scalar_one_or_none()
    if sprint is None:
        raise NotFoundError("Sprint not found")
    task_service.check_project_access(db, tenant_id, role_code, user_id, sprint.project_id)
    return sprint


def _get_locked(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, sprint_id: UUID
) -> Sprint:
    """The sprint as it is once no one else can change it."""
    sprint = _get_or_404(db, tenant_id, role_code, user_id, sprint_id)
    lock_sprints(db, sprint.project_id)
    current = db.execute(
        select(Sprint).where(Sprint.id == sprint.id).execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if current is None:
        raise NotFoundError("Sprint not found")
    return current


def _check_name_free(db: Session, project_id: UUID, name: str, own_id: UUID | None) -> None:
    query = select(Sprint.id).where(
        Sprint.project_id == project_id, func.lower(Sprint.name) == name.lower()
    )
    if own_id is not None:
        query = query.where(Sprint.id != own_id)
    if db.execute(query).first() is not None:
        raise ConflictError(_NAME_TAKEN)


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:  # two requests took the same name at once
        db.rollback()
        raise ConflictError(_NAME_TAKEN) from exc


def _audit(
    db: Session, sprint: Sprint, actor_user_id: UUID, action: str, metadata: dict[str, object]
) -> None:
    record_audit_event(
        db,
        tenant_id=sprint.tenant_id,
        user_id=actor_user_id,
        action=action,
        entity_type="sprint",
        entity_id=sprint.id,
        metadata={"name": sprint.name, "project_id": str(sprint.project_id), **metadata},
    )


# --- reading ---------------------------------------------------------------------------------


def to_out_many(db: Session, sprints: list[Sprint]) -> list[SprintOut]:
    # (task count, done count, hours, done hours) per sprint.
    numbers: dict[UUID, tuple[int, int, Decimal, Decimal]] = {}
    open_ids = [s.id for s in sprints if s.state != "closed"]
    closed_ids = [s.id for s in sprints if s.state == "closed"]
    if open_ids:
        done = TaskStatus.category == "done"
        rows = db.execute(
            select(
                Task.sprint_id,
                func.count(Task.id),
                func.count(Task.id).filter(done),
                func.sum(Task.estimate_hours),
                func.sum(case((done, Task.estimate_hours))),
            )
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(Task.sprint_id.in_(open_ids))
            .group_by(Task.sprint_id)
        )
        for sprint_id, count, done_count, hours, done_hours in rows:
            numbers[sprint_id] = (count, done_count, hours, done_hours)
    if closed_ids:
        history = SprintTaskHistory
        finished = history.done_at_close.is_(True)
        rows = db.execute(
            select(
                history.sprint_id,
                func.count(history.id),
                func.count(history.id).filter(finished),
                func.sum(history.estimate_at_end),
                func.sum(case((finished, history.estimate_at_end))),
            )
            .where(history.sprint_id.in_(closed_ids), history.removed_at.is_(None))
            .group_by(history.sprint_id)
        )
        for sprint_id, count, done_count, hours, done_hours in rows:
            numbers[sprint_id] = (count, done_count, hours, done_hours)
    result = []
    for s in sprints:
        count, done_count, hours, done_hours = numbers.get(s.id, (0, 0, None, None))
        result.append(
            SprintOut(
                id=s.id,
                project_id=s.project_id,
                name=s.name,
                goal=s.goal,
                start_date=s.start_date,
                end_date=s.end_date,
                state=s.state,  # type: ignore[arg-type]
                started_at=s.started_at,
                closed_at=s.closed_at,
                task_count=count,
                done_count=done_count,
                estimate_hours=Decimal(hours or 0).quantize(_NO_HOURS),
                done_estimate_hours=Decimal(done_hours or 0).quantize(_NO_HOURS),
            )
        )
    return result


def list_sprints(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> list[SprintOut]:
    """The active sprint, then the planned ones soonest first, then closed ones latest first."""
    task_service.check_project_access(db, tenant_id, role_code, user_id, project_id)
    sprints = db.execute(
        select(Sprint)
        .where(Sprint.tenant_id == tenant_id, Sprint.project_id == project_id)
        .order_by(
            case((Sprint.state == "active", 0), (Sprint.state == "planned", 1), else_=2),
            Sprint.closed_at.desc().nulls_last(),
            Sprint.start_date,
            func.lower(Sprint.name),
        )
    ).scalars()
    return to_out_many(db, list(sprints))


def _task_rows(db: Session, sprint: Sprint) -> list[tuple[Task, SprintTaskHistory | None]]:
    if sprint.state == "planned":
        tasks = db.execute(
            select(Task)
            .where(Task.sprint_id == sprint.id)
            .order_by(Task.backlog_rank.asc().nulls_last(), Task.id)
        ).scalars()
        return [(task, None) for task in tasks]
    rows = db.execute(
        select(Task, SprintTaskHistory)
        .join(SprintTaskHistory, SprintTaskHistory.task_id == Task.id)
        .where(SprintTaskHistory.sprint_id == sprint.id)
        .order_by(Task.backlog_rank.asc().nulls_last(), Task.id)
        # A task deleted since is still part of what the sprint did.
        .execution_options(include_deleted=True)
    )
    return [(task, row) for task, row in rows]


def _total(tasks: list[tuple[SprintTaskOut, Decimal | None]]) -> SprintTotal:
    hours = sum((h for _, h in tasks if h is not None), _NO_HOURS)
    return SprintTotal(count=len(tasks), hours=hours.quantize(_NO_HOURS))


def _detail(db: Session, sprint: Sprint) -> SprintDetailOut:
    rows = _task_rows(db, sprint)
    statuses = {
        s.id: s
        for s in db.execute(
            select(TaskStatus).where(TaskStatus.id.in_({t.status_id for t, _ in rows}))
        ).scalars()
    }
    names = lookups.value_map(db, User.id, User.name, (t.assignee_id for t, _ in rows))
    items: list[SprintTaskOut] = []
    # The hours the task had when it was planned or added, for those two totals.
    at_start: list[tuple[SprintTaskOut, Decimal | None]] = []
    for task, row in rows:
        status = statuses[task.status_id]
        removed = row is not None and row.removed_at is not None
        if removed:
            assert row is not None
            done, hours = False, row.estimate_at_end
        elif sprint.state == "closed":
            assert row is not None
            done, hours = bool(row.done_at_close), row.estimate_at_end
        else:
            done, hours = status.category == "done", task.estimate_hours
        item = SprintTaskOut(
            task_id=task.id,
            display_id=task.display_id,
            title=task.title,
            status=task_status_service.to_ref(status),
            assignee_name=names.get(task.assignee_id),
            deleted=task.deleted_at is not None,
            added_after_start=row.added_after_start if row else False,
            removed_at=row.removed_at if row else None,
            done=done,
            estimate_hours=hours,
        )
        items.append(item)
        at_start.append((item, row.estimate_at_add if row else task.estimate_hours))
    held = [(i, i.estimate_hours) for i in items if i.removed_at is None]
    totals = SprintTotals(
        planned=_total([(i, h) for i, h in at_start if not i.added_after_start]),
        added=_total([(i, h) for i, h in at_start if i.added_after_start]),
        removed=_total([(i, i.estimate_hours) for i in items if i.removed_at is not None]),
        completed=_total([(i, h) for i, h in held if i.done]),
        unfinished=_total([(i, h) for i, h in held if not i.done]),
    )
    base = to_out_many(db, [sprint])[0]
    return SprintDetailOut(**base.model_dump(), totals=totals, tasks=items)


def get_sprint(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, sprint_id: UUID
) -> SprintDetailOut:
    return _detail(db, _get_or_404(db, tenant_id, role_code, user_id, sprint_id))


# --- changing a sprint -----------------------------------------------------------------------


def create_sprint(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: SprintCreateRequest,
) -> SprintOut:
    task_service.check_project_access(db, tenant_id, role_code, actor_user_id, project_id)
    _check_name_free(db, project_id, req.name, None)
    sprint = Sprint(
        tenant_id=tenant_id,
        project_id=project_id,
        name=req.name,
        goal=req.goal,
        start_date=req.start_date,
        end_date=req.end_date,
        state="planned",
    )
    db.add(sprint)
    _flush(db)
    _audit(db, sprint, actor_user_id, "sprint.created", {})
    out = to_out_many(db, [sprint])[0]
    db.commit()
    return out


def update_sprint(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    sprint_id: UUID,
    req: SprintUpdateRequest,
) -> SprintOut:
    sprint = _get_locked(db, tenant_id, role_code, actor_user_id, sprint_id)
    if sprint.state == "closed":
        raise ConflictError("A closed sprint cannot be changed")
    before = {name: getattr(sprint, name) for name in _TRACKED}
    changes = req.model_dump(exclude_unset=True)
    start = changes.get("start_date", sprint.start_date)
    end = changes.get("end_date", sprint.end_date)
    if end < start:
        raise ValidationAppError(
            "Invalid fields: end_date", fields={"end_date": "end_date cannot be before start_date"}
        )
    if "name" in changes and changes["name"] != sprint.name:
        _check_name_free(db, sprint.project_id, changes["name"], sprint.id)
    for name, value in changes.items():
        setattr(sprint, name, value)
    _flush(db)
    diff = audit_diff(before, {name: getattr(sprint, name) for name in _TRACKED})
    if diff:
        _audit(db, sprint, actor_user_id, "sprint.updated", {"changes": diff})
    out = to_out_many(db, [sprint])[0]
    db.commit()
    return out


def delete_sprint(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, sprint_id: UUID
) -> None:
    """Only a sprint that never started: one that has is part of the project's history."""
    sprint = _get_locked(db, tenant_id, role_code, actor_user_id, sprint_id)
    if sprint.state != "planned":
        raise ConflictError("Only a sprint that has not started can be deleted")
    db.execute(update(Task).where(Task.sprint_id == sprint.id).values(sprint_id=None))
    _audit(db, sprint, actor_user_id, "sprint.deleted", {})
    db.delete(sprint)
    db.commit()


def start_sprint(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, sprint_id: UUID
) -> SprintDetailOut:
    sprint = _get_locked(db, tenant_id, role_code, actor_user_id, sprint_id)
    if sprint.state != "planned":
        raise ConflictError(f"This sprint is already {sprint.state}")
    running = db.execute(
        select(Sprint.name).where(Sprint.project_id == sprint.project_id, Sprint.state == "active")
    ).scalar_one_or_none()
    if running is not None:
        raise ConflictError(f"Close the active sprint “{running}” before starting another")
    sprint.state = "active"
    sprint.started_at = datetime.now(UTC)
    tasks = list(db.execute(select(Task).where(Task.sprint_id == sprint.id)).scalars())
    db.add_all(
        SprintTaskHistory(
            tenant_id=tenant_id,
            project_id=sprint.project_id,
            sprint_id=sprint.id,
            task_id=task.id,
            added_after_start=False,
            estimate_at_add=task.estimate_hours,
        )
        for task in tasks
    )
    db.flush()
    _audit(db, sprint, actor_user_id, "sprint.started", {"task_count": len(tasks)})
    out = _detail(db, sprint)
    db.commit()
    return out


def close_sprint(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    sprint_id: UUID,
    move_unfinished_to: UUID | None,
) -> SprintDetailOut:
    sprint = _get_locked(db, tenant_id, role_code, actor_user_id, sprint_id)
    if sprint.state != "active":
        raise ConflictError("Only the active sprint can be closed")
    target: Sprint | None = None
    if move_unfinished_to is not None:
        target = db.execute(
            select(Sprint)
            .where(
                Sprint.tenant_id == tenant_id,
                Sprint.id == move_unfinished_to,
                Sprint.project_id == sprint.project_id,
                Sprint.state == "planned",
            )
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if target is None:
            message = "Choose a planned sprint of this project, or the backlog"
            raise ValidationAppError(message, fields={"move_unfinished_to": message})

    members = db.execute(
        select(Task, TaskStatus.category)
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(Task.sprint_id == sprint.id)
        # Lock the rows, so a status cannot change between being counted and being moved.
        .with_for_update(of=Task)
        .execution_options(populate_existing=True)
    ).all()
    unfinished: list[UUID] = []
    for task, category in members:
        row = history_row(db, sprint.id, task.id)
        assert row is not None
        row.done_at_close = category == "done"
        row.estimate_at_end = task.estimate_hours
        if category != "done":
            unfinished.append(task.id)
    sprint.state = "closed"
    sprint.closed_at = datetime.now(UTC)
    db.flush()
    if unfinished:
        db.execute(
            update(Task)
            .where(Task.id.in_(unfinished))
            .values(sprint_id=target.id if target else None)
        )
    _audit(
        db,
        sprint,
        actor_user_id,
        "sprint.closed",
        {
            "done_count": len(members) - len(unfinished),
            "unfinished_count": len(unfinished),
            "moved_to": str(target.id) if target else "backlog",
        },
    )
    out = _detail(db, sprint)
    db.commit()
    return out


# --- membership ------------------------------------------------------------------------------


def set_task_sprint(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    sprint_id: UUID | None,
) -> Task:
    task = task_service.get_task(db, tenant_id, role_code, actor_user_id, task_id)
    lock_sprints(db, task.project_id)
    locked = db.execute(
        select(Task)
        .where(Task.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if locked is None:  # deleted while we waited for the lock
        raise NotFoundError("Task not found")
    task = locked
    current = (
        db.execute(
            select(Sprint)
            .where(Sprint.id == task.sprint_id)
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if task.sprint_id
        else None
    )
    if sprint_id == task.sprint_id:
        return task

    target: Sprint | None = None
    if sprint_id is not None:
        target = db.execute(
            select(Sprint)
            .where(
                Sprint.tenant_id == tenant_id,
                Sprint.id == sprint_id,
                Sprint.project_id == task.project_id,
            )
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        problem = None
        if target is None:
            problem = "That sprint is not a sprint of this task's project"
        elif target.state == "closed":
            problem = "That sprint is closed"
        elif task.is_requirements_home:
            problem = "The default task for requirements cannot be planned"
        elif (
            db.execute(
                select(TaskStatus.category).where(TaskStatus.id == task.status_id)
            ).scalar_one()
            == "done"
        ):
            problem = "A finished task cannot join a sprint; reopen it first"
        if problem:
            raise ValidationAppError(problem, fields={"sprint_id": problem})
    elif current is not None and current.state == "closed":
        raise ConflictError("A closed sprint keeps the tasks that were finished in it")

    if current is not None:
        leave(db, current, task)
    task.sprint_id = target.id if target else None
    if target is not None:
        join(db, target, task)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.sprint_changed",
        entity_type="task",
        entity_id=task.id,
        metadata={
            "from_sprint_id": str(current.id) if current else None,
            "to_sprint_id": str(target.id) if target else None,
            "to_sprint": target.name if target else None,
        },
    )
    db.commit()
    return task
