"""ADR-127 phase 4: what a task is made of and how it is going.

A task's *effective* test cases are the cases linked to it directly plus the cases linked to any of
its requirements, over the task and (by default) all its sub-tasks. Results are each case's latest
executed run-case (passed / failed / blocked) in a live run.
"""

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.field_standards import OPEN_DEFECT_STATUSES
from app.models.defect import Defect
from app.models.execution import TestRun, TestRunCase
from app.models.requirement import Requirement, RequirementTestCaseLink
from app.models.task import Task, TaskStatus, TaskTestCaseLink
from app.models.test_case import TestCase
from app.schemas.task import TaskRollupOut, TaskRunRow, TaskTestCaseRow
from app.services import task_service

_LATEST_RESULT_SQL = text(
    """
    SELECT DISTINCT ON (trc.test_case_id) trc.test_case_id, trc.status
    FROM test_run_cases trc
    JOIN test_runs r ON r.id = trc.test_run_id
    WHERE trc.test_case_id = ANY(:case_ids)
      AND r.deleted_at IS NULL
      AND trc.status IN ('passed', 'failed', 'blocked')
    ORDER BY trc.test_case_id, COALESCE(trc.executed_at, trc.completed_at, r.created_at) DESC
    """
)


def _scope_ids(db: Session, tenant_id: UUID, task: Task, include_sub_tasks: bool) -> list[UUID]:
    if include_sub_tasks:
        return task_service.subtree_task_ids(db, tenant_id, task.id)
    return [task.id]


def _effective_cases(db: Session, task_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
    """{test_case_id: info} for the live cases of the given tasks (direct links + requirements)."""
    cases: dict[UUID, dict[str, Any]] = {}

    def add(case: TestCase, task_id: UUID, key: str) -> None:
        row = cases.setdefault(
            case.id, {"case": case, "direct": False, "via": False, "task_id": task_id}
        )
        row[key] = True

    for case, task_id in db.execute(
        select(TestCase, TaskTestCaseLink.task_id)
        .join(TaskTestCaseLink, TaskTestCaseLink.test_case_id == TestCase.id)
        .where(TaskTestCaseLink.task_id.in_(task_ids))
    ).all():
        add(case, task_id, "direct")
    for case, task_id in db.execute(
        select(TestCase, Requirement.task_id)
        .join(RequirementTestCaseLink, RequirementTestCaseLink.test_case_id == TestCase.id)
        .join(Requirement, Requirement.id == RequirementTestCaseLink.requirement_id)
        .where(Requirement.task_id.in_(task_ids))
    ).all():
        add(case, task_id, "via")
    return cases


def _latest_results(db: Session, case_ids: list[UUID]) -> dict[UUID, str]:
    if not case_ids:
        return {}
    rows = db.execute(_LATEST_RESULT_SQL, {"case_ids": case_ids}).all()
    return {r.test_case_id: r.status for r in rows}


def get_rollup(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    task_id: UUID,
    *,
    include_sub_tasks: bool = True,
) -> TaskRollupOut:
    task = task_service.get_task(db, tenant_id, role_code, user_id, task_id)
    ids = _scope_ids(db, tenant_id, task, include_sub_tasks)
    today = datetime.now(UTC).date()

    # --- sub-tasks ---
    below = [i for i in ids if i != task.id]
    by_category: dict[str, int] = defaultdict(int)
    overdue = 0
    if below:
        for category, count, late in db.execute(
            select(
                TaskStatus.category,
                func.count(Task.id),
                func.count(Task.id).filter(Task.due_date < today),
            )
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(Task.id.in_(below))
            .group_by(TaskStatus.category)
        ):
            by_category[category] = count
            if category != "done":
                overdue += late
    sub_total = sum(by_category.values())
    own_category = db.execute(
        select(TaskStatus.category).where(TaskStatus.id == task.status_id)
    ).scalar_one()
    if sub_total:
        progress = round(100 * by_category["done"] / sub_total)
    else:
        progress = 100 if own_category == "done" else 0

    # --- requirements ---
    requirement_ids = list(
        db.execute(select(Requirement.id).where(Requirement.task_id.in_(ids))).scalars()
    )
    covered = 0
    if requirement_ids:
        covered = db.execute(
            select(func.count(func.distinct(RequirementTestCaseLink.requirement_id)))
            .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
            .where(RequirementTestCaseLink.requirement_id.in_(requirement_ids))
        ).scalar_one()

    # --- test cases and their latest results ---
    cases = _effective_cases(db, ids)
    results = _latest_results(db, list(cases))
    counts: dict[str, int] = defaultdict(int)
    for status in results.values():
        counts[status] += 1
    executed = sum(counts.values())
    pass_rate = round(100 * counts["passed"] / executed) if executed else None

    runs_total = 0
    if cases:
        runs_total = db.execute(
            select(func.count(func.distinct(TestRunCase.test_run_id)))
            .join(TestRun, TestRun.id == TestRunCase.test_run_id)
            .where(TestRunCase.test_case_id.in_(list(cases)))
        ).scalar_one()

    # --- defects ---
    defects_total, defects_open, defects_critical = db.execute(
        select(
            func.count(Defect.id),
            func.count(Defect.id).filter(Defect.status.in_(OPEN_DEFECT_STATUSES)),
            func.count(Defect.id).filter(
                Defect.status.in_(OPEN_DEFECT_STATUSES), Defect.severity == "Critical"
            ),
        ).where(Defect.task_id.in_(ids))
    ).one()

    return TaskRollupOut(
        task_id=task.id,
        include_sub_tasks=include_sub_tasks,
        sub_tasks_total=sub_total,
        sub_tasks_todo=by_category["todo"],
        sub_tasks_in_progress=by_category["in_progress"],
        sub_tasks_done=by_category["done"],
        sub_tasks_overdue=overdue,
        progress_percent=progress,
        requirements_total=len(requirement_ids),
        requirements_covered=covered,
        test_cases_total=len(cases),
        test_cases_passed=counts["passed"],
        test_cases_failed=counts["failed"],
        test_cases_blocked=counts["blocked"],
        test_cases_not_run=len(cases) - executed,
        pass_rate=pass_rate,
        test_runs_total=runs_total,
        defects_total=defects_total,
        defects_open=defects_open,
        defects_critical_open=defects_critical,
    )


def list_effective_test_cases(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    task_id: UUID,
    *,
    include_sub_tasks: bool = True,
) -> list[TaskTestCaseRow]:
    task = task_service.get_task(db, tenant_id, role_code, user_id, task_id)
    ids = _scope_ids(db, tenant_id, task, include_sub_tasks)
    cases = _effective_cases(db, ids)
    results = _latest_results(db, list(cases))
    owner_ids = {c["task_id"] for c in cases.values()}
    task_labels = (
        {
            t_id: display_id
            for t_id, display_id in db.execute(
                select(Task.id, Task.display_id).where(Task.id.in_(owner_ids))
            )
        }
        if owner_ids
        else {}
    )
    rows = [
        TaskTestCaseRow(
            test_case_id=case_id,
            display_id=info["case"].display_id,
            title=info["case"].title,
            status=info["case"].status,
            linked_directly=info["direct"],
            via_requirement=info["via"],
            last_result=results.get(case_id),
            task_id=info["task_id"],
            task_display_id=task_labels.get(info["task_id"]),
        )
        for case_id, info in cases.items()
    ]
    rows.sort(key=lambda r: (r.display_id or "", r.title))
    return rows


def list_task_runs(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    task_id: UUID,
    *,
    include_sub_tasks: bool = True,
) -> list[TaskRunRow]:
    """Live test runs that contain at least one of the task's effective test cases, newest first."""
    task = task_service.get_task(db, tenant_id, role_code, user_id, task_id)
    ids = _scope_ids(db, tenant_id, task, include_sub_tasks)
    case_ids = list(_effective_cases(db, ids))
    if not case_ids:
        return []
    rows = db.execute(
        select(
            TestRun,
            func.count(TestRunCase.id),
            func.count(TestRunCase.id).filter(TestRunCase.status == "passed"),
            func.count(TestRunCase.id).filter(TestRunCase.status == "failed"),
            func.count(TestRunCase.id).filter(TestRunCase.status == "blocked"),
        )
        .join(TestRunCase, TestRunCase.test_run_id == TestRun.id)
        .where(TestRunCase.test_case_id.in_(case_ids))
        .group_by(TestRun.id)
        .order_by(TestRun.created_at.desc())
    ).all()
    return [
        TaskRunRow(
            run_id=run.id,
            name=run.name,
            run_type=run.run_type,
            created_at=run.created_at,
            finished_at=run.finished_at,
            cases_total=total,
            cases_passed=passed,
            cases_failed=failed,
            cases_blocked=blocked,
        )
        for run, total, passed, failed, blocked in rows
    ]
