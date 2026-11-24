"""ADR-124: the calendar view's data. Three date-range reads, each a single query:

  * runs that started (created) or finished inside the range;
  * run cases due inside the range, grouped to one row per (day, open run);
  * releases dated inside the range.

Nothing is stored. Project visibility is the one the run lists use (Admin and Manager see every
project; anyone else only projects they own or belong to), a scoped Tester (ADR-093) only counts
the cases that scope allows, soft-deleted runs are excluded by the ORM, and "overdue" uses the same
UTC today as ADR-123.
"""

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.models.execution import TestRun, TestRunCase
from app.models.project import Project
from app.models.test_asset import Release
from app.models.test_case import TestCase
from app.schemas.calendar import CalendarDueOut, CalendarOut, CalendarReleaseOut, CalendarRunOut
from app.services import tester_visibility
from app.services.my_work_service import _visible_projects_clause

MAX_RANGE_DAYS = 62
RUN_LIMIT = 300
DUE_LIMIT = 500
RELEASE_LIMIT = 300
OPEN_STATUSES = ("pending", "in_progress")


def _utc_day(value: datetime | None) -> date | None:
    return value.astimezone(UTC).date() if value else None


def _run_status(finished_at: datetime | None, paused_at: datetime | None) -> str:
    return "finished" if finished_at else "paused" if paused_at else "in_progress"


def get_calendar(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    *,
    from_date: date,
    to_date: date,
    project_id: UUID | None = None,
) -> CalendarOut:
    if to_date < from_date:
        raise ValidationAppError("'to' must not be before 'from'")
    if (to_date - from_date).days + 1 > MAX_RANGE_DAYS:
        raise ValidationAppError(f"A calendar range is at most {MAX_RANGE_DAYS} days")

    if project_id is not None:
        project = db.execute(
            select(Project.id).where(Project.tenant_id == tenant_id, Project.id == project_id)
        ).first()
        if project is None:
            raise NotFoundError("Project not found")
        clause = _visible_projects_clause(tenant_id, role_code, user_id, Project.id)
        if clause is not None and (
            db.execute(select(Project.id).where(Project.id == project_id, clause)).first() is None
        ):
            raise ForbiddenError("You are not assigned to this project")

    def scoped(query, column):
        clause = _visible_projects_clause(tenant_id, role_code, user_id, column)
        if clause is not None:
            query = query.where(clause)
        if project_id is not None:
            query = query.where(column == project_id)
        return query

    start = datetime.combine(from_date, time.min, tzinfo=UTC)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=UTC)
    today = datetime.now(UTC).date()
    truncated = False

    # Runs that started or finished in the range.
    run_rows = db.execute(
        scoped(
            select(
                TestRun.id,
                TestRun.name,
                TestRun.project_id,
                Project.name,
                TestRun.run_type,
                TestRun.created_at,
                TestRun.finished_at,
                TestRun.paused_at,
            )
            .join(Project, Project.id == TestRun.project_id)
            .where(
                TestRun.tenant_id == tenant_id,
                or_(
                    (TestRun.created_at >= start) & (TestRun.created_at < end),
                    (TestRun.finished_at >= start) & (TestRun.finished_at < end),
                ),
            ),
            TestRun.project_id,
        )
        .order_by(TestRun.created_at, TestRun.id)
        .limit(RUN_LIMIT + 1)
    ).all()
    if len(run_rows) > RUN_LIMIT:
        truncated = True
        run_rows = run_rows[:RUN_LIMIT]
    runs = [
        CalendarRunOut(
            id=r[0],
            name=r[1],
            project_id=r[2],
            project_name=r[3],
            run_type=r[4],
            status=_run_status(r[6], r[7]),  # type: ignore[arg-type]
            start_date=_utc_day(r[5]),  # type: ignore[arg-type]
            end_date=_utc_day(r[6]),
        )
        for r in run_rows
    ]

    # Run cases due in the range: one grouped query, open runs only.
    open_count = func.count(case((TestRunCase.status.in_(OPEN_STATUSES), 1)))
    due_query = (
        select(
            TestRunCase.due_date,
            TestRun.id,
            TestRun.name,
            TestRun.project_id,
            Project.name,
            func.count(),
            open_count,
        )
        .select_from(TestRunCase)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(Project, Project.id == TestRun.project_id)
        .join(TestCase, TestCase.id == TestRunCase.test_case_id)
        .where(
            TestRunCase.tenant_id == tenant_id,
            TestRun.finished_at.is_(None),
            TestRunCase.due_date >= from_date,
            TestRunCase.due_date <= to_date,
        )
        .group_by(TestRunCase.due_date, TestRun.id, TestRun.name, TestRun.project_id, Project.name)
        .order_by(TestRunCase.due_date, TestRun.id)
        .limit(DUE_LIMIT + 1)
    )
    due_query = tester_visibility.scope_case_query(
        db, tenant_id, role_code, user_id, scoped(due_query, TestRun.project_id)
    )
    due_rows = db.execute(due_query).all()
    if len(due_rows) > DUE_LIMIT:
        truncated = True
        due_rows = due_rows[:DUE_LIMIT]
    due = [
        CalendarDueOut(
            due_date=r[0],
            run_id=r[1],
            run_name=r[2],
            project_id=r[3],
            project_name=r[4],
            total_cases=r[5],
            open_cases=r[6],
            overdue=r[6] > 0 and r[0] < today,
        )
        for r in due_rows
    ]

    release_rows = db.execute(
        scoped(
            select(
                Release.id,
                Release.name,
                Release.project_id,
                Project.name,
                Release.release_date,
                Release.status,
            )
            .join(Project, Project.id == Release.project_id)
            .where(
                Release.tenant_id == tenant_id,
                Release.release_date >= from_date,
                Release.release_date <= to_date,
            ),
            Release.project_id,
        )
        .order_by(Release.release_date, Release.id)
        .limit(RELEASE_LIMIT + 1)
    ).all()
    if len(release_rows) > RELEASE_LIMIT:
        truncated = True
        release_rows = release_rows[:RELEASE_LIMIT]
    releases = [
        CalendarReleaseOut(
            id=r[0], name=r[1], project_id=r[2], project_name=r[3], release_date=r[4], status=r[5]
        )
        for r in release_rows
    ]
    return CalendarOut(
        from_date=from_date,
        to_date=to_date,
        runs=runs,
        due=due,
        releases=releases,
        truncated=truncated,
    )
