from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from rapidfuzz import fuzz
from sqlalchemy import Select, func, or_, select, tuple_
from sqlalchemy.orm import Session

from app.core import pagination
from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models.audit import AuditLog
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project
from app.models.tenant import Tenant
from app.models.test_asset import Build, Environment, Release
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_module import TestModule
from app.schemas.defect import (
    DefectCreateRequest,
    DefectHistoryEntryOut,
    DefectLinkCreateRequest,
    DefectLinkOut,
    DefectOut,
    DefectStatus,
    DefectUpdateRequest,
    ExecutionEvidenceOut,
    LinkableType,
    LinkType,
    PossibleDuplicateOut,
    Priority,
    RootCause,
    Severity,
    Verdict,
)
from app.services import (
    custom_field_service,
    field_option_service,
    lookups,
    notification_service,
    status_label_service,
)
from app.services.project_service import is_assigned

# ADR-026: strictly sequential, no skipping, no reopening.
STATUS_ORDER: list[DefectStatus] = ["New", "Open", "Fixed", "Verified", "Closed"]

# Phase 6 (PV-6.2): fixed SLA budget in days per severity, not tenant-
# configurable (Phase 22 is where tenant-configurable taxonomies/thresholds
# belong -- this is a simple, additive default, not a full SLA engine).
SLA_DAYS_BY_SEVERITY: dict[str, int] = {
    "Critical": 2,
    "High": 5,
    "Medium": 10,
    "Low": 20,
}


def compute_aging(defect: Defect) -> tuple[int, bool]:
    """Returns (age_days, sla_breached). age_days measures the full
    lifecycle to date: time-to-close for a closed defect, time-still-open
    for an open one. sla_breached flags either case where that duration
    exceeds the severity's budget -- a currently-overdue open defect, or a
    closed one that took longer than budget to resolve."""
    end = defect.closed_at if defect.closed_at is not None else datetime.now(UTC)
    age_days = (end - defect.created_at).days
    threshold = SLA_DAYS_BY_SEVERITY.get(defect.severity, 10)
    return age_days, age_days > threshold


_TERMINAL_STATUSES = {"Closed"}


def sweep_sla_breaches(db: Session) -> int:
    """Pass C (deferred item #4, bug #19): `sla_breached` is computed
    lazily at read-time from `created_at` -- there is no mutation event to
    hook a notification onto, since a defect crosses into breach purely by
    time passing, not by anyone editing it. Run periodically by the worker
    (app.worker) rather than at request time. `sla_breach_notified_at`
    guards against re-notifying the same breach on every poll. Returns the
    number of notifications sent, for the worker's own logging."""
    notified = 0
    tenant_ids = db.execute(
        select(Tenant.id).where(Tenant.status == "approved")
    ).scalars().all()
    for tenant_id in tenant_ids:
        set_tenant_context(db, str(tenant_id))
        candidates = db.execute(
            select(Defect).where(
                Defect.tenant_id == tenant_id,
                Defect.status.notin_(_TERMINAL_STATUSES),
                Defect.sla_breach_notified_at.is_(None),
            )
        ).scalars().all()
        for defect in candidates:
            _, breached = compute_aging(defect)
            if not breached:
                continue
            recipients = {defect.reported_by}
            if defect.assigned_to is not None:
                recipients.add(defect.assigned_to)
            for recipient_id in recipients:
                user = db.execute(
                    select(User).where(User.id == recipient_id)
                ).scalar_one_or_none()
                if user is None:
                    continue
                notification_service.notify(
                    db,
                    tenant_id,
                    None,
                    recipient_id,
                    user.email,
                    "defect_sla_breach",
                    "A defect has breached its SLA",
                    f'"{defect.title}" has exceeded its SLA budget for {defect.severity} severity.',
                    "defect",
                    defect.id,
                )
                notified += 1
            defect.sla_breach_notified_at = datetime.now(UTC)
        if candidates:
            db.commit()
    return notified


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _assigned_project_ids(db: Session, user_id: UUID) -> set[UUID]:
    from app.models.project import ProjectMember

    return set(
        db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        ).scalars()
    )


def _validate_assignee_membership(
    db: Session, project: Project, assignee_id: UUID | None
) -> None:
    """Pass 2: Defect.assigned_to is confirmed-scoped to users already
    assigned to the defect's own project -- same membership rule used
    everywhere else (_require_project_access), never any tenant user."""
    if assignee_id is None:
        return
    assignee = db.execute(select(User).where(User.id == assignee_id)).scalar_one_or_none()
    if assignee is None or assignee.tenant_id != project.tenant_id:
        raise ValidationAppError("assigned_to must be an active user in this tenant")
    if not is_assigned(db, project, assignee_id):
        raise ValidationAppError("assigned_to must be a member of this defect's project")


def _validate_module(
    db: Session, tenant_id: UUID, project_id: UUID, module_id: UUID | None
) -> None:
    if module_id is None:
        return
    module = db.execute(
        select(TestModule).where(
            TestModule.tenant_id == tenant_id,
            TestModule.id == module_id,
            TestModule.project_id == project_id,
        )
    ).scalar_one_or_none()
    if module is None:
        raise ValidationAppError("module_id must belong to this defect's project")


def create_defect(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, req: DefectCreateRequest
) -> Defect:
    test_case_id: UUID | None = req.test_case_id
    test_case_version_id: UUID | None = None
    test_run_id: UUID | None = None
    test_case_version_step_id: UUID | None = None
    title = req.title
    expected_result = req.expected_result

    if req.execution_step_id is not None:
        step = db.execute(
            select(ExecutionStep).where(
                ExecutionStep.tenant_id == tenant_id, ExecutionStep.id == req.execution_step_id
            )
        ).scalar_one_or_none()
        if step is None:
            raise NotFoundError("Execution step not found")

        run_case = db.execute(
            select(TestRunCase).where(TestRunCase.id == step.test_run_case_id)
        ).scalar_one()
        run = db.execute(select(TestRun).where(TestRun.id == run_case.test_run_id)).scalar_one()
        version_step = db.execute(
            select(TestCaseVersionStep).where(
                TestCaseVersionStep.id == step.test_case_version_step_id
            )
        ).scalar_one()

        project_id = run.project_id
        test_case_id = run_case.test_case_id
        test_case_version_id = run_case.test_case_version_id
        test_run_id = run.id
        test_case_version_step_id = step.test_case_version_step_id

        if title is None:
            # FR-EXEC-003's auto-suggested title.
            title = f"Step {version_step.step_number} Failed: {version_step.action}"
        if expected_result is None:
            expected_result = version_step.expected
    elif req.test_run_id is not None:
        # In-run, not-step-specific: a general issue about this run.
        run_only = db.execute(
            select(TestRun).where(TestRun.tenant_id == tenant_id, TestRun.id == req.test_run_id)
        ).scalar_one_or_none()
        if run_only is None:
            raise NotFoundError("Test run not found")
        project_id = run_only.project_id
        test_run_id = run_only.id
    else:
        assert req.project_id is not None  # enforced by the schema validator
        project_id = req.project_id

    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    _enforce_environment_rules(
        db, tenant_id, role_code, project_id, "defect.create", req.environment, req.environment_id
    )
    field_option_service.validate_code(db, tenant_id, "defect_severity", req.severity)
    field_option_service.validate_code(db, tenant_id, "defect_priority", req.priority)
    _validate_assignee_membership(db, project, req.assigned_to)
    _validate_module(db, tenant_id, project_id, req.module_id)

    assert title is not None  # enforced by the schema validator for the standalone/in-run path

    defect = Defect(
        tenant_id=tenant_id,
        project_id=project_id,
        test_case_id=test_case_id,
        test_case_version_id=test_case_version_id,
        test_run_id=test_run_id,
        test_case_version_step_id=test_case_version_step_id,
        title=title,
        severity=req.severity,
        priority=req.priority,
        description=req.description,
        steps_to_reproduce=req.steps_to_reproduce,
        actual_result=req.actual_result,
        expected_result=expected_result,
        environment=req.environment,
        environment_id=req.environment_id,
        module_id=req.module_id,
        assigned_to=req.assigned_to,
        reported_by=actor_user_id,
    )
    db.add(defect)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.created",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"title": title, "severity": req.severity},
    )
    db.commit()
    return defect


def update_defect(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    req: DefectUpdateRequest,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    changes = req.model_dump(exclude_unset=True)
    if "severity" in changes:
        new_severity = cast(str, req.severity)
        field_option_service.validate_code(db, tenant_id, "defect_severity", new_severity)
        defect.severity = new_severity
    if "priority" in changes:
        new_priority = cast(str, req.priority)
        field_option_service.validate_code(db, tenant_id, "defect_priority", new_priority)
        defect.priority = new_priority
    if "title" in changes:
        defect.title = cast(str, req.title)
    if "description" in changes:
        defect.description = req.description
    if "steps_to_reproduce" in changes:
        defect.steps_to_reproduce = req.steps_to_reproduce
    if "assigned_to" in changes:
        _validate_assignee_membership(db, project, req.assigned_to)
        defect.assigned_to = req.assigned_to
    if "module_id" in changes:
        _validate_module(db, tenant_id, project.id, req.module_id)
        defect.module_id = req.module_id

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.updated",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"fields": sorted(changes.keys())},
    )
    db.commit()
    return defect


def _get_defect_or_404(db: Session, tenant_id: UUID, defect_id: UUID) -> Defect:
    defect = db.execute(
        select(Defect).where(Defect.tenant_id == tenant_id, Defect.id == defect_id)
    ).scalar_one_or_none()
    if defect is None:
        raise NotFoundError("Defect not found")
    return defect


def delete_defect(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, defect_id: UUID
) -> None:
    """ADR-070: soft delete. The row (with its links, history and comments)
    is retained and included in tenant exports, but disappears from every
    list, count and report. Caller must already hold defect.delete."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    defect.deleted_at = datetime.now(UTC)
    defect.deleted_by = actor_user_id
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.deleted",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"title": defect.title, "status": defect.status, "severity": defect.severity},
    )
    db.commit()


def get_defect(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, defect_id: UUID
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, user_id)
    return defect


def _escape_like(value: str) -> str:
    return value.replace("/", "//").replace("%", "/%").replace("_", "/_")


def _defects_query(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None,
    status: str | None,
    severity: str | None,
    test_run_id: UUID | None = None,
    reported_by: UUID | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    test_case_id: UUID | None = None,
    search: str | None = None,
) -> Select[tuple[Defect]]:
    query = select(Defect).where(Defect.tenant_id == tenant_id)

    if project_id is not None:
        project = _get_project_or_404(db, tenant_id, project_id)
        _require_project_access(db, project, role_code, user_id)
        query = query.where(Defect.project_id == project_id)
    elif role_code == "tester":
        query = query.where(Defect.project_id.in_(_assigned_project_ids(db, user_id)))

    if test_case_id is not None:
        # Reverse navigation (test case -> its defects): visibility is
        # already scoped above by project_id/tester-assignment, this just
        # narrows further to one case.
        query = query.where(Defect.test_case_id == test_case_id)

    if status is not None:
        query = query.where(Defect.status == status)
    if severity is not None:
        query = query.where(Defect.severity == severity)
    if search:
        # ILIKE with an escaped needle (not `icontains`, which renders lower(title) LIKE)
        # so the pg_trgm GIN index on defects.title can serve it (ADR-113).
        query = query.where(Defect.title.ilike(f"%{_escape_like(search.strip())}%", escape="/"))
    if reported_by is not None:
        query = query.where(Defect.reported_by == reported_by)
    if created_from is not None:
        query = query.where(Defect.created_at >= created_from)
    if created_to is not None:
        query = query.where(Defect.created_at <= created_to)
    if test_run_id is not None:
        # GAP-20: lets a client (e.g. the Execution Console) ask "which
        # steps in this specific run already have a defect reported?" in
        # one batched call, scoped to this run so defects from other runs
        # against the same step definition (test_case_version_step_id,
        # which persists across reruns) don't false-positive. Also matches
        # defects *linked* (not originally created from) a step in this
        # run, so "link to existing defect" shows up as reported too.
        run_step_ids = select(ExecutionStep.id).where(
            ExecutionStep.test_run_case_id.in_(
                select(TestRunCase.id).where(TestRunCase.test_run_id == test_run_id)
            )
        )
        linked_defect_ids = select(DefectLink.defect_id).where(
            DefectLink.linkable_type == "execution_step", DefectLink.linkable_id.in_(run_step_ids)
        )
        query = query.where(
            or_(Defect.test_run_id == test_run_id, Defect.id.in_(linked_defect_ids))
        )

    return query

def list_defects(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None,
    status: str | None,
    severity: str | None,
    test_run_id: UUID | None = None,
    reported_by: UUID | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    test_case_id: UUID | None = None,
) -> list[Defect]:
    query = _defects_query(
        db, tenant_id, role_code, user_id, project_id, status, severity,
        test_run_id, reported_by, created_from, created_to, test_case_id,
    )
    return list(
        db.execute(
            query.order_by(Defect.created_at.desc()).limit(DEFECT_PLAIN_LIST_CAP)
        ).scalars()
    )


DEFECT_MAX_PAGE_SIZE = 100
# Hard ceiling for the legacy un-paged list (`GET /defects` without `page_size`),
# which used to return every matching defect (100k rows = a 50 s, 6.7 MB response
# on a large tenant). Callers that need more must page (ADR-113).
DEFECT_PLAIN_LIST_CAP = 5000


def list_defects_page(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None,
    status: str | None,
    severity: str | None,
    reported_by: UUID | None,
    created_from: datetime | None,
    created_to: datetime | None,
    page: int,
    page_size: int,
    search: str | None = None,
    cursor: str | None = None,
    include_total: bool = True,
) -> tuple[list[Defect], int, str | None]:
    """ADR-078: one page of the same listing, newest first, plus how many match in all.
    Same visibility and filters as `list_defects` (they share `_defects_query`).
    `cursor` (ADR-113) switches to keyset paging over (created_at DESC, id) and
    `include_total=False` skips the COUNT (total = -1); the third return value is
    the next page's cursor (None on the last page / in offset mode)."""
    query = _defects_query(
        db, tenant_id, role_code, user_id, project_id, status, severity,
        None, reported_by, created_from, created_to, None, search,
    )
    total = (
        db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
        if include_total
        else -1
    )
    page_size = min(max(page_size, 1), DEFECT_MAX_PAGE_SIZE)
    page = max(page, 1)
    ordered = query.order_by(Defect.created_at.desc(), Defect.id)
    if cursor is None:
        rows = db.execute(ordered.limit(page_size).offset((page - 1) * page_size)).scalars()
        return list(rows), total, None
    position = pagination.decode_cursor(cursor)
    if position is not None:
        ordered = ordered.where(
            pagination.keyset_after(
                Defect.created_at, Defect.id, position, created_desc=True, id_desc=False
            )
        )
    found = list(db.execute(ordered.limit(page_size + 1)).scalars())
    next_cursor = None
    if len(found) > page_size:
        found = found[:page_size]
        next_cursor = pagination.encode_cursor(found[-1].created_at, found[-1].id)
    return found, total, next_cursor


def defect_status_counts(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None,
    severity: str | None,
    reported_by: UUID | None,
    created_from: datetime | None,
    created_to: datetime | None,
    search: str | None = None,
) -> dict[str, int]:
    """ADR-078: matching defects per status, under every filter EXCEPT status, so the
    Defects page's status tabs can show each tab's count while only one page of rows
    is loaded."""
    query = _defects_query(
        db, tenant_id, role_code, user_id, project_id, None, severity,
        None, reported_by, created_from, created_to, None, search,
    )
    sub = query.subquery()
    rows = db.execute(select(sub.c.status, func.count()).group_by(sub.c.status)).all()
    return {status: count for status, count in rows}


DUPLICATE_SIMILARITY_THRESHOLD = 70.0
DUPLICATE_MAX_RESULTS = 5


def _similarity_text(defect: Defect) -> str:
    return f"{defect.title} {defect.description or ''}".strip()


def find_possible_duplicates(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    defect_id: UUID,
) -> list[PossibleDuplicateOut]:
    """Tier 2 duplicate-defect detection: a text-similarity heuristic
    (rapidfuzz token_sort_ratio on title+description), scored against other
    open defects in the same project -- suggestion only, the caller decides
    whether to link/merge. Never crosses project or tenant boundaries."""
    defect = get_defect(db, tenant_id, role_code, user_id, defect_id)
    return _score_duplicates(db, defect.project_id, _similarity_text(defect), exclude_id=defect.id)


def _score_duplicates(
    db: Session, project_id: UUID, text: str, *, exclude_id: UUID | None
) -> list[PossibleDuplicateOut]:
    candidates = db.execute(
        select(Defect).where(Defect.project_id == project_id, Defect.status != "Closed")
    ).scalars()

    scored: list[PossibleDuplicateOut] = []
    for candidate in candidates:
        if exclude_id is not None and candidate.id == exclude_id:
            continue
        score = fuzz.token_sort_ratio(text, _similarity_text(candidate))
        if score >= DUPLICATE_SIMILARITY_THRESHOLD:
            scored.append(
                PossibleDuplicateOut(
                    defect_id=candidate.id,
                    title=candidate.title,
                    status=cast(DefectStatus, candidate.status),
                    similarity=round(score, 1),
                )
            )

    scored.sort(key=lambda d: d.similarity, reverse=True)
    return scored[:DUPLICATE_MAX_RESULTS]


def update_status(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    new_status: str,
    verification_confirmed: bool = False,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if new_status == "Closed":
        # BRD §3.2: "Update Defect Status to 'Closed': Tester No."
        if role_code not in ("admin", "manager"):
            raise ForbiddenError("Only Admin/Manager can close a defect")
        # Spec: "Closing requires verification confirmation" -- a distinct
        # explicit gesture, not merely that Verified exists earlier in the
        # sequence.
        if not verification_confirmed:
            raise ValidationAppError("Closing a defect requires explicit verification confirmation")

    current_index = STATUS_ORDER.index(cast(DefectStatus, defect.status))
    try:
        target_index = STATUS_ORDER.index(cast(DefectStatus, new_status))
    except ValueError as exc:
        raise ValidationAppError(f"Unknown status: {new_status}") from exc

    if target_index != current_index + 1:
        raise ConflictError(
            f"Cannot transition from '{defect.status}' to '{new_status}'; "
            f"the only valid next status is '{STATUS_ORDER[current_index + 1]}'"
            if current_index + 1 < len(STATUS_ORDER)
            else f"'{defect.status}' is already the final status"
        )

    defect.status = new_status
    if new_status == "Closed":
        defect.closed_at = datetime.now(UTC)
        reporter = db.execute(
            select(User).where(User.id == defect.reported_by)
        ).scalar_one_or_none()
        if reporter is not None:
            notification_service.notify(
                db,
                tenant_id,
                actor_user_id,
                defect.reported_by,
                reporter.email,
                "defect_closed",
                "Your defect was closed",
                f'"{defect.title}" was closed.',
                "defect",
                defect.id,
            )

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.status_changed",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"from": STATUS_ORDER[current_index], "to": new_status},
    )
    db.commit()
    return defect


REOPENABLE_STATUSES = ("Fixed", "Verified", "Closed")


def reopen_defect(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, defect_id: UUID
) -> Defect:
    """Tier 2 (PV-6.3), option A: ADR-026's forward-only sequence stays
    intact -- update_status still refuses any backward move. This is a
    dedicated, narrowly-scoped exception: a defect that's past 'Open' can be
    pushed back to 'Open' through this path alone, and every time it is, the
    event is counted (reopened_count/last_reopened_at) rather than modeled
    as a new status. Same elevated-permission bar as closing a defect."""
    if role_code not in ("admin", "manager"):
        raise ForbiddenError("Only Admin/Manager can reopen a defect")

    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if defect.status not in REOPENABLE_STATUSES:
        raise ConflictError(
            f"Cannot reopen a defect from status '{defect.status}'; "
            f"only {', '.join(REOPENABLE_STATUSES)} can be reopened"
        )

    previous_status = defect.status
    defect.status = "Open"
    defect.closed_at = None
    defect.reopened_count += 1
    defect.last_reopened_at = datetime.now(UTC)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.reopened",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"from": previous_status, "to": "Open", "reopened_count": defect.reopened_count},
    )
    db.commit()
    return defect


def _enforce_environment_rules(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    project_id: UUID,
    action_code: str,
    environment_name: str | None,
    environment_id: UUID | None,
) -> None:
    """RBAC Phase 4 (ADR-092): environment_restriction access rules. Resolves
    the environment's name (free text or Environment row) and lets the rule
    engine decide; a no-op when the tenant has no enabled rules."""
    from app.core import access_rules

    name = environment_name
    if environment_id is not None:
        name = db.execute(
            select(Environment.name).where(
                Environment.tenant_id == tenant_id, Environment.id == environment_id
            )
        ).scalar_one_or_none() or name
    access_rules.enforce_environment(
        db,
        tenant_id=tenant_id,
        role_code=role_code,
        action_code=action_code,
        project_id=project_id,
        environment=name,
    )


def set_defect_environment(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    environment_id: UUID | None,
) -> Defect:
    """Tier 2 (PV-8.1): points a defect at a real Environment entity,
    same project-access check as update_root_cause."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    _enforce_environment_rules(
        db, tenant_id, role_code, defect.project_id, "defect.create", None, environment_id
    )

    defect.environment_id = environment_id

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.environment_set",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"environment_id": str(environment_id) if environment_id else None},
    )
    db.commit()
    return defect


def update_build_release(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    found_in_build_id: UUID | None,
    fixed_in_release_id: UUID | None,
) -> Defect:
    """Tier 2 (PV-8.2): classification metadata, same project-access check
    as update_root_cause -- not a workflow transition."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    defect.found_in_build_id = found_in_build_id
    defect.fixed_in_release_id = fixed_in_release_id

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.build_release_set",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "found_in_build_id": str(found_in_build_id) if found_in_build_id else None,
            "fixed_in_release_id": str(fixed_in_release_id) if fixed_in_release_id else None,
        },
    )
    db.commit()
    return defect


def update_root_cause(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    root_cause: str | None,
) -> Defect:
    """Classification metadata, not a workflow transition -- same
    project-access check as add_link/update_status, no extra role gate."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    previous = defect.root_cause
    defect.root_cause = root_cause

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.root_cause_set",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"from": previous, "to": root_cause},
    )
    db.commit()
    return defect


def add_link(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    req: DefectLinkCreateRequest,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    link = DefectLink(
        tenant_id=tenant_id,
        defect_id=defect_id,
        linkable_type=req.linkable_type,
        linkable_id=req.linkable_id,
        link_type=req.link_type,
    )
    db.add(link)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.link_added",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "linkable_type": req.linkable_type,
            "linkable_id": str(req.linkable_id),
            "link_type": req.link_type,
        },
    )
    db.commit()
    return defect


def get_defect_history(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, defect_id: UUID
) -> list[DefectHistoryEntryOut]:
    """Status changes and other important updates for this defect (spec H),
    reusing the existing hash-chained audit_logs table filtered by entity
    rather than a separate history table -- defects are never updated
    outside of record_audit_event-covered paths, so audit_logs is already
    complete for this purpose."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, user_id)
    set_tenant_context(db, str(tenant_id))

    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "defect",
            AuditLog.entity_id == defect_id,
        )
        .order_by(AuditLog.created_at.asc())
    ).all()
    return [
        DefectHistoryEntryOut(
            id=log.id,
            action=log.action,
            user_id=log.user_id,
            user_name=user_name,
            event_metadata=log.event_metadata or {},
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def _execution_evidences(
    db: Session, defects: list[Defect]
) -> dict[UUID, ExecutionEvidenceOut]:
    """Resolves, for a page of defects at once, the originating execution_steps
    row of every step-linked defect that can still be found
    (defect.test_run_id + test_case_id + test_case_version_step_id together pin
    it uniquely, since ExecutionStep has no direct FK back to Defect)."""
    # (defect id, run id, case id, version-step id) for every step-linked defect.
    linked: list[tuple[UUID, UUID, UUID, UUID]] = [
        (d.id, d.test_run_id, d.test_case_id, d.test_case_version_step_id)
        for d in defects
        if d.test_run_id is not None
        and d.test_case_id is not None
        and d.test_case_version_step_id is not None
    ]
    if not linked:
        return {}
    run_case_ids: dict[tuple[UUID, UUID], UUID] = {}
    pairs = list({(run_id, case_id) for _did, run_id, case_id, _step in linked})
    for trc in db.execute(
        select(TestRunCase.id, TestRunCase.test_run_id, TestRunCase.test_case_id).where(
            tuple_(TestRunCase.test_run_id, TestRunCase.test_case_id).in_(pairs)
        )
    ):
        run_case_ids.setdefault((trc.test_run_id, trc.test_case_id), trc.id)
    step_pairs = list(
        {
            (run_case_ids[(run_id, case_id)], step_id)
            for _did, run_id, case_id, step_id in linked
            if (run_id, case_id) in run_case_ids
        }
    )
    if not step_pairs:
        return {}
    steps = {
        (st.test_run_case_id, st.test_case_version_step_id): st
        for st in db.execute(
            select(ExecutionStep).where(
                tuple_(ExecutionStep.test_run_case_id, ExecutionStep.test_case_version_step_id).in_(
                    step_pairs
                )
            )
        ).scalars()
    }
    names = lookups.value_map(db, User.id, User.name, (st.executed_by for st in steps.values()))
    out: dict[UUID, ExecutionEvidenceOut] = {}
    for defect_id, run_id, case_id, step_id in linked:
        run_case_id = run_case_ids.get((run_id, case_id))
        step = steps.get((run_case_id, step_id)) if run_case_id else None
        if step is None:
            continue
        out[defect_id] = ExecutionEvidenceOut(
            execution_step_id=step.id,
            test_run_case_id=step.test_run_case_id,
            verdict=cast(Verdict, step.verdict) if step.verdict is not None else None,
            opened_at=step.opened_at,
            closed_at=step.closed_at,
            duration_ms=step.duration_ms,
            executed_by=step.executed_by,
            executed_by_name=names.get(step.executed_by),
        )
    return out


def to_out(db: Session, defect: Defect) -> DefectOut:
    return to_out_many(db, [defect])[0]


def to_out_many(db: Session, defects: list[Defect]) -> list[DefectOut]:
    """Serialize a page of defects with a constant number of queries (ADR-113)
    instead of ~15 per defect. All `defects` belong to one tenant."""
    if not defects:
        return []
    tenant_id = defects[0].tenant_id
    # See ARCHITECTURE_DECISIONS.md ADR-007 addendum.
    set_tenant_context(db, str(tenant_id))

    project_names = lookups.value_map(
        db, Project.id, Project.name, (d.project_id for d in defects)
    )
    case_titles = lookups.value_map(
        db, TestCase.id, TestCase.title, (d.test_case_id for d in defects)
    )
    version_numbers = lookups.value_map(
        db,
        TestCaseVersion.id,
        TestCaseVersion.version_number,
        (d.test_case_version_id for d in defects),
    )
    run_names = lookups.value_map(db, TestRun.id, TestRun.name, (d.test_run_id for d in defects))
    step_numbers = lookups.value_map(
        db,
        TestCaseVersionStep.id,
        TestCaseVersionStep.step_number,
        (d.test_case_version_step_id for d in defects),
    )
    evidences = _execution_evidences(db, defects)
    user_names = lookups.value_map(
        db,
        User.id,
        User.name,
        [d.reported_by for d in defects] + [d.assigned_to for d in defects],
    )
    environment_names = lookups.value_map(
        db, Environment.id, Environment.name, (d.environment_id for d in defects)
    )
    build_names = lookups.value_map(
        db, Build.id, Build.name, (d.found_in_build_id for d in defects)
    )
    release_names = lookups.value_map(
        db, Release.id, Release.name, (d.fixed_in_release_id for d in defects)
    )
    module_names = lookups.value_map(
        db, TestModule.id, TestModule.name, (d.module_id for d in defects)
    )
    defect_ids = [d.id for d in defects]
    links_by_defect: dict[UUID, list[DefectLink]] = {did: [] for did in defect_ids}
    for link_ in db.execute(
        select(DefectLink).where(DefectLink.defect_id.in_(defect_ids))
    ).scalars():
        links_by_defect[link_.defect_id].append(link_)
    status_labels = status_label_service.get_labels_map(db, tenant_id, "defect")
    custom_fields = custom_field_service.get_values_for_owners(db, tenant_id, "defect", defect_ids)

    return [
        _defect_out(
            defect,
            project_name=project_names[defect.project_id],
            test_case_title=case_titles.get(defect.test_case_id),
            test_case_version_number=version_numbers.get(defect.test_case_version_id),
            test_run_name=run_names.get(defect.test_run_id),
            step_number=step_numbers.get(defect.test_case_version_step_id),
            reported_by_name=user_names.get(defect.reported_by),
            environment_name=environment_names.get(defect.environment_id),
            found_in_build_name=build_names.get(defect.found_in_build_id),
            fixed_in_release_name=release_names.get(defect.fixed_in_release_id),
            module_name=module_names.get(defect.module_id),
            assigned_to_name=user_names.get(defect.assigned_to),
            evidence=evidences.get(defect.id),
            links=links_by_defect[defect.id],
            status_labels=status_labels,
            custom_fields=custom_fields[defect.id],
        )
        for defect in defects
    ]


def _defect_out(
    defect: Defect,
    *,
    project_name: str,
    test_case_title: str | None,
    test_case_version_number: int | None,
    test_run_name: str | None,
    step_number: int | None,
    reported_by_name: str | None,
    environment_name: str | None,
    found_in_build_name: str | None,
    fixed_in_release_name: str | None,
    module_name: str | None,
    assigned_to_name: str | None,
    evidence: ExecutionEvidenceOut | None,
    links: list[DefectLink],
    status_labels: dict[str, str],
    custom_fields: dict[str, object],
) -> DefectOut:
    test_run_case_id = evidence.test_run_case_id if evidence is not None else None
    age_days, sla_breached = compute_aging(defect)
    return DefectOut(
        id=defect.id,
        project_id=defect.project_id,
        project_name=project_name,
        test_case_id=defect.test_case_id,
        test_case_title=test_case_title,
        test_case_version_id=defect.test_case_version_id,
        test_case_version_number=test_case_version_number,
        test_run_id=defect.test_run_id,
        test_run_name=test_run_name,
        test_run_case_id=test_run_case_id,
        test_case_version_step_id=defect.test_case_version_step_id,
        step_number=step_number,
        title=defect.title,
        severity=cast(Severity, defect.severity),
        priority=cast(Priority, defect.priority),
        status=cast(DefectStatus, defect.status),
        status_label=status_labels.get(defect.status, defect.status),
        description=defect.description,
        steps_to_reproduce=defect.steps_to_reproduce,
        actual_result=defect.actual_result,
        expected_result=defect.expected_result,
        environment=defect.environment,
        environment_id=defect.environment_id,
        environment_name=environment_name,
        found_in_build_id=defect.found_in_build_id,
        found_in_build_name=found_in_build_name,
        fixed_in_release_id=defect.fixed_in_release_id,
        fixed_in_release_name=fixed_in_release_name,
        root_cause=cast(RootCause, defect.root_cause) if defect.root_cause else None,
        module_id=defect.module_id,
        module_name=module_name,
        assigned_to=defect.assigned_to,
        assigned_to_name=assigned_to_name,
        reported_by=defect.reported_by,
        reported_by_name=reported_by_name,
        created_at=defect.created_at,
        closed_at=defect.closed_at,
        age_days=age_days,
        sla_breached=sla_breached,
        reopened_count=defect.reopened_count,
        last_reopened_at=defect.last_reopened_at,
        links=[
            DefectLinkOut(
                id=link_.id,
                linkable_type=cast(LinkableType, link_.linkable_type),
                linkable_id=link_.linkable_id,
                link_type=cast(LinkType, link_.link_type),
                created_at=link_.created_at,
            )
            for link_ in links
        ],
        execution_evidence=evidence,
        custom_fields=custom_fields,
    )
