"""ADR-127: tasks and sub-tasks.

Hierarchy rules (the database enforces the structural ones, see models/task.py; this module
enforces them with friendly errors and owns the ones that need business context):

 1. A sub-task lives in its parent's project; nesting is capped at MAX_TASK_DEPTH + 1 levels.
 2. A task cannot be moved under itself or one of its own sub-tasks; moving a task moves its
    whole subtree and rewrites every descendant's depth (top-down, level by level).
 3. A task cannot be completed (``done`` category) while a sub-task is still open.
 4. A done task cannot receive an open sub-task, and a sub-task of a done task cannot be
    reopened: reopen the parent first.
 5. A sub-task's due date cannot be later than its parent's due date.
 6. A parent with live sub-tasks is deleted only with ``cascade`` (soft delete of the subtree);
    deleting detaches the requirements/defects that pointed at the removed tasks.
"""

from collections.abc import Collection
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.field_standards import DEFAULT_TASK_PRIORITY, DEFAULT_TASK_TYPE, MAX_TASK_DEPTH
from app.models.audit import AuditLog
from app.models.defect import Defect
from app.models.identity import User
from app.models.planning import Milestone, Sprint
from app.models.project import Project
from app.models.requirement import Requirement
from app.models.task import Task, TaskStatus, TaskTestCaseLink
from app.models.test_asset import Release
from app.models.test_case import TestCase
from app.schemas.task import (
    TaskCreateRequest,
    TaskDetailOut,
    TaskHistoryEntryOut,
    TaskLinkedTestCaseOut,
    TaskListResponse,
    TaskOut,
    TaskRef,
    TaskSummaryOut,
    TaskSummaryStatus,
    TaskUpdateRequest,
)
from app.services import (
    backlog_rank,
    dependency_links,
    display_id_service,
    field_option_service,
    lookups,
    sprint_membership,
    task_status_service,
)
from app.services.project_service import is_assigned

DEFAULT_PAGE_SIZE = 25
MAX_TREE_TASKS = 2000
_TRACKED = (
    "title",
    "description",
    "parent_task_id",
    "priority",
    "task_type",
    "estimate_hours",
    "assignee_id",
    "release_id",
    "milestone_id",
    "start_date",
    "due_date",
)


# --- access helpers -------------------------------------------------------------------------


def _fields_error(fields: dict[str, str]) -> ValidationAppError:
    return ValidationAppError("Invalid fields: " + ", ".join(fields), fields=fields)


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    """Same visibility rule as requirements and test cases (ADR-019): Admin/Manager see every
    project of the tenant, a Tester only the projects they are assigned to."""
    if role_code in ("admin", "manager") or is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _get_task_or_404(db: Session, tenant_id: UUID, task_id: UUID) -> Task:
    task = db.execute(
        select(Task).where(Task.tenant_id == tenant_id, Task.id == task_id)
    ).scalar_one_or_none()
    if task is None:
        raise NotFoundError("Task not found")
    return task


def get_task(db: Session, tenant_id: UUID, role_code: str, user_id: UUID, task_id: UUID) -> Task:
    task = _get_task_or_404(db, tenant_id, task_id)
    project = _get_project_or_404(db, tenant_id, task.project_id)
    _require_project_access(db, project, role_code, user_id)
    return task


def check_task_for_project(
    db: Session,
    tenant_id: UUID,
    project_id: UUID,
    task_id: UUID | None,
    errors: dict[str, str],
    field: str = "task_id",
) -> None:
    """For requirements and defects: the task must exist (not deleted) in the SAME project."""
    if task_id is None:
        return
    found = db.execute(
        select(Task.id).where(
            Task.tenant_id == tenant_id, Task.id == task_id, Task.project_id == project_id
        )
    ).scalar_one_or_none()
    if found is None:
        errors[field] = "task was not found in this project"


# --- subtree queries ------------------------------------------------------------------------

_SUBTREE_SQL = text(
    """
    WITH RECURSIVE sub AS (
        SELECT id, depth, deleted_at FROM tasks WHERE id = :root AND tenant_id = :tenant
        UNION ALL
        SELECT t.id, t.depth, t.deleted_at FROM tasks t JOIN sub s ON t.parent_task_id = s.id
    )
    SELECT id, depth, deleted_at FROM sub WHERE id <> :root ORDER BY depth, id
    """
)


def _descendants(db: Session, tenant_id: UUID, task_id: UUID) -> list[tuple[UUID, int, Any]]:
    """Every descendant (soft-deleted ones too -- their depth must stay consistent), nearest
    first. Raw SQL on purpose: it bypasses the soft-delete hook."""
    rows = db.execute(_SUBTREE_SQL, {"root": task_id, "tenant": tenant_id}).all()
    return [(r.id, r.depth, r.deleted_at) for r in rows]


_LIVE_SUBTREE_SQL = text(
    """
    WITH RECURSIVE sub AS (
        SELECT id FROM tasks WHERE id = :root AND tenant_id = :tenant AND deleted_at IS NULL
        UNION ALL
        SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id WHERE t.deleted_at IS NULL
    )
    SELECT id FROM sub
    """
)


def subtree_task_ids(db: Session, tenant_id: UUID, task_id: UUID) -> list[UUID]:
    """The task and every live sub-task below it (for roll-ups and "include sub-tasks" filters)."""
    return [r.id for r in db.execute(_LIVE_SUBTREE_SQL, {"root": task_id, "tenant": tenant_id})]


def get_task_history(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, task_id: UUID
) -> list[TaskHistoryEntryOut]:
    """Per-task activity timeline over the audit log (same shape as the requirement timeline)."""
    task = get_task(db, tenant_id, role_code, user_id, task_id)
    set_tenant_context(db, str(tenant_id))
    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "task",
            AuditLog.entity_id == task.id,
        )
        .order_by(AuditLog.created_at.asc())
    ).all()
    return [
        TaskHistoryEntryOut(
            id=log.id,
            action=log.action,
            user_id=log.user_id,
            user_name=user_name,
            event_metadata=log.event_metadata or {},
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def _ancestors(db: Session, task: Task) -> list[Task]:
    chain: list[Task] = []
    current = task
    while current.parent_task_id is not None:
        parent = db.execute(select(Task).where(Task.id == current.parent_task_id)).scalar_one()
        chain.append(parent)
        current = parent
    chain.reverse()
    return chain


def _subtree_height(descendants: list[tuple[UUID, int, Any]], root_depth: int) -> int:
    return max((depth - root_depth for _, depth, _ in descendants), default=0)


# --- validation -----------------------------------------------------------------------------


def _check_priority(db: Session, tenant_id: UUID, value: str, errors: dict[str, str]) -> None:
    try:
        field_option_service.validate_code(db, tenant_id, "task_priority", value)
    except ValidationAppError as exc:
        errors["priority"] = exc.message


def _check_type(db: Session, tenant_id: UUID, value: str, errors: dict[str, str]) -> None:
    try:
        field_option_service.validate_code(db, tenant_id, "task_type", value)
    except ValidationAppError as exc:
        errors["task_type"] = exc.message


def _default_type(db: Session, tenant_id: UUID) -> str:
    """ "Task", or the organization's first type if it has removed that one."""
    codes = [o.code for o in field_option_service.list_options(db, tenant_id, "task_type")]
    return DEFAULT_TASK_TYPE if DEFAULT_TASK_TYPE in codes or not codes else codes[0]


def check_project_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> None:
    """404 / 403 unless this user may see the project's tasks."""
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)


def _check_milestone(
    db: Session, tenant_id: UUID, project_id: UUID, value: UUID | None, errors: dict[str, str]
) -> None:
    """A task may join an open milestone of its own project."""
    if value is None:
        return
    milestone = db.execute(
        select(Milestone).where(
            Milestone.tenant_id == tenant_id,
            Milestone.id == value,
            Milestone.project_id == project_id,
        )
    ).scalar_one_or_none()
    if milestone is None:
        errors["milestone_id"] = "milestone_id is not a milestone of this project"
    elif milestone.completed_at is not None:
        errors["milestone_id"] = "That milestone is completed; reopen it to add tasks"


def _check_assignee(
    db: Session, project: Project, assignee_id: UUID | None, errors: dict[str, str]
) -> None:
    if assignee_id is None:
        return
    assignee = db.execute(select(User).where(User.id == assignee_id)).scalar_one_or_none()
    if assignee is None or assignee.tenant_id != project.tenant_id or not assignee.is_active:
        errors["assignee_id"] = "assignee_id must be an active user in this tenant"
    elif not is_assigned(db, project, assignee_id):
        errors["assignee_id"] = "assignee_id must be a member of this project"


def _check_release(
    db: Session, tenant_id: UUID, project_id: UUID, release_id: UUID | None, errors: dict[str, str]
) -> None:
    if release_id is None:
        return
    found = db.execute(
        select(Release.id).where(
            Release.tenant_id == tenant_id,
            Release.id == release_id,
            Release.project_id == project_id,
        )
    ).scalar_one_or_none()
    if found is None:
        errors["release_id"] = "release_id was not found in this project"


def _check_dates(
    start: date | None, due: date | None, parent: Task | None, errors: dict[str, str]
) -> None:
    if start is not None and due is not None and start > due:
        errors["due_date"] = "due_date cannot be before start_date"
    if parent is not None and due is not None and parent.due_date is not None:
        if due > parent.due_date:
            errors["due_date"] = (
                f"due_date cannot be later than the parent task's due date ({parent.due_date})"
            )


def _check_parent(
    db: Session,
    tenant_id: UUID,
    project_id: UUID,
    parent_id: UUID,
    errors: dict[str, str],
) -> Task | None:
    parent = db.execute(
        select(Task).where(Task.tenant_id == tenant_id, Task.id == parent_id)
    ).scalar_one_or_none()
    if parent is None or parent.project_id != project_id:
        errors["parent_task_id"] = "parent task was not found in this project"
        return None
    if parent.is_requirements_home:
        errors["parent_task_id"] = "The default task for requirements cannot have sub-tasks"
        return None
    return parent


REQUIREMENTS_HOME_TITLE = "Unassigned requirements"
REQUIREMENTS_HOME_DESCRIPTION = (
    "Requirements that are not part of a task yet. Open each one and move it to the task it "
    "belongs to."
)


def get_or_create_requirements_home(
    db: Session, tenant_id: UUID, project_id: UUID, actor_user_id: UUID
) -> Task:
    """The project's "Unassigned requirements" task (ADR-128), created on first need. A requirement
    always belongs to a task; this is where it goes when it is created without one or its task is
    deleted. Does not commit: the caller's transaction owns it."""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"requirements-home:{project_id}"},
    )
    home = db.execute(
        select(Task).where(
            Task.tenant_id == tenant_id,
            Task.project_id == project_id,
            Task.is_requirements_home,
        )
    ).scalar_one_or_none()
    if home is not None:
        return home
    status = task_status_service.get_default_status(db, tenant_id)
    display_seq, display_id = display_id_service.next_display_id(db, tenant_id, "task")
    home = Task(
        tenant_id=tenant_id,
        project_id=project_id,
        depth=0,
        display_seq=display_seq,
        display_id=display_id,
        title=REQUIREMENTS_HOME_TITLE,
        description=REQUIREMENTS_HOME_DESCRIPTION,
        status_id=status.id,
        priority=DEFAULT_TASK_PRIORITY,
        task_type=_default_type(db, tenant_id),
        backlog_rank=backlog_rank.new_task_rank(db, project_id),
        created_by=actor_user_id,
        is_requirements_home=True,
    )
    db.add(home)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.created",
        entity_type="task",
        entity_id=home.id,
        metadata={
            "title": home.title,
            "display_id": home.display_id,
            "project_id": str(project_id),
            "requirements_home": True,
        },
    )
    return home


def _category_of(db: Session, status_id: UUID) -> str:
    return db.execute(select(TaskStatus.category).where(TaskStatus.id == status_id)).scalar_one()


# --- serializers (constant number of queries per page) --------------------------------------


def to_out(db: Session, task: Task) -> TaskOut:
    return to_out_many(db, [task])[0]


def to_out_many(db: Session, tasks: list[Task]) -> list[TaskOut]:
    if not tasks:
        return []
    tenant_id = tasks[0].tenant_id
    set_tenant_context(db, str(tenant_id))
    ids = [t.id for t in tasks]

    statuses = {
        s.id: s
        for s in db.execute(
            select(TaskStatus).where(TaskStatus.id.in_({t.status_id for t in tasks}))
        ).scalars()
    }
    names = lookups.value_map(db, User.id, User.name, (t.assignee_id for t in tasks))

    child_rows = db.execute(
        select(
            Task.parent_task_id,
            func.count(Task.id),
            func.count(Task.id).filter(TaskStatus.category == "done"),
        )
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(Task.parent_task_id.in_(ids))
        .group_by(Task.parent_task_id)
    ).all()
    children = {pid: (total, done) for pid, total, done in child_rows}
    requirements = dict(
        db.execute(
            select(Requirement.task_id, func.count(Requirement.id))
            .where(Requirement.task_id.in_(ids))
            .group_by(Requirement.task_id)
        )
        .tuples()
        .all()
    )
    defects = dict(
        db.execute(
            select(Defect.task_id, func.count(Defect.id))
            .where(Defect.task_id.in_(ids))
            .group_by(Defect.task_id)
        )
        .tuples()
        .all()
    )
    cases = dict(
        db.execute(
            select(TaskTestCaseLink.task_id, func.count(TaskTestCaseLink.id))
            .join(TestCase, TestCase.id == TaskTestCaseLink.test_case_id)
            .where(TaskTestCaseLink.task_id.in_(ids))
            .group_by(TaskTestCaseLink.task_id)
        )
        .tuples()
        .all()
    )

    today = datetime.now(UTC).date()
    out: list[TaskOut] = []
    milestone_ids = {t.milestone_id for t in tasks if t.milestone_id}
    milestone_names: dict[UUID, str] = {}
    if milestone_ids:
        milestone_names = dict(
            db.execute(select(Milestone.id, Milestone.name).where(Milestone.id.in_(milestone_ids)))
            .tuples()
            .all()
        )
    sprint_ids = {t.sprint_id for t in tasks if t.sprint_id}
    sprint_names: dict[UUID, str] = {}
    if sprint_ids:
        sprint_names = dict(
            db.execute(select(Sprint.id, Sprint.name).where(Sprint.id.in_(sprint_ids)))
            .tuples()
            .all()
        )
    waiting = dependency_links.open_counts(db, ids)
    for task in tasks:
        status = statuses[task.status_id]
        total, done = children.get(task.id, (0, 0))
        out.append(
            TaskOut(
                id=task.id,
                project_id=task.project_id,
                parent_task_id=task.parent_task_id,
                depth=task.depth,
                display_id=task.display_id,
                title=task.title,
                description=task.description,
                status=task_status_service.to_ref(status),
                priority=task.priority,
                task_type=task.task_type,
                estimate_hours=task.estimate_hours,
                assignee_id=task.assignee_id,
                assignee_name=names.get(task.assignee_id),
                release_id=task.release_id,
                milestone_id=task.milestone_id,
                milestone_name=(
                    milestone_names.get(task.milestone_id) if task.milestone_id else None
                ),
                sprint_id=task.sprint_id,
                sprint_name=sprint_names.get(task.sprint_id) if task.sprint_id else None,
                start_date=task.start_date,
                due_date=task.due_date,
                completed_at=task.completed_at,
                is_overdue=(
                    task.due_date is not None
                    and task.due_date < today
                    and status.category != "done"
                ),
                created_by=task.created_by,
                is_requirements_home=task.is_requirements_home,
                created_at=task.created_at,
                updated_at=task.updated_at,
                sub_task_count=total,
                sub_tasks_done=done,
                requirement_count=requirements.get(task.id, 0),
                defect_count=defects.get(task.id, 0),
                test_case_count=cases.get(task.id, 0),
                open_dependency_count=waiting.get(task.id, 0),
            )
        )
    return out


def to_detail_out(db: Session, task: Task) -> TaskDetailOut:
    base = to_out(db, task)
    ancestors = [
        TaskRef(id=a.id, display_id=a.display_id, title=a.title, depth=a.depth)
        for a in _ancestors(db, task)
    ]
    sub_tasks = list(
        db.execute(
            select(Task)
            .where(Task.parent_task_id == task.id)
            .order_by(Task.display_seq, Task.created_at)
        ).scalars()
    )
    rows = db.execute(
        select(TaskTestCaseLink, TestCase)
        .join(TestCase, TestCase.id == TaskTestCaseLink.test_case_id)
        .where(TaskTestCaseLink.task_id == task.id)
        .order_by(TaskTestCaseLink.linked_at)
    ).all()
    return TaskDetailOut(
        **base.model_dump(),
        ancestors=ancestors,
        sub_tasks=to_out_many(db, sub_tasks),
        depends_on=dependency_links.depends_on(db, task.id),
        blocks=dependency_links.blocks(db, task.id),
        test_cases=[
            TaskLinkedTestCaseOut(
                test_case_id=case.id,
                display_id=case.display_id,
                title=case.title,
                status=case.status,
                linked_by=link.linked_by,
                linked_at=link.linked_at,
            )
            for link, case in rows
        ],
    )


# --- queries --------------------------------------------------------------------------------


def list_tasks(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    *,
    page: int,
    page_size: int,
    status_id: UUID | None = None,
    category: str | None = None,
    assignee_id: UUID | None = None,
    parent_task_id: UUID | None = None,
    root_only: bool = False,
    release_id: UUID | None = None,
    milestone_id: UUID | None = None,
    sprint_id: UUID | None = None,
    overdue: bool = False,
    q: str | None = None,
) -> TaskListResponse:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)

    query = select(Task).where(Task.tenant_id == tenant_id, Task.project_id == project_id)
    if status_id is not None:
        query = query.where(Task.status_id == status_id)
    if category is not None:
        query = query.join(TaskStatus, TaskStatus.id == Task.status_id).where(
            TaskStatus.category == category
        )
    if assignee_id is not None:
        query = query.where(Task.assignee_id == assignee_id)
    if parent_task_id is not None:
        query = query.where(Task.parent_task_id == parent_task_id)
    elif root_only:
        query = query.where(Task.parent_task_id.is_(None))
    if release_id is not None:
        query = query.where(Task.release_id == release_id)
    if milestone_id is not None:
        query = query.where(Task.milestone_id == milestone_id)
    if sprint_id is not None:
        query = query.where(Task.sprint_id == sprint_id)
    if overdue:
        done_ids = select(TaskStatus.id).where(TaskStatus.category == "done")
        query = query.where(
            Task.due_date < datetime.now(UTC).date(), Task.status_id.not_in(done_ids)
        )
    if q:
        needle = f"%{q.strip()}%"
        query = query.where(or_(Task.title.ilike(needle), Task.display_id.ilike(needle)))

    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    rows = db.execute(
        query.order_by(Task.display_seq.desc().nulls_last(), Task.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars()
    return TaskListResponse(items=to_out_many(db, list(rows)), total=total)


def project_summary(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> TaskSummaryOut:
    """Counts for the project Overview widget: by status and category, what is overdue or due
    soon, what has nobody on it, and what finished in the last week."""
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)
    today = datetime.now(UTC).date()
    soon = today + timedelta(days=7)
    week_ago = datetime.now(UTC) - timedelta(days=7)

    per_status = {
        status_id: count
        for status_id, count in db.execute(
            select(Task.status_id, func.count(Task.id))
            .where(Task.tenant_id == tenant_id, Task.project_id == project_id)
            .group_by(Task.status_id)
        )
    }
    statuses = list(
        db.execute(
            select(TaskStatus)
            .where(TaskStatus.tenant_id == tenant_id)
            .order_by(TaskStatus.sort_order, TaskStatus.label)
        ).scalars()
    )
    by_category = {"todo": 0, "in_progress": 0, "done": 0}
    for s in statuses:
        by_category[s.category] += per_status.get(s.id, 0)
    total = sum(per_status.values())

    not_done = Task.status_id.in_(select(TaskStatus.id).where(TaskStatus.category != "done"))
    scope = [Task.tenant_id == tenant_id, Task.project_id == project_id]
    overdue, due_soon, unassigned, top_level, finished = db.execute(
        select(
            func.count(Task.id).filter(not_done, Task.due_date < today),
            func.count(Task.id).filter(not_done, Task.due_date >= today, Task.due_date <= soon),
            func.count(Task.id).filter(not_done, Task.assignee_id.is_(None)),
            func.count(Task.id).filter(Task.parent_task_id.is_(None)),
            func.count(Task.id).filter(Task.completed_at >= week_ago),
        ).where(*scope)
    ).one()

    return TaskSummaryOut(
        project_id=project_id,
        total=total,
        top_level=top_level,
        sub_tasks=total - top_level,
        todo=by_category["todo"],
        in_progress=by_category["in_progress"],
        done=by_category["done"],
        progress_percent=round(100 * by_category["done"] / total) if total else 0,
        overdue=overdue,
        due_next_7_days=due_soon,
        unassigned_open=unassigned,
        completed_last_7_days=finished,
        by_status=[
            TaskSummaryStatus(
                status_id=s.id,
                code=s.code,
                label=s.label,
                category=s.category,  # type: ignore[arg-type]
                color=s.color,
                count=per_status.get(s.id, 0),
            )
            for s in statuses
        ],
    )


def list_project_tree(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> TaskListResponse:
    """Every task of the project, parents before children, for building the tree client side.

    At most MAX_TREE_TASKS are sent; `total` is how many the project really has, so a client can
    say when the tree is incomplete instead of silently dropping tasks."""
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)
    total = db.execute(
        select(func.count(Task.id)).where(
            Task.tenant_id == tenant_id, Task.project_id == project_id
        )
    ).scalar_one()
    rows = list(
        db.execute(
            select(Task)
            .where(Task.tenant_id == tenant_id, Task.project_id == project_id)
            .order_by(Task.depth, Task.display_seq, Task.created_at)
            .limit(MAX_TREE_TASKS)
        ).scalars()
    )
    return TaskListResponse(items=to_out_many(db, rows), total=total)


# --- create ---------------------------------------------------------------------------------


def create_task(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: TaskCreateRequest,
) -> Task:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    errors: dict[str, str] = {}

    parent: Task | None = None
    depth = 0
    if req.parent_task_id is not None:
        parent = _check_parent(db, tenant_id, project_id, req.parent_task_id, errors)
        if parent is not None:
            depth = parent.depth + 1
            if depth > MAX_TASK_DEPTH:
                errors["parent_task_id"] = (
                    f"Tasks can be nested at most {MAX_TASK_DEPTH + 1} levels deep"
                )

    if req.status_id is not None:
        status = db.execute(
            select(TaskStatus).where(
                TaskStatus.tenant_id == tenant_id, TaskStatus.id == req.status_id
            )
        ).scalar_one_or_none()
        if status is None:
            errors["status_id"] = "status_id is not a task status of this tenant"
    else:
        status = task_status_service.get_default_status(db, tenant_id)
    if parent is not None and status is not None and status.category != "done":
        if _category_of(db, parent.status_id) == "done":
            errors["parent_task_id"] = (
                "The parent task is done; reopen it before adding an open sub-task"
            )

    priority = req.priority or DEFAULT_TASK_PRIORITY
    _check_priority(db, tenant_id, priority, errors)
    task_type = req.task_type or _default_type(db, tenant_id)
    _check_type(db, tenant_id, task_type, errors)
    _check_assignee(db, project, req.assignee_id, errors)
    _check_release(db, tenant_id, project_id, req.release_id, errors)
    _check_milestone(db, tenant_id, project_id, req.milestone_id, errors)
    _check_dates(req.start_date, req.due_date, parent, errors)
    if errors:
        raise _fields_error(errors)
    assert status is not None

    display_seq, display_id = display_id_service.next_display_id(db, tenant_id, "task")
    task = Task(
        tenant_id=tenant_id,
        project_id=project_id,
        parent_task_id=parent.id if parent else None,
        depth=depth,
        display_seq=display_seq,
        display_id=display_id,
        title=req.title.strip(),
        description=req.description,
        status_id=status.id,
        priority=priority,
        task_type=task_type,
        estimate_hours=req.estimate_hours,
        backlog_rank=backlog_rank.new_task_rank(db, project_id),
        assignee_id=req.assignee_id,
        release_id=req.release_id,
        milestone_id=req.milestone_id,
        start_date=req.start_date,
        due_date=req.due_date,
        completed_at=datetime.now(UTC) if status.category == "done" else None,
        created_by=actor_user_id,
    )
    db.add(task)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.created",
        entity_type="task",
        entity_id=task.id,
        metadata={
            "title": task.title,
            "display_id": task.display_id,
            "project_id": str(project_id),
            "parent_task_id": str(parent.id) if parent else None,
        },
    )
    db.commit()
    return task


# --- update / move --------------------------------------------------------------------------


def _snapshot(task: Task) -> dict[str, Any]:
    return {name: getattr(task, name) for name in _TRACKED}


def _move(db: Session, tenant_id: UUID, task: Task, new_parent: Task | None) -> None:
    """Re-parent `task` with its subtree. The database checks each row against its parent's
    depth, so rows are rewritten parent-first: the task, then each descendant level in turn."""
    descendants = _descendants(db, tenant_id, task.id)
    new_depth = 0 if new_parent is None else new_parent.depth + 1
    if new_parent is not None and new_parent.id == task.id:
        raise ConflictError("A task cannot be its own parent")
    if new_parent is not None and any(d_id == new_parent.id for d_id, _, _ in descendants):
        raise ConflictError("A task cannot be moved under one of its own sub-tasks")
    if new_depth + _subtree_height(descendants, task.depth) > MAX_TASK_DEPTH:
        raise ConflictError(
            f"Moving this task would nest its sub-tasks deeper than {MAX_TASK_DEPTH + 1} levels"
        )
    delta = new_depth - task.depth
    task.parent_task_id = new_parent.id if new_parent else None
    task.depth = new_depth
    db.flush()
    if delta != 0:
        levels: dict[int, list[UUID]] = {}
        for d_id, depth, _ in descendants:
            levels.setdefault(depth, []).append(d_id)
        for depth in sorted(levels):
            db.execute(
                update(Task).where(Task.id.in_(levels[depth])).values(depth=Task.depth + delta)
            )
            db.flush()


def update_task(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    req: TaskUpdateRequest,
) -> Task:
    task = get_task(db, tenant_id, role_code, actor_user_id, task_id)
    project = _get_project_or_404(db, tenant_id, task.project_id)
    changes = req.model_dump(exclude_unset=True)
    before = _snapshot(task)
    errors: dict[str, str] = {}

    if "title" in changes:
        if req.title is None:
            errors["title"] = "Title cannot be cleared"
        else:
            task.title = req.title.strip()
    if "description" in changes:
        task.description = req.description
    if "priority" in changes:
        if req.priority is None:
            errors["priority"] = "Priority cannot be cleared"
        elif req.priority != task.priority:
            _check_priority(db, tenant_id, req.priority, errors)
            if "priority" not in errors:
                task.priority = req.priority
    if "task_type" in changes:
        if req.task_type is None:
            errors["task_type"] = "Type cannot be cleared"
        elif req.task_type != task.task_type:
            _check_type(db, tenant_id, req.task_type, errors)
            if "task_type" not in errors:
                task.task_type = req.task_type
    if "estimate_hours" in changes:
        task.estimate_hours = req.estimate_hours
    if "assignee_id" in changes:
        _check_assignee(db, project, req.assignee_id, errors)
        if "assignee_id" not in errors:
            task.assignee_id = req.assignee_id
    # Saving the milestone a task already has is never refused.
    if "milestone_id" in changes and req.milestone_id != task.milestone_id:
        _check_milestone(db, tenant_id, task.project_id, req.milestone_id, errors)
        if "milestone_id" not in errors:
            task.milestone_id = req.milestone_id
    if "release_id" in changes:
        _check_release(db, tenant_id, task.project_id, req.release_id, errors)
        if "release_id" not in errors:
            task.release_id = req.release_id

    new_parent: Task | None = None
    moving = "parent_task_id" in changes and req.parent_task_id != task.parent_task_id
    if moving and task.is_requirements_home:
        raise ConflictError("The default task for requirements cannot be moved")
    if moving and req.parent_task_id is not None:
        new_parent = _check_parent(db, tenant_id, task.project_id, req.parent_task_id, errors)
        if (
            new_parent is not None
            and _category_of(db, task.status_id) != "done"
            and _category_of(db, new_parent.status_id) == "done"
        ):
            errors["parent_task_id"] = (
                "The new parent task is done; reopen it before adding an open sub-task"
            )

    start = changes["start_date"] if "start_date" in changes else task.start_date
    due = changes["due_date"] if "due_date" in changes else task.due_date
    effective_parent: Task | None
    if moving:
        effective_parent = new_parent
    elif task.parent_task_id is not None:
        effective_parent = db.execute(
            select(Task).where(Task.id == task.parent_task_id)
        ).scalar_one_or_none()
    else:
        effective_parent = None
    if "start_date" in changes or "due_date" in changes or moving:
        _check_dates(start, due, effective_parent, errors)
    if "due_date" in changes and req.due_date is not None:
        latest_child = db.execute(
            select(func.max(Task.due_date)).where(Task.parent_task_id == task.id)
        ).scalar_one()
        if latest_child is not None and req.due_date < latest_child:
            errors["due_date"] = (
                f"due_date cannot be earlier than a sub-task's due date ({latest_child})"
            )
    if errors:
        db.rollback()
        raise _fields_error(errors)

    if "start_date" in changes:
        task.start_date = req.start_date
    if "due_date" in changes:
        task.due_date = req.due_date
    if moving:
        _move(db, tenant_id, task, new_parent)

    diff = audit_diff(before, _snapshot(task))
    if diff:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="task.moved" if "parent_task_id" in diff else "task.updated",
            entity_type="task",
            entity_id=task.id,
            metadata={"fields": sorted(diff), "changes": diff},
        )
    db.commit()
    return task


# --- status ---------------------------------------------------------------------------------


def change_status(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    status_id: UUID,
    *,
    permissions: Collection[str],
) -> Task:
    task = get_task(db, tenant_id, role_code, actor_user_id, task_id)
    # `task.transition` lets a Tester move the tasks assigned to them; `task.manage` moves any.
    if "task.manage" not in permissions and task.assignee_id != actor_user_id:
        raise ForbiddenError("Only the assignee can change the status of this task")
    target = task_status_service.get_status_or_404(db, tenant_id, status_id)
    if target.id == task.status_id:
        return task
    current_category = _category_of(db, task.status_id)

    if target.category == "done":
        open_children = db.execute(
            select(func.count(Task.id))
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(Task.parent_task_id == task.id, TaskStatus.category != "done")
        ).scalar_one()
        if open_children:
            raise ConflictError(
                f"{open_children} sub-task(s) are not done; complete them before this task"
            )
    elif current_category == "done" and task.parent_task_id is not None:
        parent_status = db.execute(
            select(Task.status_id).where(Task.id == task.parent_task_id)
        ).scalar_one()
        if _category_of(db, parent_status) == "done":
            raise ConflictError("The parent task is done; reopen it before reopening this sub-task")

    before_status = task.status_id
    task.status_id = target.id
    task.completed_at = datetime.now(UTC) if target.category == "done" else None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.status_changed",
        entity_type="task",
        entity_id=task.id,
        metadata={
            "from": str(before_status),
            "to": str(target.id),
            "from_category": current_category,
            "to_category": target.category,
            "to_code": target.code,
        },
    )
    db.commit()
    return task


# --- delete ---------------------------------------------------------------------------------


def delete_task(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    *,
    cascade: bool = False,
) -> int:
    """Soft-delete a task. Returns how many tasks were removed (the task plus its subtree)."""
    task = get_task(db, tenant_id, role_code, actor_user_id, task_id)
    if task.is_requirements_home:
        raise ConflictError(
            "This is the default task for requirements and cannot be deleted; "
            "move its requirements to another task instead"
        )
    live_children = [
        (d_id, depth)
        for d_id, depth, deleted_at in _descendants(db, tenant_id, task.id)
        if deleted_at is None
    ]
    if live_children and not cascade:
        raise ConflictError(
            f"This task has {len(live_children)} sub-task(s); delete them too with cascade=true"
        )
    removed_ids = [task.id, *[d_id for d_id, _ in live_children]]
    sprint_membership.release_deleted(db, task.project_id, removed_ids)
    dependency_links.remove_all(db, task.project_id, removed_ids)
    now = datetime.now(UTC)
    # Requirements and defects stay. A defect just loses its task; a requirement always has one,
    # so it moves to the project's "Unassigned requirements" task.
    holds_requirements = db.execute(
        select(func.count(Requirement.id)).where(Requirement.task_id.in_(removed_ids))
    ).scalar_one()
    if holds_requirements:
        home = get_or_create_requirements_home(db, tenant_id, task.project_id, actor_user_id)
        db.execute(
            update(Requirement).where(Requirement.task_id.in_(removed_ids)).values(task_id=home.id)
        )
    db.execute(update(Defect).where(Defect.task_id.in_(removed_ids)).values(task_id=None))
    db.query(TaskTestCaseLink).filter(TaskTestCaseLink.task_id.in_(removed_ids)).delete(
        synchronize_session=False
    )
    db.execute(update(Task).where(Task.id.in_(removed_ids)).values(deleted_at=now))
    for removed_id in removed_ids:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="task.deleted",
            entity_type="task",
            entity_id=removed_id,
            metadata={
                "title": task.title if removed_id == task.id else None,
                "root_task_id": str(task.id),
                "cascade": bool(live_children),
            },
        )
    db.commit()
    return len(removed_ids)


# --- test case links ------------------------------------------------------------------------


def link_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    test_case_id: UUID,
) -> Task:
    task = get_task(db, tenant_id, role_code, actor_user_id, task_id)
    case = db.execute(
        select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    ).scalar_one_or_none()
    if case is None:
        raise NotFoundError("Test case not found")
    if case.project_id != task.project_id:
        raise ConflictError("Test case belongs to a different project than the task")
    exists = db.execute(
        select(TaskTestCaseLink.id).where(
            TaskTestCaseLink.task_id == task.id, TaskTestCaseLink.test_case_id == case.id
        )
    ).scalar_one_or_none()
    if exists is not None:
        return task
    db.add(
        TaskTestCaseLink(
            tenant_id=tenant_id, task_id=task.id, test_case_id=case.id, linked_by=actor_user_id
        )
    )
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.test_case_linked",
        entity_type="task",
        entity_id=task.id,
        metadata={"test_case_id": str(case.id), "test_case_display_id": case.display_id},
    )
    db.commit()
    return task


def unlink_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    task_id: UUID,
    test_case_id: UUID,
) -> Task:
    task = get_task(db, tenant_id, role_code, actor_user_id, task_id)
    link = db.execute(
        select(TaskTestCaseLink).where(
            TaskTestCaseLink.task_id == task.id, TaskTestCaseLink.test_case_id == test_case_id
        )
    ).scalar_one_or_none()
    if link is None:
        raise NotFoundError("That test case is not linked to this task")
    db.delete(link)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task.test_case_unlinked",
        entity_type="task",
        entity_id=task.id,
        metadata={"test_case_id": str(test_case_id)},
    )
    db.commit()
    return task
