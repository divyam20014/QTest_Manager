"""My Work: the signed-in user's own pending work, read-only.

Nothing here is stored. Every row is derived from existing assignments:
  * run cases: `test_run_cases.assigned_to` = me, in a run that is not finished or
    deleted, with a status that still needs attention (pending, in progress, failed
    or blocked; passed and ignored cases are done);
  * reviews: test cases in `ready_for_review` whose `reviewer_id` is me;
  * tasks: tasks (and sub-tasks) assigned to me whose status category is not "done".

Project visibility is the same rule the run and test case lists use (Admin and
Manager see every project; anyone else only projects they own or belong to), and a
scoped Tester (ADR-093) additionally only sees the test cases that scope allows.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.models.execution import TestRun, TestRunCase
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskStatus
from app.models.test_case import TestCase
from app.schemas.my_work import (
    MyReviewListResponse,
    MyReviewOut,
    MyRunCaseListResponse,
    MyRunCaseOut,
    MyTaskListResponse,
    MyTaskOut,
    MyWorkSummaryOut,
)
from app.services import task_status_service, tester_visibility

OPEN_RUN_CASE_STATUSES = ("pending", "in_progress", "failed", "blocked")
MAX_ITEMS = 200

# In-progress work first, then failures to retest, then blocked, then not yet started.
_STATUS_ORDER = {"in_progress": 0, "failed": 1, "blocked": 2, "pending": 3}


def _visible_projects_clause(tenant_id: UUID, role_code: str, user_id: UUID, column):
    if role_code in ("admin", "manager"):
        return None
    owned = select(Project.id).where(Project.tenant_id == tenant_id, Project.owner_id == user_id)
    member_of = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
    return or_(column.in_(owned), column.in_(member_of))


def _run_case_query(
    tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID | None = None
) -> Select:
    query = (
        select(TestRunCase, TestRun, Project.name, TestCase.title, TestCase.display_id)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(Project, Project.id == TestRun.project_id)
        .join(TestCase, TestCase.id == TestRunCase.test_case_id)
        .where(
            # ADR-140: nothing in an archived project is pending work.
            Project.archived_at.is_(None),
            TestRunCase.tenant_id == tenant_id,
            TestRunCase.assigned_to == user_id,
            TestRunCase.status.in_(OPEN_RUN_CASE_STATUSES),
            TestRun.finished_at.is_(None),
        )
    )
    if project_id is not None:
        query = query.where(TestRun.project_id == project_id)
    clause = _visible_projects_clause(tenant_id, role_code, user_id, TestRun.project_id)
    return query if clause is None else query.where(clause)


def _review_query(db: Session, tenant_id: UUID, role_code: str, user_id: UUID) -> Select:
    query = (
        select(TestCase, Project.name)
        .join(Project, Project.id == TestCase.project_id)
        .where(
            # ADR-140: nothing in an archived project is pending work.
            Project.archived_at.is_(None),
            TestCase.tenant_id == tenant_id,
            TestCase.status == "ready_for_review",
            TestCase.reviewer_id == user_id,
        )
    )
    clause = _visible_projects_clause(tenant_id, role_code, user_id, TestCase.project_id)
    if clause is not None:
        query = query.where(clause)
    return tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, query)


def _task_query(tenant_id: UUID, role_code: str, user_id: UUID) -> Select:
    query = (
        select(Task, TaskStatus, Project.name)
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .join(Project, Project.id == Task.project_id)
        .where(
            # ADR-140: nothing in an archived project is pending work.
            Project.archived_at.is_(None),
            Task.tenant_id == tenant_id,
            Task.assignee_id == user_id,
            TaskStatus.category != "done",
            # Stated here as well as by the ORM hook: the counts wrap this in a subquery.
            Task.deleted_at.is_(None),
        )
    )
    clause = _visible_projects_clause(tenant_id, role_code, user_id, Task.project_id)
    return query if clause is None else query.where(clause)


def list_tasks(db: Session, tenant_id: UUID, role_code: str, user_id: UUID) -> MyTaskListResponse:
    """Earliest due date first, so overdue tasks lead and undated ones come last."""
    base = _task_query(tenant_id, role_code, user_id)
    today = datetime.now(UTC).date()
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(
        base.order_by(Task.due_date.asc().nulls_last(), Task.display_seq, Task.id).limit(MAX_ITEMS)
    ).all()
    items = [
        MyTaskOut(
            id=task.id,
            display_id=task.display_id,
            title=task.title,
            project_id=task.project_id,
            project_name=project_name,
            status=task_status_service.to_ref(status),
            priority=task.priority,
            due_date=task.due_date,
            overdue=task.due_date is not None and task.due_date < today,
        )
        for task, status, project_name in rows
    ]
    return MyTaskListResponse(items=items, total=total)


def list_run_cases(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None = None,
) -> MyRunCaseListResponse:
    base = _run_case_query(tenant_id, role_code, user_id, project_id)
    today = datetime.now(UTC).date()
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(
        base.order_by(TestRun.created_at.desc(), TestRunCase.id).limit(MAX_ITEMS)
    ).all()
    items = [
        MyRunCaseOut(
            id=rc.id,
            run_id=run.id,
            run_name=run.name,
            run_paused=run.paused_at is not None,
            project_id=run.project_id,
            project_name=project_name,
            test_case_id=rc.test_case_id,
            test_case_display_id=display_id,
            title=title,
            status=rc.status,  # type: ignore[arg-type]
            blocked_reason=rc.blocked_reason,
            started_at=rc.started_at,
            due_date=rc.due_date,
            overdue=(
                rc.due_date is not None
                and rc.due_date < today
                and rc.status in ("pending", "in_progress")
            ),
        )
        for rc, run, project_name, title, display_id in rows
    ]
    items.sort(key=lambda i: _STATUS_ORDER[i.status])
    return MyRunCaseListResponse(items=items, total=total)


def list_reviews(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID
) -> MyReviewListResponse:
    base = _review_query(db, tenant_id, role_code, user_id)
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(base.order_by(TestCase.created_at.desc(), TestCase.id).limit(MAX_ITEMS)).all()
    items = [
        MyReviewOut(
            id=case.id,
            display_id=case.display_id,
            title=case.title,
            priority=case.priority,
            project_id=case.project_id,
            project_name=project_name,
            created_at=case.created_at,
        )
        for case, project_name in rows
    ]
    return MyReviewListResponse(items=items, total=total)


def summary(db: Session, tenant_id: UUID, role_code: str, user_id: UUID) -> MyWorkSummaryOut:
    base = _run_case_query(tenant_id, role_code, user_id).subquery()
    counts = {
        status: count
        for status, count in db.execute(
            select(base.c.status, func.count()).group_by(base.c.status)
        ).all()
    }
    reviews = db.execute(
        select(func.count()).select_from(
            _review_query(db, tenant_id, role_code, user_id).subquery()
        )
    ).scalar_one()
    tasks = _task_query(tenant_id, role_code, user_id)
    today = datetime.now(UTC).date()
    tasks_total = db.execute(select(func.count()).select_from(tasks.subquery())).scalar_one()
    tasks_overdue = db.execute(
        select(func.count()).select_from(tasks.where(Task.due_date < today).subquery())
    ).scalar_one()
    return MyWorkSummaryOut(
        tasks_total=tasks_total,
        tasks_overdue=tasks_overdue,
        run_cases_pending=counts.get("pending", 0),
        run_cases_in_progress=counts.get("in_progress", 0),
        run_cases_failed=counts.get("failed", 0),
        run_cases_blocked=counts.get("blocked", 0),
        run_cases_total=sum(counts.values()),
        reviews_total=reviews,
    )
