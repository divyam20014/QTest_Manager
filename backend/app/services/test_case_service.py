from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import case as sql_case
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import pagination
from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.db import set_tenant_context
from app.core.errors import (
    AppError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationAppError,
)
from app.core.field_standards import (
    AUTOMATION_STATUSES,
    DEFAULT_AUTOMATION_STATUS,
    DEFAULT_VISIBLE_TEST_CASE_FIELDS,
    EXECUTION_STATUS_BY_RUN_CASE_STATUS,
    EXECUTION_STATUSES,
    NOT_RUN,
    TEST_CASE_FIELDS,
)
from app.core.text_sanitize import detect_text_format
from app.models.audit import AuditLog
from app.models.comment import Comment
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.requirement import Requirement, RequirementTestCaseLink
from app.models.test_case import Attachment, TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_module import TestModule
from app.schemas.test_case import (
    BulkItemResult,
    FieldSpecOut,
    LinkedDefectOut,
    Priority,
    StepDiff,
    StepIn,
    StepOut,
    TestCaseBulkUpdateRequest,
    TestCaseBulkUpdateResult,
    TestCaseCreateRequest,
    TestCaseExecutionListResponse,
    TestCaseExecutionOut,
    TestCaseFieldCatalogOut,
    TestCaseHistoryEntryOut,
    TestCaseOut,
    TestCaseStatus,
    TestCaseUpdateRequest,
    TestCaseVersionOut,
    VersionCompareOut,
)
from app.services import (
    custom_field_service,
    display_id_service,
    field_option_service,
    lookups,
    notification_service,
    status_label_service,
    tester_visibility,
)
from app.services.project_service import is_assigned

SORTABLE_FIELDS = {
    "title": TestCase.title,
    "created_at": TestCase.created_at,
    "priority": TestCase.priority,
    "status": TestCase.status,
    # ADR-116: sort by the numeric part of the id, not the text.
    "display_id": TestCase.display_seq,
    "test_type": TestCase.test_type,
    "severity": TestCase.severity,
    "automation_status": TestCase.automation_status,
}
# Sorts that need the latest-execution join.
EXECUTION_SORTS = ("last_executed_at", "execution_status")
NULLABLE_SORTS = ("display_id", "test_type", "severity", "automation_status", "last_executed_at")
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
EXECUTED_RUN_CASE_STATUSES = tuple(EXECUTION_STATUS_BY_RUN_CASE_STATUS)
MAX_LINKED_DEFECTS_PER_CASE = 50
EXECUTION_HISTORY_MAX_PAGE_SIZE = 100


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    """ADR-019: tenant-wide for Admin/Manager; Tester must be assigned."""
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _steps_for_version(db: Session, version_id: UUID) -> list[StepOut]:
    rows = db.execute(
        select(TestCaseVersionStep)
        .where(TestCaseVersionStep.test_case_version_id == version_id)
        .order_by(TestCaseVersionStep.step_number)
    ).scalars()
    return [
        StepOut(
            step_number=r.step_number,
            action=r.action,
            expected=r.expected,
            test_data=r.test_data,
        )
        for r in rows
    ]


def _get_test_case_or_404(
    db: Session,
    tenant_id: UUID,
    test_case_id: UUID,
    *,
    include_deleted: bool = False,
    role_code: str | None = None,
) -> TestCase:
    """`include_deleted` (ADR-116) is for the read-only history paths: a soft-deleted
    case stays readable by id for Admin and Manager, never for anyone else."""
    stmt = select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    if include_deleted:
        stmt = stmt.execution_options(include_deleted=True)
    case = db.execute(stmt).scalar_one_or_none()
    if case is None:
        raise NotFoundError("Test case not found")
    if case.deleted_at is not None and role_code not in ("admin", "manager"):
        raise NotFoundError("Test case not found")
    return case


def _get_current_version(db: Session, case: TestCase) -> TestCaseVersion:
    version = db.execute(
        select(TestCaseVersion).where(TestCaseVersion.id == case.current_version_id)
    ).scalar_one()
    return version


def _authorize_case_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, case: TestCase
) -> None:
    project = _get_project_or_404(db, tenant_id, case.project_id)
    _require_project_access(db, project, role_code, user_id)
    # ADR-093: a scoped Tester gets 404 (no existence leak) for unassigned cases.
    tester_visibility.assert_case_visible(db, tenant_id, role_code, user_id, case.id)


def _last_executions(
    db: Session, tenant_id: UUID, test_case_ids: list[UUID]
) -> dict[UUID, tuple[str | None, str | None, datetime | None]]:
    """Batch form of `_last_execution` (ADR-113): one DISTINCT ON query for all
    the given cases instead of one query (plus a user-name lookup) per case.
    Backed by ix_test_run_cases_tenant_case + ix_execution_steps_case_closed."""
    if not test_case_ids:
        return {}
    rows = db.execute(
        select(
            TestRunCase.test_case_id,
            ExecutionStep.verdict,
            ExecutionStep.executed_by,
            ExecutionStep.closed_at,
        )
        .join(TestRunCase, TestRunCase.id == ExecutionStep.test_run_case_id)
        .where(
            TestRunCase.tenant_id == tenant_id,
            TestRunCase.test_case_id.in_(test_case_ids),
            ExecutionStep.closed_at.is_not(None),
        )
        .distinct(TestRunCase.test_case_id)
        .order_by(TestRunCase.test_case_id, ExecutionStep.closed_at.desc())
    ).all()
    names = lookups.value_map(db, User.id, User.name, (r.executed_by for r in rows))
    return {r.test_case_id: (r.verdict, names.get(r.executed_by), r.closed_at) for r in rows}


def _last_execution(
    db: Session, tenant_id: UUID, test_case_id: UUID
) -> tuple[str | None, str | None, datetime | None]:
    """Pass 2: Actual_Result/Executed_By/Execution_Date are NOT stored
    fields -- derived read-only from this test case's most recent executed
    step across any test run (highest closed_at), never settable via
    create/update/import."""
    return _last_executions(db, tenant_id, [test_case_id]).get(test_case_id, (None, None, None))


def _latest_exec_select(
    tenant_id: UUID,
    case_ids: list[UUID] | None = None,
    project_id: UUID | None = None,
    *,
    lean: bool = False,
):
    """ADR-116: the latest EXECUTED run case of each test case (status passed /
    failed / blocked / ignored, in a live run). Execution status, executed-by and
    last-executed-at are derived from it; nothing is stored on the test case.

    A run case still pending or in progress does not hide the last result: the
    case keeps showing it until a newer run case is actually executed. Legacy run
    cases (no `executed_at`) fall back to completed_at / started_at, and a missing
    `executed_by` falls back to the last step executor.

    `lean=True` (ADR-123 aggregates) skips that per-row step-executor lookup and
    `actual_result`: it keeps the same winner per case (same ORDER BY) but exposes the
    raw `executed_by`, so a caller aggregating many cases applies the fallback only to
    the winning rows."""
    when = func.coalesce(TestRunCase.executed_at, TestRunCase.completed_at, TestRunCase.started_at)
    step_executor = (
        select(ExecutionStep.executed_by)
        .where(
            ExecutionStep.test_run_case_id == TestRunCase.id,
            ExecutionStep.executed_by.is_not(None),
        )
        .order_by(ExecutionStep.closed_at.desc().nulls_last())
        .limit(1)
        .correlate(TestRunCase)
        .scalar_subquery()
    )
    columns = [
        TestRunCase.test_case_id.label("test_case_id"),
        TestRunCase.id.label("run_case_id"),
        TestRunCase.status.label("status"),
        (
            TestRunCase.executed_by
            if lean
            else func.coalesce(TestRunCase.executed_by, step_executor)
        ).label("executed_by"),
        when.label("executed_at"),
    ]
    if not lean:
        columns.append(TestRunCase.actual_result.label("actual_result"))
    stmt = (
        select(*columns)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .where(
            TestRunCase.tenant_id == tenant_id,
            TestRun.deleted_at.is_(None),
            TestRunCase.status.in_(EXECUTED_RUN_CASE_STATUSES),
        )
        .distinct(TestRunCase.test_case_id)
        .order_by(TestRunCase.test_case_id, when.desc().nulls_last(), TestRunCase.id.desc())
    )
    if project_id is not None:
        # ADR-123: a run only bundles cases of its own project, so narrowing the runs
        # narrows the DISTINCT ON to one project's run cases (project dashboard aggregates).
        stmt = stmt.where(TestRun.project_id == project_id)
    if case_ids is not None:
        stmt = stmt.where(TestRunCase.test_case_id.in_(case_ids))
    return stmt


def execution_status_label(run_case_status: str | None) -> str:
    """passed -> Pass, failed -> Fail, blocked -> Blocked, ignored -> Skipped;
    pending / in_progress / no run case -> Not Run."""
    return EXECUTION_STATUS_BY_RUN_CASE_STATUS.get(run_case_status or "", NOT_RUN)


def _module_paths(db: Session, module_ids: set[UUID]) -> dict[UUID, tuple[str, str]]:
    """{module_id: (leaf name, 'Module/Submodule/Feature' path)} from the
    test_modules nesting. Parents are fetched level by level (nesting is shallow;
    a cycle or absurd depth stops the walk)."""
    if not module_ids:
        return {}
    known: dict[UUID, tuple[str, UUID | None]] = {}
    wanted = set(module_ids)
    for _ in range(12):
        wanted -= set(known)
        if not wanted:
            break
        for mid, name, parent_id in db.execute(
            select(TestModule.id, TestModule.name, TestModule.parent_id).where(
                TestModule.id.in_(wanted)
            )
        ):
            known[mid] = (name, parent_id)
        wanted = {p for _, p in known.values() if p is not None and p not in known}
    out: dict[UUID, tuple[str, str]] = {}
    for mid in module_ids:
        if mid not in known:
            continue
        parts: list[str] = []
        seen: set[UUID] = set()
        cursor: UUID | None = mid
        while cursor is not None and cursor in known and cursor not in seen:
            seen.add(cursor)
            name, parent = known[cursor]
            parts.append(name)
            cursor = parent
        out[mid] = (known[mid][0], "/".join(reversed(parts)))
    return out


def _linked_defects_by_case(db: Session, case_ids: list[UUID]) -> dict[UUID, list[LinkedDefectOut]]:
    """Defects tied to a case by either path: the primary `defects.test_case_id`
    and `defect_links` rows of type 'test_case' (soft-deleted defects are hidden
    by the ORM hook)."""
    found: dict[UUID, dict[UUID, LinkedDefectOut]] = {cid: {} for cid in case_ids}
    for d in db.execute(
        select(Defect.id, Defect.display_id, Defect.title, Defect.status, Defect.test_case_id)
        .where(Defect.test_case_id.in_(case_ids))
        .order_by(Defect.created_at)
    ):
        found[d.test_case_id][d.id] = LinkedDefectOut(
            id=d.id, display_id=d.display_id, title=d.title, status=d.status
        )
    for link in db.execute(
        select(Defect.id, Defect.display_id, Defect.title, Defect.status, DefectLink.linkable_id)
        .join(DefectLink, DefectLink.defect_id == Defect.id)
        .where(DefectLink.linkable_type == "test_case", DefectLink.linkable_id.in_(case_ids))
        .order_by(Defect.created_at)
    ):
        found[link.linkable_id].setdefault(
            link.id,
            LinkedDefectOut(
                id=link.id, display_id=link.display_id, title=link.title, status=link.status
            ),
        )
    return {cid: list(v.values()) for cid, v in found.items()}


def _owner_counts(
    db: Session, model: Any, owner_type: str, case_ids: list[UUID]
) -> dict[UUID, int]:
    return {
        owner_id: n
        for owner_id, n in db.execute(
            select(model.owner_id, func.count())
            .where(model.owner_type == owner_type, model.owner_id.in_(case_ids))
            .group_by(model.owner_id)
        )
    }


def to_out(db: Session, case: TestCase) -> TestCaseOut:
    return to_out_many(db, [case])[0]


def to_out_many(db: Session, cases: list[TestCase]) -> list[TestCaseOut]:
    """Serialize a page of cases with a constant number of queries (ADR-113),
    instead of ~10 per case. All `cases` must belong to one tenant (they come
    from one tenant-scoped listing)."""
    if not cases:
        return []
    tenant_id = cases[0].tenant_id
    # Callers may invoke this right after a service function committed
    # (ending the transaction that held app.current_tenant); re-assert it
    # from the already-loaded object before issuing further RLS-protected
    # queries (test_case_versions/test_case_version_steps both have RLS).
    set_tenant_context(db, str(tenant_id))
    case_ids = [c.id for c in cases]
    versions = {
        v.id: v
        for v in db.execute(
            select(TestCaseVersion).where(
                TestCaseVersion.id.in_([c.current_version_id for c in cases])
            )
        ).scalars()
    }
    steps_by_version: dict[UUID, list[StepOut]] = {vid: [] for vid in versions}
    for row in db.execute(
        select(TestCaseVersionStep)
        .where(TestCaseVersionStep.test_case_version_id.in_(list(versions)))
        .order_by(TestCaseVersionStep.test_case_version_id, TestCaseVersionStep.step_number)
    ).scalars():
        steps_by_version[row.test_case_version_id].append(
            StepOut(
                step_number=row.step_number,
                action=row.action,
                expected=row.expected,
                test_data=row.test_data,
            )
        )
    reviewer_names = lookups.value_map(db, User.id, User.name, (c.reviewer_id for c in cases))
    status_labels = status_label_service.get_labels_map(db, tenant_id, "test_case")
    custom_fields = custom_field_service.get_values_for_owners(db, tenant_id, "test_case", case_ids)
    last_executions = _last_executions(db, tenant_id, case_ids)
    latest = {r.test_case_id: r for r in db.execute(_latest_exec_select(tenant_id, case_ids)).all()}
    user_names = lookups.value_map(
        db,
        User.id,
        User.name,
        [c.created_by for c in cases] + [r.executed_by for r in latest.values()],
    )
    module_paths = _module_paths(db, {c.module_id for c in cases if c.module_id is not None})
    defects_by_case = _linked_defects_by_case(db, case_ids)
    attachment_counts = _owner_counts(db, Attachment, "test_case", case_ids)
    comment_counts = _owner_counts(db, Comment, "test_case", case_ids)

    out: list[TestCaseOut] = []
    for case in cases:
        version = versions[cast(UUID, case.current_version_id)]
        last_result, last_executed_by_name, last_execution_date = last_executions.get(
            case.id, (None, None, None)
        )
        run = latest.get(case.id)
        module_name, module_path = module_paths.get(case.module_id, (None, None))  # type: ignore[arg-type]
        linked = defects_by_case.get(case.id, [])
        out.append(
            TestCaseOut(
                id=case.id,
                project_id=case.project_id,
                title=case.title,
                description=version.description,
                priority=cast(Priority, case.priority),
                status=cast(TestCaseStatus, case.status),
                status_label=status_labels.get(case.status, case.status),
                review_status=cast(TestCaseStatus, case.status),
                review_status_label=status_labels.get(case.status, case.status),
                assignee_id=case.assignee_id,
                module_id=case.module_id,
                module_name=module_name,
                module_path=module_path,
                reviewer_id=case.reviewer_id,
                reviewer_name=reviewer_names.get(case.reviewer_id),
                version_number=version.version_number,
                created_by=case.created_by,
                created_by_name=user_names.get(case.created_by),
                created_at=case.created_at,
                steps=steps_by_version[version.id],
                custom_fields=custom_fields[case.id],
                display_id=case.display_id,
                test_type=case.test_type,
                severity=case.severity,
                automation_status=case.automation_status,
                environment=case.environment,
                requirement_ref=case.requirement_ref,
                postconditions=version.postconditions,
                expected_result=version.expected_result,
                scenario_id=version.scenario_id,
                scenario_description=version.scenario_description,
                prerequisite=version.prerequisite,
                preconditions=version.prerequisite,
                test_data=version.test_data,
                test_data_format=detect_text_format(version.test_data),
                last_execution_result=last_result,
                last_executed_by_name=last_executed_by_name,
                last_execution_date=last_execution_date,
                execution_status=execution_status_label(run.status if run else None),
                last_executed_by=user_names.get(run.executed_by) if run else None,
                last_executed_by_id=run.executed_by if run else None,
                last_executed_at=run.executed_at if run else None,
                last_actual_result=run.actual_result if run else None,
                linked_defects=linked[:MAX_LINKED_DEFECTS_PER_CASE],
                linked_defect_count=len(linked),
                attachment_count=attachment_counts.get(case.id, 0),
                comment_count=comment_counts.get(case.id, 0),
                quarantined=case.quarantined,
                quarantine_reason=case.quarantine_reason,
                quarantined_at=case.quarantined_at,
            )
        )
    return out


def _like_pattern(term: str) -> str:
    """`%term%` with the LIKE wildcards in the user's text escaped (so a search for
    TC_0001 does not treat the underscore as 'any character')."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _filter_sort_page(
    db: Session,
    query,  # a `select(TestCase)` already restricted to the projects the caller may see
    *,
    tenant_id: UUID,
    search: str | None,
    priority: str | None,
    status: str | None,
    assignee_id: UUID | None,
    module_id: UUID | None,
    sort: str,
    page: int,
    page_size: int,
    quarantined: str | None = None,
    cursor: str | None = None,
    include_total: bool = True,
    test_type: str | None = None,
    severity: str | None = None,
    automation_status: str | None = None,
    environment: str | None = None,
    execution_status: str | None = None,
    executed_by: UUID | None = None,
) -> tuple[list[TestCase], int, str | None]:
    """The filters, sorting and paging shared by the per-project and the
    tenant-wide listings, so the two can never disagree about what a filter
    means.

    `search` (ADR-116) matches the Test Case ID, title, requirement reference or
    module name (case-insensitive substring, served by the trigram indexes).

    `cursor` (ADR-113) switches to keyset paging: only `sort=created_at` /
    `-created_at` is supported, `page` is ignored, and the third return value is
    the cursor of the next page (None on the last page, or in offset mode).
    `include_total=False` skips the COUNT and returns -1 as the total."""
    if search:
        pattern = _like_pattern(search.strip())
        query = query.where(
            or_(
                TestCase.title.ilike(pattern, escape="\\"),
                TestCase.display_id.ilike(pattern, escape="\\"),
                TestCase.requirement_ref.ilike(pattern, escape="\\"),
                TestCase.module_id.in_(
                    select(TestModule.id).where(TestModule.name.ilike(pattern, escape="\\"))
                ),
            )
        )
    if priority:
        query = query.where(TestCase.priority == priority)
    if status:
        query = query.where(TestCase.status == status)
    if assignee_id:
        query = query.where(TestCase.assignee_id == assignee_id)
    if module_id:
        query = query.where(TestCase.module_id == module_id)
    if test_type:
        query = query.where(TestCase.test_type == test_type)
    if severity:
        query = query.where(TestCase.severity == severity)
    if automation_status:
        query = query.where(TestCase.automation_status == automation_status)
    if environment:
        query = query.where(func.lower(TestCase.environment) == environment.strip().lower())
    if quarantined == "only":
        query = query.where(TestCase.quarantined.is_(True))
    elif quarantined == "exclude":
        query = query.where(TestCase.quarantined.is_(False))

    sort_key = sort.lstrip("-")
    needs_latest = (
        execution_status is not None or executed_by is not None or sort_key in EXECUTION_SORTS
    )
    latest = None
    if needs_latest:
        latest = _latest_exec_select(tenant_id).subquery("latest_exec")
        query = query.outerjoin(latest, latest.c.test_case_id == TestCase.id)
        if execution_status == NOT_RUN:
            query = query.where(latest.c.status.is_(None))
        elif execution_status == "Executed":
            query = query.where(latest.c.status.is_not(None))
        elif execution_status:
            codes = [
                code
                for code, label in EXECUTION_STATUS_BY_RUN_CASE_STATUS.items()
                if label == execution_status
            ]
            query = query.where(latest.c.status.in_(codes))
        if executed_by is not None:
            query = query.where(latest.c.executed_by == executed_by)

    total = (
        db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
        if include_total
        else -1
    )

    if sort_key == "last_executed_at":
        sort_field: Any = latest.c.executed_at  # type: ignore[union-attr]
    elif sort_key == "execution_status":
        labels = dict(EXECUTION_STATUS_BY_RUN_CASE_STATUS)
        sort_field = sql_case(
            *[(latest.c.status == code, label) for code, label in labels.items()],  # type: ignore[union-attr]
            else_=NOT_RUN,
        )
    else:
        sort_field = SORTABLE_FIELDS.get(sort_key, TestCase.created_at)
    descending = sort.startswith("-")
    if sort_key in NULLABLE_SORTS:
        order_clause = (
            sort_field.desc().nulls_last() if descending else sort_field.asc().nulls_last()
        )
    else:
        order_clause = sort_field.desc() if descending else sort_field.asc()
    query = query.order_by(order_clause, TestCase.id)

    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
    page = max(page, 1)
    if cursor is None:
        query = query.limit(page_size).offset((page - 1) * page_size)
        return list(db.execute(query).scalars()), total, None

    if sort_field is not TestCase.created_at:
        raise ValidationAppError("Cursor paging requires sort=created_at or sort=-created_at")
    position = pagination.decode_cursor(cursor)
    if position is not None:
        query = query.where(
            pagination.keyset_after(
                TestCase.created_at,
                TestCase.id,
                position,
                created_desc=descending,
                id_desc=False,
            )
        )
    rows = list(db.execute(query.limit(page_size + 1)).scalars())
    next_cursor = None
    if len(rows) > page_size:
        rows = rows[:page_size]
        next_cursor = pagination.encode_cursor(rows[-1].created_at, rows[-1].id)
    return rows, total, next_cursor


def list_test_cases(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    *,
    search: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    assignee_id: UUID | None = None,
    module_id: UUID | None = None,
    quarantined: str | None = None,
    sort: str = "created_at",
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    include_total: bool = True,
    test_type: str | None = None,
    severity: str | None = None,
    automation_status: str | None = None,
    environment: str | None = None,
    execution_status: str | None = None,
    executed_by: UUID | None = None,
) -> tuple[list[TestCase], int, str | None]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)

    query = select(TestCase).where(
        TestCase.tenant_id == tenant_id, TestCase.project_id == project_id
    )
    query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, query)
    return _filter_sort_page(
        db,
        query,
        tenant_id=tenant_id,
        search=search,
        priority=priority,
        status=status,
        assignee_id=assignee_id,
        module_id=module_id,
        quarantined=quarantined,
        sort=sort,
        page=page,
        page_size=page_size,
        cursor=cursor,
        include_total=include_total,
        test_type=test_type,
        severity=severity,
        automation_status=automation_status,
        environment=environment,
        execution_status=execution_status,
        executed_by=executed_by,
    )


def list_test_cases_all_projects(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    *,
    search: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    assignee_id: UUID | None = None,
    module_id: UUID | None = None,
    quarantined: str | None = None,
    sort: str = "created_at",
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    include_total: bool = True,
    test_type: str | None = None,
    severity: str | None = None,
    automation_status: str | None = None,
    environment: str | None = None,
    execution_status: str | None = None,
    executed_by: UUID | None = None,
) -> tuple[list[TestCase], int, str | None]:
    """One listing across every project the caller may see, with the same
    filters, sorting and paging as the per-project list (the Test Repository
    used to ask each project separately whenever a filter was on).

    Visibility is exactly `_require_project_access`'s rule, expressed as a
    filter instead of a per-project check: Admin and Manager see every project
    in the tenant; anyone else sees only projects they own or are a member of
    -- so a Tester never receives a case from a project they could not open."""
    query = select(TestCase).where(TestCase.tenant_id == tenant_id)
    if role_code not in ("admin", "manager"):
        owned = select(Project.id).where(
            Project.tenant_id == tenant_id, Project.owner_id == user_id
        )
        member_of = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        query = query.where(or_(TestCase.project_id.in_(owned), TestCase.project_id.in_(member_of)))
    query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, query)
    return _filter_sort_page(
        db,
        query,
        tenant_id=tenant_id,
        search=search,
        priority=priority,
        status=status,
        assignee_id=assignee_id,
        module_id=module_id,
        quarantined=quarantined,
        sort=sort,
        page=page,
        page_size=page_size,
        cursor=cursor,
        include_total=include_total,
        test_type=test_type,
        severity=severity,
        automation_status=automation_status,
        environment=environment,
        execution_status=execution_status,
        executed_by=executed_by,
    )


def get_test_case(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> TestCase:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    return case


def list_linked_requirements(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> list[dict]:
    """Requirements linked to a case (id + title) -- the case-side view of the
    RTM, so the case detail can show and edit its links without N+1 reads."""
    case = get_test_case(db, tenant_id, role_code, user_id, test_case_id)
    rows = db.execute(
        select(Requirement.id, Requirement.title)
        .join(RequirementTestCaseLink, RequirementTestCaseLink.requirement_id == Requirement.id)
        .where(
            RequirementTestCaseLink.tenant_id == tenant_id,
            RequirementTestCaseLink.test_case_id == case.id,
        )
        .order_by(Requirement.title)
    ).all()
    return [{"id": str(r.id), "title": r.title} for r in rows]


def get_test_case_history(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> list[TestCaseHistoryEntryOut]:
    """Per-entity activity timeline (PV-9.3), reusing the existing
    hash-chained audit_logs table filtered by entity -- mirrors
    defect_service.get_defect_history. Distinct from Version History
    (TestCaseVersion): this covers all audited activity (status changes,
    comments, attachments, AI generation) not just content edits."""
    case = _get_test_case_or_404(
        db, tenant_id, test_case_id, include_deleted=True, role_code=role_code
    )
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    set_tenant_context(db, str(tenant_id))

    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "test_case",
            AuditLog.entity_id == test_case_id,
        )
        .order_by(AuditLog.created_at.asc())
    ).all()
    return [
        TestCaseHistoryEntryOut(
            id=log.id,
            action=log.action,
            user_id=log.user_id,
            user_name=user_name,
            event_metadata=log.event_metadata or {},
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def list_versions(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> list[TestCaseVersionOut]:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    set_tenant_context(db, str(tenant_id))
    versions = db.execute(
        select(TestCaseVersion)
        .where(TestCaseVersion.test_case_id == test_case_id)
        .order_by(TestCaseVersion.version_number)
    ).scalars()
    return [
        TestCaseVersionOut(
            version_number=v.version_number,
            title=v.title,
            description=v.description,
            scenario_id=v.scenario_id,
            scenario_description=v.scenario_description,
            prerequisite=v.prerequisite,
            preconditions=v.prerequisite,
            test_data=v.test_data,
            postconditions=v.postconditions,
            expected_result=v.expected_result,
            approved_by=v.approved_by,
            approved_at=v.approved_at,
            created_by=v.created_by,
            created_at=v.created_at,
            steps=_steps_for_version(db, v.id),
        )
        for v in versions
    ]


def _get_version_by_number(db: Session, test_case_id: UUID, version_number: int) -> TestCaseVersion:
    version = db.execute(
        select(TestCaseVersion).where(
            TestCaseVersion.test_case_id == test_case_id,
            TestCaseVersion.version_number == version_number,
        )
    ).scalar_one_or_none()
    if version is None:
        raise NotFoundError(f"Version {version_number} not found")
    return version


def compare_versions(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    test_case_id: UUID,
    from_version: int,
    to_version: int,
) -> VersionCompareOut:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    set_tenant_context(db, str(tenant_id))

    old = _get_version_by_number(db, test_case_id, from_version)
    new = _get_version_by_number(db, test_case_id, to_version)
    old_steps = {s.step_number: s for s in _steps_for_version(db, old.id)}
    new_steps = {s.step_number: s for s in _steps_for_version(db, new.id)}

    diffs: list[StepDiff] = []
    for step_number in sorted(set(old_steps) | set(new_steps)):
        old_step = old_steps.get(step_number)
        new_step = new_steps.get(step_number)
        if old_step is not None and new_step is None:
            diffs.append(
                StepDiff(
                    step_number=step_number,
                    change="removed",
                    old_action=old_step.action,
                    old_expected=old_step.expected,
                )
            )
        elif old_step is None and new_step is not None:
            diffs.append(
                StepDiff(
                    step_number=step_number,
                    change="added",
                    new_action=new_step.action,
                    new_expected=new_step.expected,
                )
            )
        elif old_step is not None and new_step is not None:
            changed = old_step.action != new_step.action or old_step.expected != new_step.expected
            diffs.append(
                StepDiff(
                    step_number=step_number,
                    change="modified" if changed else "unchanged",
                    old_action=old_step.action,
                    old_expected=old_step.expected,
                    new_action=new_step.action,
                    new_expected=new_step.expected,
                )
            )

    return VersionCompareOut(
        from_version=from_version,
        to_version=to_version,
        title_changed=old.title != new.title,
        old_title=old.title,
        new_title=new.title,
        description_changed=old.description != new.description,
        old_description=old.description,
        new_description=new.description,
        steps=diffs,
    )


def _validate_module(db: Session, tenant_id: UUID, project_id: UUID, module_id: UUID) -> None:
    module = db.execute(
        select(TestModule).where(
            TestModule.tenant_id == tenant_id,
            TestModule.id == module_id,
            TestModule.project_id == project_id,
        )
    ).scalar_one_or_none()
    if module is None:
        raise NotFoundError("module_id must belong to this test case's project")


def _blank(value: str | None) -> bool:
    return value is None or not value.strip()


def enforce_create_requirements(req: TestCaseCreateRequest) -> None:
    """ADR-116: the API-level mandatory fields of a NEW test case: module, title,
    priority, preconditions, test data, at least one step and the case-level
    expected result. Title, priority and steps are already guaranteed by the request
    schema; module, preconditions, test data and expected result are checked here so
    the response names every missing field (`error.fields`). Never applied to
    reads, to legacy rows, or to internal creators (AI generation, templates)."""
    missing: dict[str, str] = {}
    if req.module_id is None:
        missing["module_id"] = "Module is required"
    if _blank(req.preconditions):
        missing["preconditions"] = "Preconditions are required"
    if _blank(req.test_data):
        missing["test_data"] = "Test data is required"
    if _blank(req.expected_result):
        missing["expected_result"] = "Expected result is required"
    if missing:
        raise ValidationAppError("Required fields missing: " + ", ".join(missing), fields=missing)


def _validate_option_fields(
    db: Session,
    tenant_id: UUID,
    *,
    test_type: str | None,
    severity: str | None,
    current_test_type: str | None = None,
    current_severity: str | None = None,
) -> None:
    """Test type and severity come from the tenant's configured options; a value a
    case already carries may be re-sent unchanged even if the option was removed."""
    if test_type is not None and test_type != current_test_type:
        field_option_service.validate_code(db, tenant_id, "test_type", test_type)
    if severity is not None and severity != current_severity:
        field_option_service.validate_code(db, tenant_id, "test_case_severity", severity)


def _write_version(
    db: Session,
    tenant_id: UUID,
    case: TestCase,
    title: str,
    description: str,
    steps: list[StepIn],
    actor_user_id: UUID,
    scenario_id: str | None = None,
    scenario_description: str | None = None,
    prerequisite: str | None = None,
    test_data: str | None = None,
    postconditions: str | None = None,
    expected_result: str | None = None,
) -> TestCaseVersion:
    next_number = (
        db.execute(
            select(TestCaseVersion.version_number)
            .where(TestCaseVersion.test_case_id == case.id)
            .order_by(TestCaseVersion.version_number.desc())
        )
        .scalars()
        .first()
        or 0
    ) + 1

    version = TestCaseVersion(
        tenant_id=tenant_id,
        test_case_id=case.id,
        version_number=next_number,
        title=title,
        description=description,
        scenario_id=scenario_id,
        scenario_description=scenario_description,
        prerequisite=prerequisite,
        test_data=test_data,
        postconditions=postconditions,
        expected_result=expected_result,
        created_by=actor_user_id,
    )
    db.add(version)
    db.flush()

    _add_steps(db, tenant_id, version.id, steps)
    case.current_version_id = version.id
    return version


def _add_steps(db: Session, tenant_id: UUID, version_id: UUID, steps: list[StepIn]) -> None:
    """Steps are numbered 1..n from their position in the list (a reorder is the
    same list in a new order); any `step_no` the caller sent is ignored."""
    for i, step in enumerate(steps, start=1):
        db.add(
            TestCaseVersionStep(
                tenant_id=tenant_id,
                test_case_version_id=version_id,
                step_number=i,
                action=step.action,
                expected=step.expected,
                test_data=step.test_data,
            )
        )
    db.flush()


def _steps_summary(steps: Sequence[StepIn | StepOut]) -> str:
    """Compact text of a step list for the audit diff (truncated by audit_diff)."""
    parts = []
    for i, s in enumerate(steps, start=1):
        data = f" [{s.test_data}]" if s.test_data else ""
        parts.append(f"{i}. {s.action} -> {s.expected}{data}")
    return f"{len(steps)} steps: " + " | ".join(parts)


def _case_snapshot(
    case: TestCase, version: TestCaseVersion | None, steps: Sequence[StepIn | StepOut] | None
) -> dict[str, Any]:
    """The tracked fields of a case as plain values, for the audit before/after."""
    snap: dict[str, Any] = {
        "title": case.title,
        "priority": case.priority,
        "assignee_id": case.assignee_id,
        "module_id": case.module_id,
        "test_type": case.test_type,
        "severity": case.severity,
        "automation_status": case.automation_status,
        "environment": case.environment,
        "requirement_ref": case.requirement_ref,
    }
    if version is not None:
        snap.update(
            description=version.description,
            preconditions=version.prerequisite,
            test_data=version.test_data,
            expected_result=version.expected_result,
            postconditions=version.postconditions,
            scenario_id=version.scenario_id,
            scenario_description=version.scenario_description,
        )
    if steps is not None:
        snap["steps"] = _steps_summary(steps)
    return snap


def create_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: TestCaseCreateRequest,
) -> TestCase:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    field_option_service.validate_code(db, tenant_id, "test_case_priority", req.priority)
    _validate_option_fields(db, tenant_id, test_type=req.test_type, severity=req.severity)
    if req.module_id is not None:
        _validate_module(db, tenant_id, project_id, req.module_id)

    display_seq, display_id = display_id_service.next_display_id(db, tenant_id, "test_case")
    case = TestCase(
        tenant_id=tenant_id,
        project_id=project_id,
        title=req.title,
        priority=req.priority,
        status="draft",
        assignee_id=req.assignee_id,
        module_id=req.module_id,
        created_by=actor_user_id,
        display_seq=display_seq,
        display_id=display_id,
        test_type=req.test_type,
        severity=req.severity,
        automation_status=req.automation_status or DEFAULT_AUTOMATION_STATUS,
        environment=req.environment,
        requirement_ref=req.requirement_ref,
    )
    db.add(case)
    db.flush()

    version = _write_version(
        db,
        tenant_id,
        case,
        req.title,
        req.description or "",
        req.steps,
        actor_user_id,
        req.scenario_id,
        req.scenario_description,
        req.preconditions,
        req.test_data,
        req.postconditions,
        req.expected_result,
    )

    if req.assignee_id is not None:
        _notify_assignee(db, tenant_id, actor_user_id, req.assignee_id, case)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.created",
        entity_type="test_case",
        entity_id=case.id,
        metadata={
            "title": case.title,
            "project_id": str(project_id),
            "display_id": case.display_id,
            # from None to the initial values (long text is truncated).
            "changes": audit_diff({}, _case_snapshot(case, version, req.steps)),
        },
    )
    db.commit()
    return case


def _notify_assignee(
    db: Session, tenant_id: UUID, actor_user_id: UUID, assignee_id: UUID, case: TestCase
) -> None:
    assignee = db.execute(select(User).where(User.id == assignee_id)).scalar_one_or_none()
    if assignee is None:
        return
    notification_service.notify(
        db,
        tenant_id,
        actor_user_id,
        assignee_id,
        assignee.email,
        "test_case_assigned",
        "A test case was assigned to you",
        f'"{case.title}" was assigned to you.',
        "test_case",
        case.id,
    )


# Fields whose change counts as a content edit (versioned, ADR-003/ADR-020).
_CONTENT_KEYS = (
    "title",
    "description",
    "scenario_id",
    "scenario_description",
    "preconditions",
    "test_data",
    "expected_result",
    "postconditions",
    "steps",
)


def update_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    req: TestCaseUpdateRequest,
) -> TestCase:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, case)

    changes = req.model_dump(exclude_unset=True)
    changes.pop("test_data_format", None)  # a hint about the request, not a field
    # The display id never changes. Echoing the current value back (a form that
    # re-sends the whole record) is harmless; any other value is refused.
    sent_display_id = changes.pop("display_id", None)
    if sent_display_id is not None and sent_display_id != case.display_id:
        raise ValidationAppError(
            "display_id is immutable and cannot be changed", fields={"display_id": "immutable"}
        )

    # ADR-070 rule A: priority / assignee / module (and, ADR-116, test type,
    # severity, automation status, environment, requirement ref) are metadata of
    # the case, not of the approved test content. Editing ONLY those never forks a
    # new version and never un-approves the case; any change to the content
    # (title, description, steps, scenario, preconditions, test data, expected
    # result, postconditions) still follows ADR-020 exactly as before. (Computed
    # below, once the new content values are resolved.)
    current_version = _get_current_version(db, case)
    current_steps_out = _steps_for_version(db, current_version.id)
    before = _case_snapshot(case, current_version, current_steps_out)

    # Legacy rows may have empty "mandatory" fields; an update is only refused when
    # it CLEARS a value the case has (never merely because a legacy value is empty).
    cleared: dict[str, str] = {}
    if "module_id" in changes and changes["module_id"] is None and case.module_id is not None:
        cleared["module_id"] = "Module cannot be cleared"
    for key, label, current in (
        ("preconditions", "Preconditions", current_version.prerequisite),
        ("test_data", "Test data", current_version.test_data),
        ("expected_result", "Expected result", current_version.expected_result),
    ):
        if key in changes and _blank(changes[key]) and not _blank(current):
            cleared[key] = f"{label} cannot be cleared"
    if "priority" in changes and not changes["priority"]:
        cleared["priority"] = "Priority cannot be empty"
    if cleared:
        raise ValidationAppError(
            "Required fields cannot be cleared: " + ", ".join(cleared), fields=cleared
        )

    new_title: str = req.title if req.title is not None else current_version.title
    new_description: str = (
        req.description if req.description is not None else current_version.description
    )
    new_scenario_id = req.scenario_id if "scenario_id" in changes else current_version.scenario_id
    new_scenario_description = (
        req.scenario_description
        if "scenario_description" in changes
        else current_version.scenario_description
    )
    new_prerequisite = (
        req.preconditions if "preconditions" in changes else current_version.prerequisite
    )
    new_test_data = req.test_data if "test_data" in changes else current_version.test_data
    new_postconditions = (
        req.postconditions if "postconditions" in changes else current_version.postconditions
    )
    new_expected_result = (
        req.expected_result if "expected_result" in changes else current_version.expected_result
    )
    new_steps: list[StepIn]
    if req.steps is not None:
        new_steps = req.steps
    else:
        new_steps = [
            StepIn(action=s.action, expected=s.expected, test_data=s.test_data)
            for s in current_steps_out
        ]

    # A content field only counts as changed if its value actually differs --
    # a form that re-submits the unchanged content alongside a new priority
    # or assignee is still a metadata-only edit.
    current_steps = [(st.action, st.expected, st.test_data) for st in current_steps_out]
    content_changed = (
        new_title != current_version.title
        or new_description != current_version.description
        or new_scenario_id != current_version.scenario_id
        or new_scenario_description != current_version.scenario_description
        or new_prerequisite != current_version.prerequisite
        or new_test_data != current_version.test_data
        or new_postconditions != current_version.postconditions
        or new_expected_result != current_version.expected_result
        or [(st.action, st.expected, st.test_data) for st in new_steps] != current_steps
    )
    was_approved = case.status == "approved" and content_changed

    if "priority" in changes:
        field_option_service.validate_code(db, tenant_id, "test_case_priority", changes["priority"])
    _validate_option_fields(
        db,
        tenant_id,
        test_type=changes.get("test_type"),
        severity=changes.get("severity"),
        current_test_type=case.test_type,
        current_severity=case.severity,
    )
    if "module_id" in changes and changes["module_id"] is not None:
        _validate_module(db, tenant_id, case.project_id, changes["module_id"])

    if not content_changed:
        pass  # metadata-only edit: nothing to version (rule A, see above)
    elif was_approved:
        # ADR-020: any content edit to an approved case forks a new version and
        # reverts to draft, pending re-approval. The previous version row and its
        # steps are left untouched (immutable snapshots, ADR-003).
        _write_version(
            db,
            tenant_id,
            case,
            new_title,
            new_description,
            new_steps,
            actor_user_id,
            new_scenario_id,
            new_scenario_description,
            new_prerequisite,
            new_test_data,
            new_postconditions,
            new_expected_result,
        )
        case.status = "draft"
    else:
        # ADR-020: draft/ready_for_review edits mutate the current version
        # in place -- nothing has been approved or executed against it yet.
        current_version.title = new_title
        current_version.description = new_description
        current_version.scenario_id = new_scenario_id
        current_version.scenario_description = new_scenario_description
        current_version.prerequisite = new_prerequisite
        current_version.test_data = new_test_data
        current_version.postconditions = new_postconditions
        current_version.expected_result = new_expected_result
        if "steps" in changes:
            db.query(TestCaseVersionStep).filter(
                TestCaseVersionStep.test_case_version_id == current_version.id
            ).delete()
            db.flush()
            _add_steps(db, tenant_id, current_version.id, new_steps)

    if "title" in changes and changes["title"] is not None:
        case.title = changes["title"]
    if "priority" in changes:
        case.priority = changes["priority"]
    if "assignee_id" in changes:
        previous_assignee_id = case.assignee_id
        case.assignee_id = changes["assignee_id"]
        if case.assignee_id is not None and case.assignee_id != previous_assignee_id:
            _notify_assignee(db, tenant_id, actor_user_id, case.assignee_id, case)
    if "module_id" in changes and changes["module_id"] is not None:
        case.module_id = changes["module_id"]
    for key in ("test_type", "severity", "environment", "requirement_ref"):
        if key in changes:
            setattr(case, key, changes[key])
    if "automation_status" in changes:
        # Never NULL: clearing falls back to the default.
        case.automation_status = changes["automation_status"] or DEFAULT_AUTOMATION_STATUS

    after_version = _get_current_version(db, case)
    diff = audit_diff(before, _case_snapshot(case, after_version, new_steps))
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.updated",
        entity_type="test_case",
        entity_id=case.id,
        metadata={
            "reverted_to_draft": was_approved,
            "fields": sorted(changes),
            "changes": diff,
        },
    )
    db.commit()
    return case


def bulk_update_metadata(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    req: TestCaseBulkUpdateRequest,
    can_edit: Callable[[UUID], bool],
) -> TestCaseBulkUpdateResult:
    """ADR-070: apply a priority and/or assignee change to many test cases,
    one item at a time through `update_test_case` (so project access, the
    priority option check, assignee notification, audit entry and the
    no-version-fork rule are all inherited, not re-implemented). `can_edit`
    is the caller's project-scoped `testcase.edit` check. A failure on one
    item (no permission, not in project, bad assignee) is reported for that
    item and does not stop the rest."""
    fields = req.model_fields_set & {"priority", "assignee_id"}
    if not fields:
        raise ValidationAppError("Choose a priority or an assignee to apply")
    if "priority" in fields and req.priority is None:
        raise ValidationAppError("Priority cannot be empty")

    update_kwargs: dict = {}
    if "priority" in fields:
        update_kwargs["priority"] = req.priority
    if "assignee_id" in fields:
        update_kwargs["assignee_id"] = req.assignee_id

    results: list[BulkItemResult] = []
    for test_case_id in dict.fromkeys(req.test_case_ids):
        # The RLS tenant GUC is transaction-local and resets on COMMIT
        # (ADR-007): each update_test_case below commits, so re-assert it
        # before every item.
        set_tenant_context(db, str(tenant_id))
        try:
            case = _get_test_case_or_404(db, tenant_id, test_case_id)
            if not can_edit(case.project_id):
                raise ForbiddenError("Missing permission: testcase.edit")
            update_test_case(
                db,
                tenant_id,
                role_code,
                actor_user_id,
                test_case_id,
                TestCaseUpdateRequest(**update_kwargs),
            )
            results.append(BulkItemResult(test_case_id=test_case_id, ok=True))
        except AppError as exc:
            db.rollback()
            set_tenant_context(db, str(tenant_id))
            results.append(BulkItemResult(test_case_id=test_case_id, ok=False, error=exc.message))

    updated = sum(1 for r in results if r.ok)
    return TestCaseBulkUpdateResult(updated=updated, failed=len(results) - updated, results=results)


def _notify_reviewer(
    db: Session, tenant_id: UUID, actor_user_id: UUID, reviewer_id: UUID, case: TestCase
) -> None:
    reviewer = db.execute(select(User).where(User.id == reviewer_id)).scalar_one_or_none()
    if reviewer is None:
        return
    notification_service.notify(
        db,
        tenant_id,
        actor_user_id,
        reviewer_id,
        reviewer.email,
        "review_requested",
        "A test case needs your review",
        f'"{case.title}" was submitted for your review.',
        "test_case",
        case.id,
    )


def _notify_author_of_decision(
    db: Session, tenant_id: UUID, actor_user_id: UUID, case: TestCase, decision: str
) -> None:
    notification_service.notify(
        db,
        tenant_id,
        actor_user_id,
        case.created_by,
        None,
        "review_decided",
        "Your test case review is complete",
        f'"{case.title}" was {decision}.',
        "test_case",
        case.id,
    )


def submit_for_review(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    reviewer_id: UUID | None = None,
) -> TestCase:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, case)

    if case.status != "draft":
        raise ConflictError(f"Cannot submit for review from status '{case.status}'")

    if reviewer_id is not None:
        reviewer = db.execute(
            select(User).where(User.tenant_id == tenant_id, User.id == reviewer_id)
        ).scalar_one_or_none()
        if reviewer is None:
            raise NotFoundError("Reviewer not found")

    case.status = "ready_for_review"
    case.reviewer_id = reviewer_id
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.submitted_for_review",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"reviewer_id": str(reviewer_id) if reviewer_id else None},
    )
    if reviewer_id is not None:
        _notify_reviewer(db, tenant_id, actor_user_id, reviewer_id, case)
    db.commit()
    return case


def _authorize_reviewer(case: TestCase, role_code: str, actor_user_id: UUID) -> None:
    """When a specific reviewer was named, only they (or an Admin) may
    decide; otherwise anyone holding testcase.approve (enforced by the
    route dependency) may act, preserving today's behavior."""
    if case.reviewer_id is not None and case.reviewer_id != actor_user_id and role_code != "admin":
        raise ForbiddenError("Only the assigned reviewer may act on this review")


def approve_test_case(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, test_case_id: UUID
) -> TestCase:
    """Caller must already hold testcase.approve (manager/admin only)."""
    case = _get_test_case_or_404(db, tenant_id, test_case_id)

    if case.status != "ready_for_review":
        raise ConflictError(f"Cannot approve from status '{case.status}'")
    _authorize_reviewer(case, role_code, actor_user_id)

    version = _get_current_version(db, case)
    from datetime import UTC, datetime

    version.approved_by = actor_user_id
    version.approved_at = datetime.now(UTC)
    case.status = "approved"
    case.reviewer_id = None

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.approved",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"version_number": version.version_number},
    )
    _notify_author_of_decision(db, tenant_id, actor_user_id, case, "approved")
    db.commit()
    return case


def request_changes_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    comment_body: str,
) -> TestCase:
    """Reviewer-only (or Admin). Reuses the Comment infrastructure (Phase 8)
    to carry the feedback, and sends the case back to 'draft' -- the same
    forward-only status machine submit_for_review/approve already use, not
    a new 'changes_requested' status."""
    from app.schemas.comment import CommentCreateRequest
    from app.services import comment_service

    case = _get_test_case_or_404(db, tenant_id, test_case_id)

    if case.status != "ready_for_review":
        raise ConflictError(f"Cannot request changes from status '{case.status}'")
    _authorize_reviewer(case, role_code, actor_user_id)

    comment_service.create_comment(
        db,
        tenant_id,
        role_code,
        actor_user_id,
        "test_case",
        case.id,
        CommentCreateRequest(body=comment_body, mentioned_user_ids=[]),
    )

    case.status = "draft"
    case.reviewer_id = None

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.changes_requested",
        entity_type="test_case",
        entity_id=case.id,
    )
    _notify_author_of_decision(
        db, tenant_id, actor_user_id, case, "sent back with requested changes"
    )
    db.commit()
    return case


def deprecate_test_case(
    db: Session, tenant_id: UUID, actor_user_id: UUID, test_case_id: UUID
) -> TestCase:
    """Caller must already hold testcase.deprecate (manager/admin only)."""
    case = _get_test_case_or_404(db, tenant_id, test_case_id)

    if case.status == "deprecated":
        raise ConflictError("Test case is already deprecated")

    previous_status = case.status
    case.status = "deprecated"

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.deprecated",
        entity_type="test_case",
        entity_id=case.id,
        metadata={"previous_status": previous_status},
    )
    db.commit()
    return case


def delete_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    *,
    can_delete: bool = True,
) -> None:
    """ADR-116: SOFT delete (`deleted_at` / `deleted_by`; the ORM hook then hides the
    case from lists, search, counts, reports, exports and uniqueness checks).

    Runs, run cases, defects, versions, comments and attachments are kept, so the
    execution history of a deleted case stays readable by id (Admin / Manager) and
    the display id is never reused. The old guard that refused deletion once a case
    had runs or defects is gone for that reason.

    `can_delete` is the caller's `testcase.delete` permission (project-role overrides
    applied by the route). Without it a Tester-tier caller may still delete their own
    draft, exactly as before."""
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, case)

    if not can_delete:
        if role_code == "tester":
            if not (case.status == "draft" and case.created_by == actor_user_id):
                raise ForbiddenError("Testers may only delete their own draft test cases")
        else:
            raise ForbiddenError("Missing permission: testcase.delete")

    case.deleted_at = datetime.now(UTC)
    case.deleted_by = actor_user_id

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.deleted",
        entity_type="test_case",
        entity_id=test_case_id,
        metadata={
            "soft": True,
            "display_id": case.display_id,
            "title": case.title,
            "status": case.status,
        },
    )
    db.commit()


def duplicate_test_case(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, test_case_id: UUID
) -> TestCase:
    """ADR-116: copy the DEFINITION of a case into a new draft with a new display id
    and the title suffixed ' (Copy)'. Executions, defects, comments, attachments,
    requirement links and custom field values are not copied; the assignee and
    reviewer are not carried over."""
    source = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, source)
    version = _get_current_version(db, source)
    steps = _steps_for_version(db, version.id)

    suffix = " (Copy)"
    title = source.title[: 255 - len(suffix)] + suffix
    display_seq, display_id = display_id_service.next_display_id(db, tenant_id, "test_case")
    case = TestCase(
        tenant_id=tenant_id,
        project_id=source.project_id,
        title=title,
        priority=source.priority,
        status="draft",
        module_id=source.module_id,
        created_by=actor_user_id,
        display_seq=display_seq,
        display_id=display_id,
        test_type=source.test_type,
        severity=source.severity,
        automation_status=source.automation_status or DEFAULT_AUTOMATION_STATUS,
        environment=source.environment,
        requirement_ref=source.requirement_ref,
    )
    db.add(case)
    db.flush()
    _write_version(
        db,
        tenant_id,
        case,
        title,
        version.description,
        [StepIn(action=s.action, expected=s.expected, test_data=s.test_data) for s in steps],
        actor_user_id,
        version.scenario_id,
        version.scenario_description,
        version.prerequisite,
        version.test_data,
        version.postconditions,
        version.expected_result,
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.duplicated",
        entity_type="test_case",
        entity_id=case.id,
        metadata={
            "source_test_case_id": str(source.id),
            "source_display_id": source.display_id,
            "display_id": case.display_id,
            "title": title,
        },
    )
    db.commit()
    return case


def list_executions(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    test_case_id: UUID,
    *,
    page: int = 1,
    page_size: int = 20,
) -> TestCaseExecutionListResponse:
    """ADR-116: the execution history of one case for its history tab -- one row
    per test run case (run, date, executor, status, actual result, linked defects,
    version number), newest first. Readable for a soft-deleted case by Admin and
    Manager."""
    case = _get_test_case_or_404(
        db, tenant_id, test_case_id, include_deleted=True, role_code=role_code
    )
    _authorize_case_access(db, tenant_id, role_code, user_id, case)
    set_tenant_context(db, str(tenant_id))

    page = max(page, 1)
    page_size = min(max(page_size, 1), EXECUTION_HISTORY_MAX_PAGE_SIZE)
    when = func.coalesce(TestRunCase.executed_at, TestRunCase.completed_at, TestRunCase.started_at)
    base = (
        select(TestRunCase, TestRun, TestCaseVersion.version_number)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .join(TestCaseVersion, TestCaseVersion.id == TestRunCase.test_case_version_id)
        .where(
            TestRunCase.tenant_id == tenant_id,
            TestRunCase.test_case_id == test_case_id,
            TestRun.deleted_at.is_(None),
        )
    )
    total = db.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    rows = db.execute(
        base.order_by(when.desc().nulls_last(), TestRunCase.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()

    run_case_ids = [rc.id for rc, _run, _v in rows]
    run_ids = [run.id for _rc, run, _v in rows]
    # Executor fallback for legacy run cases that predate executed_by.
    step_executors: dict[UUID, UUID] = {}
    if run_case_ids:
        for rc_id, executor in db.execute(
            select(ExecutionStep.test_run_case_id, ExecutionStep.executed_by)
            .where(
                ExecutionStep.test_run_case_id.in_(run_case_ids),
                ExecutionStep.executed_by.is_not(None),
            )
            .distinct(ExecutionStep.test_run_case_id)
            .order_by(ExecutionStep.test_run_case_id, ExecutionStep.closed_at.desc().nulls_last())
        ):
            step_executors[rc_id] = executor
    names = lookups.value_map(
        db,
        User.id,
        User.name,
        [rc.executed_by for rc, _r, _v in rows] + list(step_executors.values()),
    )
    defects_by_rc: dict[UUID, list[LinkedDefectOut]] = {}
    defects_by_run: dict[UUID, list[LinkedDefectOut]] = {}
    if run_ids:
        for d in db.execute(
            select(
                Defect.id,
                Defect.display_id,
                Defect.title,
                Defect.status,
                Defect.test_run_id,
                Defect.test_run_case_id,
            )
            .where(Defect.test_case_id == test_case_id, Defect.test_run_id.in_(run_ids))
            .order_by(Defect.created_at)
        ):
            out = LinkedDefectOut(id=d.id, display_id=d.display_id, title=d.title, status=d.status)
            if d.test_run_case_id is not None:
                defects_by_rc.setdefault(d.test_run_case_id, []).append(out)
            else:
                defects_by_run.setdefault(d.test_run_id, []).append(out)

    items: list[TestCaseExecutionOut] = []
    for rc, run, version_number in rows:
        executor = rc.executed_by or step_executors.get(rc.id)
        items.append(
            TestCaseExecutionOut(
                test_run_case_id=rc.id,
                test_run_id=run.id,
                run_name=run.name,
                run_type=run.run_type,
                run_finished=run.finished_at is not None,
                executed_at=rc.executed_at or rc.completed_at or rc.started_at,
                executed_by_id=executor,
                executed_by_name=names.get(executor),
                status=rc.status,
                execution_status=execution_status_label(rc.status),
                actual_result=rc.actual_result,
                blocked_reason=rc.blocked_reason,
                version_number=version_number,
                defects=defects_by_rc.get(rc.id, []) + defects_by_run.get(run.id, []),
            )
        )
    return TestCaseExecutionListResponse(items=items, total=total)


def get_field_catalog() -> TestCaseFieldCatalogOut:
    """ADR-116: the 22 fields (keys, labels, types, flags) and the default visible
    columns, so the UI's column picker is driven by the server."""
    fields = [
        FieldSpecOut(
            key=f.key,
            label=f.label,
            type=f.type,
            group=f.group,
            sortable=f.sortable,
            filterable=f.filterable,
            editable=f.editable,
            mandatory_on_create=f.mandatory_on_create,
            default_visible=f.default_visible,
        )
        for f in TEST_CASE_FIELDS
    ]
    return TestCaseFieldCatalogOut(
        fields=fields,
        default_columns=list(DEFAULT_VISIBLE_TEST_CASE_FIELDS),
        sortable=[f.key for f in TEST_CASE_FIELDS if f.sortable],
        filters=[
            "search",
            "priority",
            "status",
            "assignee_id",
            "module_id",
            "test_type",
            "severity",
            "automation_status",
            "environment",
            "execution_status",
            "executed_by",
            "quarantined",
        ],
        automation_statuses=list(AUTOMATION_STATUSES),
        execution_statuses=list(EXECUTION_STATUSES),
    )


def _set_quarantine(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    *,
    reason: str | None,
) -> TestCase:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _authorize_case_access(db, tenant_id, role_code, actor_user_id, case)
    if reason is not None:
        if case.quarantined:
            raise ConflictError("Test case is already quarantined")
        case.quarantined = True
        case.quarantine_reason = reason
        case.quarantined_by = actor_user_id
        case.quarantined_at = datetime.now(UTC)
        action, meta = "testcase.quarantined", {"reason_length": len(reason)}
    else:
        if not case.quarantined:
            raise ConflictError("Test case is not quarantined")
        case.quarantined = False
        case.quarantine_reason = None
        case.quarantined_by = None
        case.quarantined_at = None
        action, meta = "testcase.unquarantined", {}
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action=action,
        entity_type="test_case",
        entity_id=case.id,
        metadata=meta,
    )
    db.commit()
    return case


def quarantine_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    test_case_id: UUID,
    reason: str,
) -> TestCase:
    """ADR-097: manual only; caller already holds testcase.approve."""
    return _set_quarantine(
        db, tenant_id, role_code, actor_user_id, test_case_id, reason=reason.strip()
    )


def unquarantine_test_case(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, test_case_id: UUID
) -> TestCase:
    return _set_quarantine(db, tenant_id, role_code, actor_user_id, test_case_id, reason=None)
