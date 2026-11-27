"""Defects: the 22-field standard (ADR-118).

Create / edit with per-field validation, the status workflow (transition table and
resolution rules in `app/core/field_standards.py`), unified test case links, listing,
search and sorting, and serialisation. Retest runs and the failed-execution draft live
in `defect_retest_service`, the export in `defect_export_service`.
"""

import re
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from rapidfuzz import fuzz
from sqlalchemy import Select, and_, case, func, or_, select, tuple_
from sqlalchemy.orm import Session

from app.core import pagination
from app.core.audit import record_audit_event
from app.core.audit_diff import audit_diff
from app.core.concurrency import bump_row_version, check_row_version
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.field_standards import (
    ALLOWED_TRANSITIONS,
    CLOSED_DEFECT_STATUSES,
    CREATE_DEFECT_STATUSES,
    DEFAULT_VISIBLE_DEFECT_FIELDS,
    DEFECT_FIELDS,
    DEFECT_STATUSES,
    PARKED_DEFECT_STATUSES,
    RESOLUTION_RULES,
    RESOLUTIONS,
    resolution_error,
    transition_error,
)
from app.core.field_standards import SLA_DAYS_BY_SEVERITY as _ALL_SLA_DAYS
from app.core.text_sanitize import clean_plain, sanitize_markdown
from app.models.audit import AuditLog
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.test_asset import Build, Environment, Release
from app.models.test_case import Attachment, TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_module import TestModule
from app.schemas.defect import (
    DefectCreateRequest,
    DefectFieldCatalogOut,
    DefectFieldSpecOut,
    DefectHistoryEntryOut,
    DefectLinkCreateRequest,
    DefectLinkOut,
    DefectOut,
    DefectStatus,
    DefectUpdateRequest,
    ExecutionEvidenceOut,
    LinkableType,
    LinkedDefectForCaseOut,
    LinkedTestCaseOut,
    LinkType,
    PossibleDuplicateOut,
    Priority,
    ReproStepIn,
    RootCause,
    Severity,
    Verdict,
)
from app.services import (
    custom_field_service,
    display_id_service,
    field_option_service,
    lookups,
    notification_service,
    status_label_service,
    task_service,
    test_case_service,
    tester_visibility,
)
from app.services.project_service import is_assigned

# ADR-026 (legacy sequence, kept for reference by older callers): the original strictly
# sequential flow. The transition table in `field_standards` supersedes it; the legacy
# sequence is a path through that table.
STATUS_ORDER: list[DefectStatus] = ["New", "Open", "Fixed", "Verified", "Closed"]

# Phase 6 (PV-6.2): fixed SLA budget in days per severity, not tenant-
# configurable (Phase 22 is where tenant-configurable taxonomies/thresholds
# belong -- this is a simple, additive default, not a full SLA engine).
# `SLA_DAYS_BY_SEVERITY` stays the legacy four (the aging report lists one bucket for
# each); `SLA_DAYS_ALL` adds the brief's Major / Minor.
SLA_DAYS_BY_SEVERITY: dict[str, int] = {
    "Critical": 2,
    "High": 5,
    "Medium": 10,
    "Low": 20,
}
SLA_DAYS_ALL: dict[str, int] = dict(_ALL_SLA_DAYS)


def compute_aging(defect: Defect) -> tuple[int, bool]:
    """Returns (age_days, sla_breached). age_days measures the full
    lifecycle to date: time-to-close for a closed defect, time-still-open
    for an open one. sla_breached flags either case where that duration
    exceeds the severity's budget -- a currently-overdue open defect, or a
    closed one that took longer than budget to resolve. A deferred defect is
    parked on purpose: it ages but never counts as breached (ADR-118)."""
    end = defect.closed_at if defect.closed_at is not None else datetime.now(UTC)
    age_days = (end - defect.created_at).days
    if defect.status in PARKED_DEFECT_STATUSES:
        return age_days, False
    threshold = SLA_DAYS_ALL.get(defect.severity, 10)
    return age_days, age_days > threshold


# Statuses the SLA sweep never notifies about: finished (Closed, Rejected) or parked.
_TERMINAL_STATUSES = set(CLOSED_DEFECT_STATUSES) | set(PARKED_DEFECT_STATUSES)


def sweep_sla_breaches(db: Session) -> int:
    """Pass C (deferred item #4, bug #19): `sla_breached` is computed
    lazily at read-time from `created_at` -- there is no mutation event to
    hook a notification onto, since a defect crosses into breach purely by
    time passing, not by anyone editing it. Run periodically by the worker
    (app.worker) rather than at request time. `sla_breach_notified_at`
    guards against re-notifying the same breach on every poll. Returns the
    number of notifications sent, for the worker's own logging."""
    notified = 0
    tenant_ids = db.execute(select(Tenant.id).where(Tenant.status == "approved")).scalars().all()
    for tenant_id in tenant_ids:
        set_tenant_context(db, str(tenant_id))
        candidates = (
            db.execute(
                select(Defect).where(
                    Defect.tenant_id == tenant_id,
                    Defect.status.notin_(_TERMINAL_STATUSES),
                    Defect.sla_breach_notified_at.is_(None),
                    # ADR-140: archived projects are read-only and need no reminders.
                    Defect.project_id.not_in(
                        select(Project.id).where(Project.archived_at.is_not(None))
                    ),
                )
            )
            .scalars()
            .all()
        )
        for defect in candidates:
            _, breached = compute_aging(defect)
            if not breached:
                continue
            recipients = {defect.reported_by}
            if defect.assigned_to is not None:
                recipients.add(defect.assigned_to)
            for recipient_id in recipients:
                user = db.execute(select(User).where(User.id == recipient_id)).scalar_one_or_none()
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


# --- lookups and access -----------------------------------------------------------------


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


def _get_defect_or_404(
    db: Session, tenant_id: UUID, defect_id: UUID, *, for_update: bool = False
) -> Defect:
    query = select(Defect).where(Defect.tenant_id == tenant_id, Defect.id == defect_id)
    if for_update:
        # ADR-136: held until commit; populate_existing re-reads an already loaded row.
        query = query.with_for_update().execution_options(populate_existing=True)
    defect = db.execute(query).scalar_one_or_none()
    if defect is None:
        raise NotFoundError("Defect not found")
    return defect


def get_defect(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    defect_id: UUID,
    *,
    for_update: bool = False,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id, for_update=for_update)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, user_id)
    return defect


def _has_permission(
    role_code: str,
    permissions: Collection[str] | None,
    *codes: str,
    tiers: tuple[str, ...] = (),
) -> bool:
    """True when the caller holds any of `codes`, or (legacy fallback) their access
    tier is one of `tiers`. `permissions=None` (an internal caller) uses the tier only."""
    if permissions is not None and any(c in permissions for c in codes):
        return True
    return role_code in tiers


def can_close(role_code: str, permissions: Collection[str] | None) -> bool:
    """`defect.close`, with the legacy Admin / Manager tier fallback (ADR-118)."""
    return _has_permission(role_code, permissions, "defect.close", tiers=("admin", "manager"))


def can_assign(role_code: str, permissions: Collection[str] | None) -> bool:
    """`defect.assign`; the seeded `defect.close` (its parent code) also satisfies it."""
    return _has_permission(role_code, permissions, "defect.assign", "defect.close")


# --- field validation -------------------------------------------------------------------


def _blank(value: str | None) -> bool:
    return value is None or not value.strip()


def _md(value: str | None) -> str | None:
    return sanitize_markdown(value) if value is not None else None


def _plain(value: str | None) -> str | None:
    return clean_plain(value) if value is not None else None


def _fields_error(fields: dict[str, str]) -> ValidationAppError:
    return ValidationAppError("Invalid fields: " + ", ".join(fields), fields=fields)


def _check_option(
    db: Session, tenant_id: UUID, key: str, code: str, field_name: str, errors: dict[str, str]
) -> None:
    try:
        field_option_service.validate_code(db, tenant_id, key, code)
    except ValidationAppError as exc:
        errors[field_name] = exc.message


def _check_assignee(
    db: Session, project: Project, assignee_id: UUID | None, errors: dict[str, str]
) -> None:
    """Pass 2 / ADR-118: Defect.assigned_to must be an ACTIVE user of this tenant who is
    a member of the defect's project -- never any tenant user."""
    if assignee_id is None:
        return
    assignee = db.execute(select(User).where(User.id == assignee_id)).scalar_one_or_none()
    if assignee is None or assignee.tenant_id != project.tenant_id or not assignee.is_active:
        errors["assigned_to"] = "assigned_to must be an active user in this tenant"
    elif not is_assigned(db, project, assignee_id):
        errors["assigned_to"] = "assigned_to must be a member of this defect's project"


def _check_module(
    db: Session, tenant_id: UUID, project_id: UUID, module_id: UUID | None, errors: dict[str, str]
) -> None:
    if module_id is None:
        return
    module = db.execute(
        select(TestModule.id).where(
            TestModule.tenant_id == tenant_id,
            TestModule.id == module_id,
            TestModule.project_id == project_id,
        )
    ).scalar_one_or_none()
    if module is None:
        errors["module_id"] = "module_id must belong to this defect's project"


def _check_asset(
    db: Session,
    tenant_id: UUID,
    model: Any,
    asset_id: UUID | None,
    project_id: UUID | None,
    field_name: str,
    errors: dict[str, str],
) -> None:
    if asset_id is None:
        return
    stmt = select(model.id).where(model.tenant_id == tenant_id, model.id == asset_id)
    if project_id is not None and hasattr(model, "project_id"):
        stmt = stmt.where(model.project_id == project_id)
    if db.execute(stmt).scalar_one_or_none() is None:
        errors[field_name] = f"{field_name} was not found in this project"


def _check_environment_id(
    db: Session, tenant_id: UUID, environment_id: UUID | None, errors: dict[str, str]
) -> None:
    if environment_id is None:
        return
    found = db.execute(
        select(Environment.id).where(
            Environment.tenant_id == tenant_id, Environment.id == environment_id
        )
    ).scalar_one_or_none()
    if found is None:
        errors["environment_id"] = "environment_id was not found"


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
        name = (
            db.execute(
                select(Environment.name).where(
                    Environment.tenant_id == tenant_id, Environment.id == environment_id
                )
            ).scalar_one_or_none()
            or name
        )
    access_rules.enforce_environment(
        db,
        tenant_id=tenant_id,
        role_code=role_code,
        action_code=action_code,
        project_id=project_id,
        environment=name,
    )


# --- repro steps ------------------------------------------------------------------------

_NUMBERING = re.compile(r"^\s*\d+\s*[.):-]\s*")


def steps_to_json(steps: Iterable[ReproStepIn]) -> list[dict[str, Any]]:
    """Steps renumbered 1..n from list order, as stored in `defects.repro_steps`."""
    out: list[dict[str, Any]] = []
    for index, step in enumerate(steps, start=1):
        item: dict[str, Any] = {
            "step_no": index,
            "action": step.action,
            "test_data": step.test_data,
            "expected_result": step.expected_result,
        }
        if step.failed:
            item["failed"] = True
        out.append(item)
    return out


def _split_legacy_line(raw: str) -> list[str]:
    """The CSV template writes '1. a|2. b' on one line: split it on the bars."""
    parts = raw.split("|")
    if len(parts) > 1 and all(_NUMBERING.match(p) for p in parts if p.strip()):
        return parts
    return [raw]


def steps_from_text(text: str | None) -> list[ReproStepIn]:
    """Legacy free text -> steps: one per non-empty line (a leading '1.' is dropped)."""
    if _blank(text):
        return []
    out: list[ReproStepIn] = []
    for raw in cast(str, text).splitlines():
        for line in _split_legacy_line(raw):
            cleaned = sanitize_markdown(_NUMBERING.sub("", line))
            if cleaned:
                out.append(ReproStepIn(action=cleaned[:2000]))
    return out


def render_steps_text(steps: list[dict[str, Any]]) -> str:
    """The legacy `steps_to_reproduce` rendering of structured steps."""
    lines: list[str] = []
    for step in steps:
        line = f"{step['step_no']}. {step['action']}"
        if step.get("test_data"):
            line += f"\n   Test data: {step['test_data']}"
        if step.get("expected_result"):
            line += f"\n   Expected: {step['expected_result']}"
        lines.append(line)
    return "\n".join(lines)


def effective_repro_steps(defect: Defect) -> list[dict[str, Any]] | None:
    """Stored steps, or (legacy rows) steps derived from the free text."""
    if defect.repro_steps is not None:
        return list(defect.repro_steps)
    derived = steps_from_text(defect.steps_to_reproduce)
    return steps_to_json(derived) if derived else None


def _steps_from_request(
    steps: list[ReproStepIn] | None, legacy_text: str | None
) -> list[ReproStepIn] | None:
    """Structured steps win over the legacy text; the text alone is converted."""
    if steps is not None:
        return steps
    if legacy_text is not None:
        return steps_from_text(legacy_text)
    return None


# --- snapshot ---------------------------------------------------------------------------

_TRACKED = (
    "title",
    "description",
    "preconditions",
    "repro_steps",
    "expected_result",
    "actual_result",
    "environment",
    "environment_id",
    "build_found",
    "found_in_build_id",
    "severity",
    "priority",
    "status",
    "resolution",
    "root_cause",
    "root_cause_notes",
    "assigned_to",
    "module_id",
    "task_id",
    "labels",
    "fix_version",
    "fixed_in_release_id",
)


def _snapshot(defect: Defect) -> dict[str, Any]:
    snap = {name: getattr(defect, name) for name in _TRACKED}
    snap["labels"] = list(defect.labels or [])
    return snap


# --- create -----------------------------------------------------------------------------


@dataclass
class Origin:
    """What a defect raised from an execution inherits from it."""

    project_id: UUID
    test_run_id: UUID
    run_id_name: str
    run_case: TestRunCase | None
    test_case_id: UUID | None
    test_case_display_id: str | None = None
    test_case_title: str | None = None
    version_number: int | None = None
    test_case_version_id: UUID | None = None
    version_step_id: UUID | None = None
    failing_exec_step_id: UUID | None = None
    failing_step_number: int | None = None
    title: str | None = None
    description: str | None = None
    preconditions: str | None = None
    steps: list[ReproStepIn] = field(default_factory=list)
    expected: str | None = None
    actual: str | None = None
    environment: str | None = None
    module_id: UUID | None = None
    executed_by: UUID | None = None
    executed_at: datetime | None = None
    evidence_step_ids: list[UUID] = field(default_factory=list)


def origin_from_run_case(
    db: Session, run_case: TestRunCase, *, step: ExecutionStep | None = None
) -> Origin:
    """The shared derivation of a defect raised from a (failed) run case; `step` pins the
    failing step when the caller named one, else the first failed step is used."""
    run = db.execute(select(TestRun).where(TestRun.id == run_case.test_run_id)).scalar_one()
    case_ = db.execute(
        select(TestCase)
        .where(TestCase.id == run_case.test_case_id)
        .execution_options(include_deleted=True)
    ).scalar_one()
    version = db.execute(
        select(TestCaseVersion).where(TestCaseVersion.id == run_case.test_case_version_id)
    ).scalar_one()
    version_steps = list(
        db.execute(
            select(TestCaseVersionStep)
            .where(TestCaseVersionStep.test_case_version_id == version.id)
            .order_by(TestCaseVersionStep.step_number)
        ).scalars()
    )
    exec_steps = {
        s.test_case_version_step_id: s
        for s in db.execute(
            select(ExecutionStep).where(ExecutionStep.test_run_case_id == run_case.id)
        ).scalars()
    }
    failing: TestCaseVersionStep | None = None
    failing_exec: ExecutionStep | None = None
    if step is not None:
        failing_exec = step
        failing = next((v for v in version_steps if v.id == step.test_case_version_step_id), None)
    else:
        for vs in version_steps:
            es = exec_steps.get(vs.id)
            if es is not None and es.verdict == "fail":
                failing, failing_exec = vs, es
                break

    steps: list[ReproStepIn] = []
    for vs in version_steps:
        steps.append(
            ReproStepIn(
                action=vs.action,
                test_data=vs.test_data,
                expected_result=vs.expected,
                failed=failing is not None and vs.id == failing.id,
            )
        )
        if failing is not None and vs.id == failing.id:
            break  # reproduction ends at the failing step

    label = f"{case_.display_id} – {case_.title}" if case_.display_id else case_.title
    desc = (
        f"Raised from the failed execution of {label} (version {version.version_number}) "
        f'in test run "{run.name}".'
    )
    if failing is not None:
        desc += f" Step {failing.step_number} failed: {failing.action}"
    return Origin(
        project_id=run.project_id,
        test_run_id=run.id,
        run_id_name=run.name,
        run_case=run_case,
        test_case_id=case_.id,
        test_case_display_id=case_.display_id,
        test_case_title=case_.title,
        version_number=version.version_number,
        test_case_version_id=run_case.test_case_version_id,
        version_step_id=failing.id if failing else None,
        failing_exec_step_id=failing_exec.id if failing_exec else None,
        failing_step_number=failing.step_number if failing else None,
        title=f"{label} failed"[:255],
        description=desc,
        preconditions=version.prerequisite,
        steps=steps,
        expected=(failing.expected if failing else None) or version.expected_result,
        actual=run_case.actual_result or (failing_exec.actual_result if failing_exec else None),
        environment=case_.environment,
        module_id=case_.module_id,
        executed_by=run_case.executed_by or (failing_exec.executed_by if failing_exec else None),
        executed_at=run_case.executed_at or run_case.completed_at,
        evidence_step_ids=[es.id for es in exec_steps.values()],
    )


def _resolve_origin(db: Session, tenant_id: UUID, req: DefectCreateRequest) -> Origin | None:
    """The execution a defect is raised from (a step, a run case, or just a run)."""
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
        origin = origin_from_run_case(db, run_case, step=step)
        version_step = db.execute(
            select(TestCaseVersionStep).where(
                TestCaseVersionStep.id == step.test_case_version_step_id
            )
        ).scalar_one()
        # FR-EXEC-003's auto-suggested title and expected result (step-level creation).
        origin.title = f"Step {version_step.step_number} Failed: {version_step.action}"
        origin.expected = version_step.expected
        origin.version_step_id = step.test_case_version_step_id
        return origin
    if req.test_run_case_id is not None:
        found_case = db.execute(
            select(TestRunCase).where(
                TestRunCase.tenant_id == tenant_id, TestRunCase.id == req.test_run_case_id
            )
        ).scalar_one_or_none()
        if found_case is None:
            raise NotFoundError("Test run case not found")
        return origin_from_run_case(db, found_case)
    if req.test_run_id is not None:
        run_only = db.execute(
            select(TestRun).where(TestRun.tenant_id == tenant_id, TestRun.id == req.test_run_id)
        ).scalar_one_or_none()
        if run_only is None:
            raise NotFoundError("Test run not found")
        return Origin(
            project_id=run_only.project_id,
            test_run_id=run_only.id,
            run_id_name=run_only.name,
            run_case=None,
            test_case_id=None,
        )
    return None


def enforce_create_requirements(req: DefectCreateRequest, merged: dict[str, Any]) -> None:
    """ADR-118: the API-level mandatory fields of a NEW defect: title, description, at
    least one step to reproduce, expected and actual result, environment, severity and
    priority (status defaults to New; reporter and date are automatic). Called after
    anything an execution supplies is filled in, so the response names every missing
    field (`error.fields`). Never applied to reads, legacy rows or internal creators."""
    missing: dict[str, str] = {}
    if _blank(merged.get("title")):
        missing["title"] = "Title is required"
    if _blank(merged.get("description")):
        missing["description"] = "Description is required"
    if not merged.get("steps"):
        missing["repro_steps"] = "At least one step to reproduce is required"
    if _blank(merged.get("expected_result")):
        missing["expected_result"] = "Expected result is required"
    if _blank(merged.get("actual_result")):
        missing["actual_result"] = "Actual result is required"
    if _blank(merged.get("environment")) and req.environment_id is None:
        missing["environment"] = "Environment is required"
    if _blank(req.severity):
        missing["severity"] = "Severity is required"
    if _blank(req.priority):
        missing["priority"] = "Priority is required"
    if missing:
        raise ValidationAppError("Required fields missing: " + ", ".join(missing), fields=missing)


def _new_case_links(
    db: Session,
    tenant_id: UUID,
    project_id: UUID,
    case_ids: list[UUID],
    errors: dict[str, str],
) -> list[TestCase]:
    """Test cases to link on creation: they must exist in this tenant and project
    (soft-deleted cases are invisible to the query)."""
    if not case_ids:
        return []
    wanted = list(dict.fromkeys(case_ids))
    cases = list(
        db.execute(
            select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id.in_(wanted))
        ).scalars()
    )
    if {c.id for c in cases} != set(wanted):
        errors["test_case_ids"] = "One or more test cases were not found"
    elif any(c.project_id != project_id for c in cases):
        errors["test_case_ids"] = "Test cases must belong to the defect's project"
    return cases


def create_defect(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    req: DefectCreateRequest,
    *,
    enforce: bool = False,
) -> Defect:
    origin = _resolve_origin(db, tenant_id, req)
    if origin is not None:
        project_id = origin.project_id
    else:
        assert req.project_id is not None  # enforced by the schema validator
        project_id = req.project_id

    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    # Whatever the request leaves out is taken from the execution it is raised from.
    def pick(value: Any, inherited: Any) -> Any:
        return value if value is not None else (inherited if origin is not None else None)

    title = req.title or (origin.title if origin else None)
    description = pick(req.description, origin.description if origin else None)
    preconditions = pick(req.preconditions, origin.preconditions if origin else None)
    steps = _steps_from_request(req.repro_steps, req.steps_to_reproduce)
    if steps is None and origin is not None:
        steps = origin.steps
    expected = pick(req.expected_result, origin.expected if origin else None)
    actual = pick(req.actual_result, origin.actual if origin else None)
    environment = req.environment
    if environment is None and req.environment_id is None and origin is not None:
        environment = origin.environment
    module_id = pick(req.module_id, origin.module_id if origin else None)
    merged = {
        "title": title,
        "description": description,
        "steps": steps or [],
        "expected_result": expected,
        "actual_result": actual,
        "environment": environment,
    }
    if enforce:
        enforce_create_requirements(req, merged)

    errors: dict[str, str] = {}
    if _blank(title):
        errors["title"] = "Title is required"
    if _blank(req.severity):
        errors["severity"] = "Severity is required"
    status = req.status or "New"
    if status not in CREATE_DEFECT_STATUSES:
        errors["status"] = (
            f"A new defect starts as {' or '.join(CREATE_DEFECT_STATUSES)}, not '{status}'"
        )
    elif status == "Assigned" and req.assigned_to is None:
        errors["status"] = "Status 'Assigned' needs an assignee (assigned_to)"
    severity = req.severity or ""
    priority = req.priority or "Medium"
    if severity:
        _check_option(db, tenant_id, "defect_severity", severity, "severity", errors)
    _check_option(db, tenant_id, "defect_priority", priority, "priority", errors)
    _check_assignee(db, project, req.assigned_to, errors)
    _check_module(db, tenant_id, project_id, module_id, errors)
    task_service.check_task_for_project(db, tenant_id, project_id, req.task_id, errors)
    _check_asset(
        db, tenant_id, Build, req.found_in_build_id, project_id, "found_in_build_id", errors
    )
    _check_asset(
        db, tenant_id, Release, req.fixed_in_release_id, project_id, "fixed_in_release_id", errors
    )
    _check_environment_id(db, tenant_id, req.environment_id, errors)
    case_ids = list(req.test_case_ids)
    primary_case_id = req.test_case_id or (origin.test_case_id if origin else None)
    if req.test_case_id is not None:
        case_ids.append(req.test_case_id)
    linked_cases = _new_case_links(db, tenant_id, project_id, case_ids, errors)
    if errors:
        raise _fields_error(errors)

    _enforce_environment_rules(
        db, tenant_id, role_code, project_id, "defect.create", environment, req.environment_id
    )

    step_rows = steps_to_json(steps) if steps else None
    run_case = origin.run_case if origin else None
    display_seq, display_id = display_id_service.next_display_id(db, tenant_id, "defect")
    defect = Defect(
        tenant_id=tenant_id,
        display_seq=display_seq,
        display_id=display_id,
        project_id=project_id,
        test_case_id=primary_case_id,
        test_case_version_id=origin.test_case_version_id if origin else None,
        test_run_id=origin.test_run_id if origin else None,
        test_run_case_id=run_case.id if run_case else None,
        test_case_version_step_id=origin.version_step_id if origin else None,
        title=cast(str, title),
        severity=severity,
        priority=priority,
        status=status,
        description=_md(description),
        preconditions=_md(preconditions),
        repro_steps=step_rows,
        steps_to_reproduce=render_steps_text(step_rows) if step_rows else None,
        actual_result=_md(actual),
        expected_result=_md(expected),
        environment=_plain(environment),
        environment_id=req.environment_id,
        build_found=_plain(req.build_found),
        found_in_build_id=req.found_in_build_id,
        fix_version=_plain(req.fix_version),
        fixed_in_release_id=req.fixed_in_release_id,
        root_cause=req.root_cause,
        root_cause_notes=_md(req.root_cause_notes),
        labels=req.labels or [],
        module_id=module_id,
        task_id=req.task_id,
        assigned_to=req.assigned_to,
        reported_by=actor_user_id,
    )
    db.add(defect)
    db.flush()

    # Unified links: the primary FK covers `test_case_id`; every other case and the
    # run case it was raised from become defect_links rows.
    for linked in linked_cases:
        if linked.id != primary_case_id:
            insert_link(db, tenant_id, defect.id, "test_case", linked.id)
    if run_case is not None:
        insert_link(db, tenant_id, defect.id, "test_run_case", run_case.id)

    copied = 0
    if origin is not None and req.copy_evidence and origin.evidence_step_ids:
        copied = _copy_evidence(db, tenant_id, defect, origin.evidence_step_ids)

    snap = _snapshot(defect)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.created",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "title": defect.title,
            "severity": defect.severity,
            "display_id": defect.display_id,
            "test_run_case_id": str(run_case.id) if run_case else None,
            "changes": audit_diff({}, {k: v for k, v in snap.items() if v not in (None, [], "")}),
        },
    )
    if copied:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="defect.attachment_added",
            entity_type="defect",
            entity_id=defect.id,
            metadata={"copied_from_execution": copied},
        )
    db.commit()
    return defect


def _copy_evidence(db: Session, tenant_id: UUID, defect: Defect, step_ids: list[UUID]) -> int:
    """Attachment REFERENCES of the execution (same stored file, new rows owned by the
    defect). Deleting one row never removes a file another row still uses."""
    rows = list(
        db.execute(
            select(Attachment).where(
                Attachment.tenant_id == tenant_id,
                Attachment.owner_type == "execution_step",
                Attachment.owner_id.in_(step_ids),
            )
        ).scalars()
    )
    for row in rows:
        db.add(
            Attachment(
                tenant_id=tenant_id,
                owner_type="defect",
                owner_id=defect.id,
                file_name=row.file_name,
                mime_type=row.mime_type,
                storage_path=row.storage_path,
                size_bytes=row.size_bytes,
                checksum_sha256=row.checksum_sha256,
                uploaded_by=row.uploaded_by,
            )
        )
    return len(rows)


# --- update -----------------------------------------------------------------------------


def update_defect(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    req: DefectUpdateRequest,
    *,
    permissions: Collection[str] | None = None,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id, for_update=True)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    changes = req.model_dump(exclude_unset=True)
    check_row_version(defect, changes.pop("expected_version", None), "defect")
    if (
        "assigned_to" in changes
        and changes["assigned_to"] != defect.assigned_to
        and not can_assign(role_code, permissions)
    ):
        raise ForbiddenError("Missing permission: defect.assign")
    before = _snapshot(defect)
    errors: dict[str, str] = {}

    if "title" in changes:
        if req.title is None:
            errors["title"] = "Title cannot be cleared"
        else:
            defect.title = req.title
    for name in ("description", "expected_result", "actual_result"):
        if name in changes:
            value = _md(changes[name])
            # A legacy row is never refused for a field it already had empty: only a
            # request that blanks a value the row currently has.
            if _blank(value) and not _blank(getattr(defect, name)):
                errors[name] = f"{name.replace('_', ' ').capitalize()} cannot be cleared"
            else:
                setattr(defect, name, value)
    if "preconditions" in changes:
        defect.preconditions = _md(req.preconditions)
    if "root_cause_notes" in changes:
        defect.root_cause_notes = _md(req.root_cause_notes)
    if "repro_steps" in changes or "steps_to_reproduce" in changes:
        steps = _steps_from_request(req.repro_steps, req.steps_to_reproduce) or []
        if not steps and effective_repro_steps(defect):
            errors["repro_steps"] = "At least one step to reproduce is required"
        else:
            rows = steps_to_json(steps) if steps else None
            defect.repro_steps = rows
            defect.steps_to_reproduce = render_steps_text(rows) if rows else None
    for name, key in (("severity", "defect_severity"), ("priority", "defect_priority")):
        if name in changes:
            value = changes[name]
            if value is None:
                errors[name] = f"{name.capitalize()} cannot be cleared"
            elif value != getattr(defect, name):
                _check_option(db, tenant_id, key, value, name, errors)
                if name not in errors:
                    setattr(defect, name, value)
    if "environment" in changes or "environment_id" in changes:
        env_text = (
            _plain(changes["environment"]) if "environment" in changes else defect.environment
        )
        env_id = changes["environment_id"] if "environment_id" in changes else defect.environment_id
        if "environment_id" in changes:
            _check_environment_id(db, tenant_id, env_id, errors)
        had_environment = not _blank(defect.environment) or defect.environment_id is not None
        if "environment_id" in errors:
            pass
        elif _blank(env_text) and env_id is None and had_environment:
            errors["environment"] = "Environment cannot be cleared"
        else:
            _enforce_environment_rules(
                db, tenant_id, role_code, project.id, "defect.edit", env_text, env_id
            )
            defect.environment = env_text
            defect.environment_id = env_id
    if "build_found" in changes:
        defect.build_found = _plain(req.build_found)
    if "found_in_build_id" in changes:
        _check_asset(
            db, tenant_id, Build, req.found_in_build_id, project.id, "found_in_build_id", errors
        )
        defect.found_in_build_id = req.found_in_build_id
    if "fix_version" in changes:
        defect.fix_version = _plain(req.fix_version)
    if "fixed_in_release_id" in changes:
        _check_asset(
            db,
            tenant_id,
            Release,
            req.fixed_in_release_id,
            project.id,
            "fixed_in_release_id",
            errors,
        )
        defect.fixed_in_release_id = req.fixed_in_release_id
    if "labels" in changes:
        defect.labels = req.labels if req.labels is not None else []
    if "root_cause" in changes:
        defect.root_cause = req.root_cause
    if "assigned_to" in changes:
        _check_assignee(db, project, req.assigned_to, errors)
        if "assigned_to" not in errors:
            defect.assigned_to = req.assigned_to
    if "module_id" in changes:
        _check_module(db, tenant_id, project.id, req.module_id, errors)
        if "module_id" not in errors:
            defect.module_id = req.module_id
    if "task_id" in changes:
        task_service.check_task_for_project(db, tenant_id, project.id, req.task_id, errors)
        if "task_id" not in errors:
            defect.task_id = req.task_id
    if "resolution" in changes:
        message = resolution_error(defect.status, req.resolution)
        if message is not None:
            errors["resolution"] = message
        else:
            defect.resolution = req.resolution
    if errors:
        db.rollback()
        raise _fields_error(errors)

    diff = audit_diff(before, _snapshot(defect))
    if diff:
        bump_row_version(defect)
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="defect.updated",
            entity_type="defect",
            entity_id=defect.id,
            metadata={"fields": sorted(diff), "changes": diff},
        )
        if "assigned_to" in diff:
            record_audit_event(
                db,
                tenant_id=tenant_id,
                user_id=actor_user_id,
                action="defect.assigned",
                entity_type="defect",
                entity_id=defect.id,
                metadata={"changes": {"assigned_to": diff["assigned_to"]}},
            )
            if defect.assigned_to is not None:
                _notify_user(
                    db,
                    tenant_id,
                    actor_user_id,
                    defect.assigned_to,
                    "defect_assigned",
                    "A defect was assigned to you",
                    f'"{defect.title}" was assigned to you.',
                    defect,
                )
    db.commit()
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
        metadata={
            "title": defect.title,
            "status": defect.status,
            "severity": defect.severity,
            "display_id": defect.display_id,
        },
    )
    db.commit()


# --- listing ----------------------------------------------------------------------------


def _escape_like(value: str) -> str:
    return value.replace("/", "//").replace("%", "/%").replace("_", "/_")


DEFECT_MAX_PAGE_SIZE = 100
# Hard ceiling for the legacy un-paged list (`GET /defects` without `page_size`),
# which used to return every matching defect (100k rows = a 50 s, 6.7 MB response
# on a large tenant). Callers that need more must page (ADR-113).
DEFECT_PLAIN_LIST_CAP = 5000

# Sorts of the list (`sort=field` ascending, `sort=-field` descending). Severity,
# priority and status sort by rank (most severe / highest / furthest along = largest).
SORT_FIELDS = (
    "display_id",
    "title",
    "severity",
    "priority",
    "status",
    "assignee",
    "date_reported",
    "created_at",
    "fix_version",
)
DEFAULT_SORT = "-created_at"
_SEVERITY_RANK = {"Critical": 5, "Major": 4, "High": 4, "Medium": 3, "Minor": 2, "Low": 1}
_PRIORITY_RANK = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
_STATUS_RANK = {s: i for i, s in enumerate(DEFECT_STATUSES)}


@dataclass
class DefectFilters:
    """Everything the list, the status counts and the export can narrow by."""

    project_id: UUID | None = None
    statuses: list[str] = field(default_factory=list)
    severities: list[str] = field(default_factory=list)
    priorities: list[str] = field(default_factory=list)
    assignee_id: UUID | None = None
    reported_by: UUID | None = None
    module_id: UUID | None = None
    labels: list[str] = field(default_factory=list)
    test_case_id: UUID | None = None
    task_id: UUID | None = None
    include_sub_tasks: bool = False
    test_run_id: UUID | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    fix_version: str | None = None
    environment: str | None = None
    resolution: str | None = None
    search: str | None = None
    ids: list[UUID] | None = None


def split_values(raw: Iterable[str] | None) -> list[str]:
    """Repeated and comma-separated query values -> one clean list."""
    out: list[str] = []
    for item in raw or []:
        for part in item.split(","):
            part = part.strip()
            if part and part not in out:
                out.append(part)
    return out


def _defects_query(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    f: DefectFilters,
    *,
    with_status: bool = True,
) -> Select[tuple[Defect]]:
    query = select(Defect).where(Defect.tenant_id == tenant_id)

    if f.project_id is not None:
        project = _get_project_or_404(db, tenant_id, f.project_id)
        _require_project_access(db, project, role_code, user_id)
        query = query.where(Defect.project_id == f.project_id)
    elif role_code == "tester":
        query = query.where(Defect.project_id.in_(_assigned_project_ids(db, user_id)))

    if f.test_case_id is not None:
        # Reverse navigation (test case -> its defects): the primary FK or a link row.
        linked = select(DefectLink.defect_id).where(
            DefectLink.linkable_type == "test_case", DefectLink.linkable_id == f.test_case_id
        )
        query = query.where(or_(Defect.test_case_id == f.test_case_id, Defect.id.in_(linked)))

    if with_status and f.statuses:
        query = query.where(Defect.status.in_(f.statuses))
    if f.severities:
        query = query.where(Defect.severity.in_(f.severities))
    if f.priorities:
        query = query.where(Defect.priority.in_(f.priorities))
    if f.assignee_id is not None:
        query = query.where(Defect.assigned_to == f.assignee_id)
    if f.module_id is not None:
        query = query.where(Defect.module_id == f.module_id)
    if f.task_id is not None:
        task_ids = (
            task_service.subtree_task_ids(db, tenant_id, f.task_id)
            if f.include_sub_tasks
            else [f.task_id]
        )
        query = query.where(Defect.task_id.in_(task_ids))
    if f.labels:
        query = query.where(Defect.labels.contains([label.lower() for label in f.labels]))
    if f.fix_version:
        query = query.where(func.lower(Defect.fix_version) == f.fix_version.strip().lower())
    if f.environment:
        query = query.where(
            Defect.environment.ilike(f"%{_escape_like(f.environment.strip())}%", escape="/")
        )
    if f.resolution:
        query = query.where(Defect.resolution == f.resolution)
    if f.ids is not None:
        query = query.where(Defect.id.in_(f.ids))
    if f.search and f.search.strip():
        term = f.search.strip()
        pattern = f"%{_escape_like(term)}%"
        # ILIKE with an escaped needle (not `icontains`, which renders lower(title) LIKE)
        # so the pg_trgm GIN indexes on display_id / title / description can serve it
        # (ADR-113, ADR-118); a label matches exactly.
        query = query.where(
            or_(
                Defect.display_id.ilike(pattern, escape="/"),
                Defect.title.ilike(pattern, escape="/"),
                Defect.description.ilike(pattern, escape="/"),
                Defect.labels.contains([term.lower()]),
            )
        )
    if f.reported_by is not None:
        query = query.where(Defect.reported_by == f.reported_by)
    if f.created_from is not None:
        query = query.where(Defect.created_at >= f.created_from)
    if f.created_to is not None:
        query = query.where(Defect.created_at <= f.created_to)
    if f.test_run_id is not None:
        # GAP-20: lets a client (e.g. the Execution Console) ask "which
        # steps in this specific run already have a defect reported?" in
        # one batched call, scoped to this run so defects from other runs
        # against the same step definition (test_case_version_step_id,
        # which persists across reruns) don't false-positive. Also matches
        # defects *linked* (not originally created from) a step in this
        # run, so "link to existing defect" shows up as reported too.
        run_step_ids = select(ExecutionStep.id).where(
            ExecutionStep.test_run_case_id.in_(
                select(TestRunCase.id).where(TestRunCase.test_run_id == f.test_run_id)
            )
        )
        run_case_ids = select(TestRunCase.id).where(TestRunCase.test_run_id == f.test_run_id)
        linked_defect_ids = select(DefectLink.defect_id).where(
            or_(
                and_(
                    DefectLink.linkable_type == "execution_step",
                    DefectLink.linkable_id.in_(run_step_ids),
                ),
                # ADR-118: a defect linked to a run case (not to one of its steps).
                and_(
                    DefectLink.linkable_type == "test_run_case",
                    DefectLink.linkable_id.in_(run_case_ids),
                ),
            )
        )
        query = query.where(
            or_(Defect.test_run_id == f.test_run_id, Defect.id.in_(linked_defect_ids))
        )

    return query


def parse_sort(sort: str | None) -> tuple[str, bool]:
    """`field` / `-field` -> (field, descending); an unknown field is a 422."""
    raw = (sort or DEFAULT_SORT).strip()
    descending = raw.startswith("-")
    name = raw[1:] if descending else raw
    if name not in SORT_FIELDS:
        raise ValidationAppError(
            f"Unknown sort '{raw}'. Valid sorts: {', '.join(SORT_FIELDS)} (prefix - to reverse).",
            fields={"sort": f"Unknown sort '{raw}'"},
        )
    return name, descending


def _rank(column: Any, ranks: dict[str, int]) -> Any:
    return case(*[(column == k, v) for k, v in ranks.items()], else_=0)


def _apply_sort(query: Select, sort: str | None) -> Select:
    name, desc = parse_sort(sort)
    expr: Any
    if name == "display_id":
        expr = Defect.display_seq
    elif name in ("date_reported", "created_at"):
        expr = Defect.created_at
    elif name == "title":
        expr = func.lower(Defect.title)
    elif name == "severity":
        expr = _rank(Defect.severity, _SEVERITY_RANK)
    elif name == "priority":
        expr = _rank(Defect.priority, _PRIORITY_RANK)
    elif name == "status":
        expr = _rank(Defect.status, _STATUS_RANK)
    elif name == "fix_version":
        expr = func.lower(Defect.fix_version)
    else:  # assignee
        query = query.outerjoin(User, User.id == Defect.assigned_to)
        expr = func.lower(User.name)
    ordering = expr.desc().nulls_last() if desc else expr.asc().nulls_last()
    return query.order_by(ordering, Defect.id)


def list_defects(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    f: DefectFilters,
    sort: str | None = None,
) -> list[Defect]:
    query = _defects_query(db, tenant_id, role_code, user_id, f)
    return list(db.execute(_apply_sort(query, sort).limit(DEFECT_PLAIN_LIST_CAP)).scalars())


def list_defects_page(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    f: DefectFilters,
    page: int,
    page_size: int,
    sort: str | None = None,
    cursor: str | None = None,
    include_total: bool = True,
) -> tuple[list[Defect], int, str | None]:
    """ADR-078: one page of the same listing plus how many match in all. Same visibility
    and filters as `list_defects` (they share `_defects_query`). `cursor` (ADR-113)
    switches to keyset paging over (created_at DESC, id) -- newest-first sort only -- and
    `include_total=False` skips the COUNT (total = -1); the third return value is the
    next page's cursor (None on the last page / in offset mode)."""
    query = _defects_query(db, tenant_id, role_code, user_id, f)
    total = (
        db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
        if include_total
        else -1
    )
    page_size = min(max(page_size, 1), DEFECT_MAX_PAGE_SIZE)
    page = max(page, 1)
    if cursor is None:
        ordered = _apply_sort(query, sort)
        rows = db.execute(ordered.limit(page_size).offset((page - 1) * page_size)).scalars()
        return list(rows), total, None
    if (sort or DEFAULT_SORT) != DEFAULT_SORT:
        raise ValidationAppError(
            "Cursor paging is only available for the default newest-first order",
            fields={"cursor": "Not available with this sort"},
        )
    ordered = query.order_by(Defect.created_at.desc(), Defect.id)
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
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, f: DefectFilters
) -> dict[str, int]:
    """ADR-078: matching defects per status, under every filter EXCEPT status, so the
    Defects page's status tabs can show each tab's count while only one page of rows
    is loaded."""
    query = _defects_query(db, tenant_id, role_code, user_id, f, with_status=False)
    sub = query.subquery()
    rows = db.execute(select(sub.c.status, func.count()).group_by(sub.c.status)).all()
    return {status: count for status, count in rows}


def get_field_catalog() -> DefectFieldCatalogOut:
    """ADR-118: the 22 fields (keys, labels, types, flags) and the default visible
    columns, so the UI's column picker and the export are driven by the server."""
    from app.services import defect_export_service

    return DefectFieldCatalogOut(
        fields=[
            DefectFieldSpecOut(
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
            for f in DEFECT_FIELDS
        ],
        default_columns=list(DEFAULT_VISIBLE_DEFECT_FIELDS),
        sortable=list(SORT_FIELDS),
        filters=[
            "project_id",
            "status",
            "severity",
            "priority",
            "assignee_id",
            "reported_by",
            "module_id",
            "labels",
            "test_case_id",
            "created_from",
            "created_to",
            "fix_version",
            "environment",
            "resolution",
            "search",
        ],
        statuses=list(DEFECT_STATUSES),
        resolutions=list(RESOLUTIONS),
        transitions={k: next_statuses(k) for k in ALLOWED_TRANSITIONS},
        export_columns=list(defect_export_service.EXPORT_COLUMN_KEYS),
    )


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
        select(Defect).where(
            Defect.project_id == project_id, Defect.status.notin_(CLOSED_DEFECT_STATUSES)
        )
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


# --- status workflow --------------------------------------------------------------------


def next_statuses(current: str) -> list[str]:
    """The statuses a defect in `current` may move to, in workflow order."""
    allowed = ALLOWED_TRANSITIONS.get(current, frozenset())
    return [s for s in DEFECT_STATUSES if s in allowed]


def _resolve_resolution(
    current_status: str,
    current_resolution: str | None,
    new_status: str,
    supplied: str | None,
) -> str | None:
    """The resolution a defect carries after moving to `new_status` (ADR-118).

    * New / Open / Assigned / In Progress / Retest / Reopened must not carry one: a
      supplied value is a 422, an existing one is cleared (so Fixed -> Retest and any
      move into Reopened drop the old resolution).
    * Fixed defaults to 'Fixed'; Closed keeps a valid existing resolution, defaults to
      'Fixed' when it comes from Fixed / Retest / Verified, and otherwise needs one.
    * Rejected needs one of Duplicate / Won't Fix / Cannot Reproduce / By Design / Not
      Applicable; Deferred and Verified may carry one but do not need it.
    """
    rule = RESOLUTION_RULES[new_status]
    if not rule.allowed:
        if supplied:
            raise ValidationAppError(
                f"A defect in status '{new_status}' must not carry a resolution",
                fields={"resolution": f"Not allowed for status '{new_status}'"},
            )
        return None
    value = supplied
    if value is None and current_resolution in rule.allowed:
        value = current_resolution
    if value is None and (
        new_status == "Fixed"
        or (new_status == "Closed" and current_status in ("Fixed", "Retest", "Verified"))
    ):
        value = "Fixed"
    message = resolution_error(new_status, value)
    if message is not None:
        raise ValidationAppError(message, fields={"resolution": message})
    return value


def _notify_user(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    recipient_id: UUID,
    notif_type: str,
    title: str,
    body: str,
    defect: Defect,
) -> None:
    user = db.execute(select(User).where(User.id == recipient_id)).scalar_one_or_none()
    if user is None:
        return
    notification_service.notify(
        db,
        tenant_id,
        actor_user_id,
        recipient_id,
        user.email,
        notif_type,
        title,
        body,
        "defect",
        defect.id,
    )


def apply_transition(
    db: Session,
    defect: Defect,
    new_status: str,
    *,
    actor_user_id: UUID,
    resolution: str | None = None,
    comment: str | None = None,
    extra_metadata: dict[str, Any] | None = None,
) -> None:
    """Moves `defect` to `new_status` after checking the transition table and the
    resolution rules (the caller has already checked permissions and confirmations):
    stamps closed_at / reopen counters, notifies, and writes the audit event with from /
    to values. Does not commit."""
    problem = transition_error(defect.status, new_status)
    if problem is not None:
        raise ConflictError(problem)
    tenant_id = defect.tenant_id
    previous_status, previous_resolution = defect.status, defect.resolution
    new_resolution = _resolve_resolution(
        previous_status, previous_resolution, new_status, resolution
    )

    defect.status = new_status
    defect.resolution = new_resolution
    bump_row_version(defect)
    now = datetime.now(UTC)
    if new_status in CLOSED_DEFECT_STATUSES:
        defect.closed_at = now
    elif new_status == "Reopened":
        defect.closed_at = None
        defect.reopened_count += 1
        defect.last_reopened_at = now

    metadata: dict[str, Any] = {
        "from": previous_status,
        "to": new_status,
        "resolution": new_resolution,
        "changes": audit_diff(
            {"status": previous_status, "resolution": previous_resolution},
            {"status": new_status, "resolution": new_resolution},
        ),
    }
    if comment:
        metadata["comment"] = comment[:300]
    if new_status == "Reopened":
        metadata["reopened_count"] = defect.reopened_count
    metadata.update(extra_metadata or {})
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.reopened" if new_status == "Reopened" else "defect.status_changed",
        entity_type="defect",
        entity_id=defect.id,
        metadata=metadata,
    )

    if new_status in CLOSED_DEFECT_STATUSES:
        _notify_user(
            db,
            tenant_id,
            actor_user_id,
            defect.reported_by,
            "defect_closed",
            "Your defect was closed" if new_status == "Closed" else "Your defect was rejected",
            f'"{defect.title}" was {new_status.lower()}.',
            defect,
        )
    elif new_status in ("Reopened", "Retest"):
        notif_type = "defect_reopened" if new_status == "Reopened" else "defect_retest"
        title = (
            "A defect was reopened" if new_status == "Reopened" else "A defect is ready for retest"
        )
        body = (
            f'"{defect.title}" was reopened.'
            if new_status == "Reopened"
            else f'"{defect.title}" is ready to be retested.'
        )
        recipients = {defect.reported_by}
        if defect.assigned_to is not None:
            recipients.add(defect.assigned_to)
        for recipient in recipients:
            _notify_user(db, tenant_id, actor_user_id, recipient, notif_type, title, body, defect)


def update_status(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    new_status: str,
    verification_confirmed: bool = False,
    resolution: str | None = None,
    comment: str | None = None,
    *,
    permissions: Collection[str] | None = None,
    expected_version: int | None = None,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id, for_update=True)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    check_row_version(defect, expected_version, "defect")

    if new_status not in DEFECT_STATUSES:
        raise ValidationAppError(
            f"Unknown status: {new_status}", fields={"status": f"Unknown status '{new_status}'"}
        )
    # Permission before transition (as before ADR-118): a caller who may not close or
    # reopen is told so whatever the current status is.
    if new_status == "Closed":
        # BRD §3.2: "Update Defect Status to 'Closed': Tester No." -- defect.close, with
        # the legacy Admin / Manager tier as a fallback (ADR-118).
        if not can_close(role_code, permissions):
            raise ForbiddenError("Only Admin/Manager can close a defect")
        # Spec: "Closing requires verification confirmation" -- a distinct
        # explicit gesture, not merely that Verified exists earlier in the
        # sequence.
        if not verification_confirmed:
            raise ValidationAppError("Closing a defect requires explicit verification confirmation")
    elif new_status == "Reopened" and not can_close(role_code, permissions):
        raise ForbiddenError("Only Admin/Manager can reopen a defect")
    problem = transition_error(defect.status, new_status)
    if problem is not None:
        raise ConflictError(problem)

    apply_transition(
        db,
        defect,
        new_status,
        actor_user_id=actor_user_id,
        resolution=resolution,
        comment=comment,
    )
    db.commit()
    return defect


REOPENABLE_STATUSES = tuple(
    s for s in DEFECT_STATUSES if "Reopened" in ALLOWED_TRANSITIONS.get(s, frozenset())
)


def reopen_defect(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    *,
    permissions: Collection[str] | None = None,
) -> Defect:
    """Tier 2 (PV-6.3), now mapped to the 'Reopened' status (ADR-118): a defect that is
    Fixed, Retest, Verified, Rejected or Closed moves to Reopened, counted in
    reopened_count / last_reopened_at, with the resolution cleared. Same elevated bar as
    closing a defect (`defect.close`, legacy Admin / Manager fallback)."""
    if not can_close(role_code, permissions):
        raise ForbiddenError("Only Admin/Manager can reopen a defect")

    defect = _get_defect_or_404(db, tenant_id, defect_id, for_update=True)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if defect.status not in REOPENABLE_STATUSES:
        raise ConflictError(
            f"Cannot reopen a defect from status '{defect.status}'; "
            f"only {', '.join(REOPENABLE_STATUSES)} can be reopened"
        )
    apply_transition(db, defect, "Reopened", actor_user_id=actor_user_id)
    db.commit()
    return defect


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
    defect = _get_defect_or_404(db, tenant_id, defect_id, for_update=True)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    _enforce_environment_rules(
        db, tenant_id, role_code, defect.project_id, "defect.create", None, environment_id
    )

    previous = defect.environment_id
    if previous != environment_id:
        bump_row_version(defect)
    defect.environment_id = environment_id

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.environment_set",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "environment_id": str(environment_id) if environment_id else None,
            "changes": audit_diff({"environment_id": previous}, {"environment_id": environment_id}),
        },
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
    defect = _get_defect_or_404(db, tenant_id, defect_id, for_update=True)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    before = {
        "found_in_build_id": defect.found_in_build_id,
        "fixed_in_release_id": defect.fixed_in_release_id,
    }
    if (defect.found_in_build_id, defect.fixed_in_release_id) != (
        found_in_build_id,
        fixed_in_release_id,
    ):
        bump_row_version(defect)
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
            "changes": audit_diff(
                before,
                {
                    "found_in_build_id": found_in_build_id,
                    "fixed_in_release_id": fixed_in_release_id,
                },
            ),
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
    defect = _get_defect_or_404(db, tenant_id, defect_id, for_update=True)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    previous = defect.root_cause
    if previous != root_cause:
        bump_row_version(defect)
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


# --- links ------------------------------------------------------------------------------


def insert_link(
    db: Session,
    tenant_id: UUID,
    defect_id: UUID,
    linkable_type: str,
    linkable_id: UUID,
    link_type: str = "relates_to",
) -> tuple[DefectLink, bool]:
    """Idempotent: returns (link, created)."""
    existing = (
        db.execute(
            select(DefectLink).where(
                DefectLink.defect_id == defect_id,
                DefectLink.linkable_type == linkable_type,
                DefectLink.linkable_id == linkable_id,
                DefectLink.link_type == link_type,
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing, False
    link = DefectLink(
        tenant_id=tenant_id,
        defect_id=defect_id,
        linkable_type=linkable_type,
        linkable_id=linkable_id,
        link_type=link_type,
    )
    db.add(link)
    db.flush()
    return link, True


def _get_case_for_link(
    db: Session, tenant_id: UUID, defect: Defect, test_case_id: UUID
) -> TestCase:
    case_ = db.execute(
        select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    ).scalar_one_or_none()
    if case_ is None:
        raise NotFoundError("Test case not found")
    if case_.project_id != defect.project_id:
        raise ValidationAppError(
            "The test case must belong to the defect's project",
            fields={"test_case_id": "Test case belongs to a different project"},
        )
    return case_


def case_ids_of_defect(db: Session, defect: Defect) -> list[UUID]:
    """The unified set of test cases of a defect: the primary FK, then link rows."""
    ids: list[UUID] = [defect.test_case_id] if defect.test_case_id else []
    for linkable_id in db.execute(
        select(DefectLink.linkable_id)
        .where(DefectLink.defect_id == defect.id, DefectLink.linkable_type == "test_case")
        .order_by(DefectLink.created_at)
    ).scalars():
        if linkable_id not in ids:
            ids.append(linkable_id)
    return ids


def _case_label_list(db: Session, case_ids: list[UUID]) -> str:
    labels = lookups.value_map(db, TestCase.id, TestCase.display_id, case_ids, include_deleted=True)
    return ", ".join(labels.get(c) or str(c) for c in case_ids)


def link_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    test_case_id: UUID,
) -> tuple[Defect, bool]:
    """`POST /defects/{id}/test-cases/{test_case_id}`: one API over both link models
    (the primary `defects.test_case_id` and `defect_links` rows). The target must exist
    in the tenant, not be soft-deleted, and belong to the defect's project. Idempotent:
    an existing link (either model) returns `created=False`. Audited (before / after)."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    case_ = _get_case_for_link(db, tenant_id, defect, test_case_id)
    before = case_ids_of_defect(db, defect)
    if case_.id in before:
        return defect, False
    insert_link(db, tenant_id, defect.id, "test_case", case_.id)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.link_added",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "linkable_type": "test_case",
            "linkable_id": str(case_.id),
            "link_type": "relates_to",
            "test_case_display_id": case_.display_id,
            "changes": {
                "linked_test_cases": {
                    "from": _case_label_list(db, before),
                    "to": _case_label_list(db, before + [case_.id]),
                }
            },
        },
    )
    db.commit()
    return defect, True


def unlink_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    test_case_id: UUID,
) -> Defect:
    """`DELETE /defects/{id}/test-cases/{test_case_id}`: removes the link from both
    models (clearing the primary FK when it is that case). Idempotent; audited."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    before = case_ids_of_defect(db, defect)
    if test_case_id not in before:
        return defect
    for link in (
        db.execute(
            select(DefectLink).where(
                DefectLink.defect_id == defect.id,
                DefectLink.linkable_type == "test_case",
                DefectLink.linkable_id == test_case_id,
            )
        )
        .scalars()
        .all()
    ):
        db.delete(link)
    if defect.test_case_id == test_case_id:
        defect.test_case_id = None
        defect.test_case_version_id = None
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.link_removed",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "linkable_type": "test_case",
            "linkable_id": str(test_case_id),
            "changes": {
                "linked_test_cases": {
                    "from": _case_label_list(db, before),
                    "to": _case_label_list(db, [c for c in before if c != test_case_id]),
                }
            },
        },
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
    """Generic link (execution step, defect, test case, run case). The target must exist
    in the tenant and project; a test case goes through `link_test_case`; idempotent."""
    if req.linkable_type == "test_case":
        defect, _created = link_test_case(
            db, tenant_id, role_code, actor_user_id, defect_id, req.linkable_id
        )
        return defect
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    target_project: UUID | None
    if req.linkable_type == "defect":
        if req.linkable_id == defect.id:
            raise ValidationAppError(
                "A defect cannot be linked to itself",
                fields={"linkable_id": "A defect cannot be linked to itself"},
            )
        target_project = db.execute(
            select(Defect.project_id).where(
                Defect.tenant_id == tenant_id, Defect.id == req.linkable_id
            )
        ).scalar_one_or_none()
    elif req.linkable_type == "execution_step":
        target_project = db.execute(
            select(TestRun.project_id)
            .join(TestRunCase, TestRunCase.test_run_id == TestRun.id)
            .join(ExecutionStep, ExecutionStep.test_run_case_id == TestRunCase.id)
            .where(ExecutionStep.tenant_id == tenant_id, ExecutionStep.id == req.linkable_id)
        ).scalar_one_or_none()
    else:  # test_run_case
        target_project = db.execute(
            select(TestRun.project_id)
            .join(TestRunCase, TestRunCase.test_run_id == TestRun.id)
            .where(TestRunCase.tenant_id == tenant_id, TestRunCase.id == req.linkable_id)
        ).scalar_one_or_none()
    if target_project is None:
        raise NotFoundError(f"Link target ({req.linkable_type}) not found")
    if target_project != defect.project_id:
        raise ValidationAppError(
            "The link target must belong to the defect's project",
            fields={"linkable_id": "Target belongs to a different project"},
        )

    _link, created = insert_link(
        db, tenant_id, defect_id, req.linkable_type, req.linkable_id, req.link_type
    )
    if created:
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
                "changes": {
                    "links": {"from": None, "to": f"{req.linkable_type}:{req.linkable_id}"}
                },
            },
        )
    db.commit()
    return defect


def remove_link(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    link_id: UUID,
) -> Defect:
    """Removes one `defect_links` row (any type); idempotent; audited."""
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    link = db.execute(
        select(DefectLink).where(DefectLink.id == link_id, DefectLink.defect_id == defect.id)
    ).scalar_one_or_none()
    if link is None:
        return defect
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.link_removed",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "linkable_type": link.linkable_type,
            "linkable_id": str(link.linkable_id),
            "link_type": link.link_type,
            "changes": {"links": {"from": f"{link.linkable_type}:{link.linkable_id}", "to": None}},
        },
    )
    db.delete(link)
    db.commit()
    return defect


def _link_rows(
    db: Session, defects: list[Defect]
) -> dict[UUID, list[tuple[UUID, bool, datetime | None]]]:
    """{defect id: [(test case id, is_primary, linked_at)]} over both link models."""
    out: dict[UUID, list[tuple[UUID, bool, datetime | None]]] = {d.id: [] for d in defects}
    for d in defects:
        if d.test_case_id is not None:
            out[d.id].append((d.test_case_id, True, d.created_at))
    for defect_id, case_id, created in db.execute(
        select(DefectLink.defect_id, DefectLink.linkable_id, DefectLink.created_at)
        .where(DefectLink.defect_id.in_(list(out)), DefectLink.linkable_type == "test_case")
        .order_by(DefectLink.created_at)
    ):
        if all(c != case_id for c, _p, _t in out[defect_id]):
            out[defect_id].append((case_id, False, created))
    return out


def _linked_cases_compact(
    db: Session, defects: list[Defect]
) -> dict[UUID, list[LinkedTestCaseOut]]:
    rows = _link_rows(db, defects)
    case_ids = {c for items in rows.values() for c, _p, _t in items}
    cases = (
        {
            c.id: c
            for c in db.execute(
                select(TestCase.id, TestCase.display_id, TestCase.title).where(
                    TestCase.id.in_(case_ids)
                )
            )
        }
        if case_ids
        else {}
    )
    return {
        defect_id: [
            LinkedTestCaseOut(
                id=cid,
                display_id=cases[cid].display_id,
                title=cases[cid].title,
                is_primary=primary,
                linked_at=linked_at,
            )
            for cid, primary, linked_at in items
            if cid in cases
        ]
        for defect_id, items in rows.items()
    }


def list_defect_test_cases(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, defect_id: UUID
) -> list[LinkedTestCaseOut]:
    """`GET /defects/{id}/test-cases`: the linked cases (either link model) with module
    path, latest execution status / date / tester, its run and the run case the defect
    was raised from. A scoped Tester only sees cases assigned to them (ADR-093)."""
    defect = get_defect(db, tenant_id, role_code, user_id, defect_id)
    set_tenant_context(db, str(tenant_id))
    rows = _link_rows(db, [defect])[defect.id]
    case_ids = [c for c, _p, _t in rows]
    if not case_ids:
        return []
    query = select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id.in_(case_ids))
    query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, query)
    cases = {c.id: c for c in db.execute(query).scalars()}
    paths = test_case_service._module_paths(
        db, {c.module_id for c in cases.values() if c.module_id is not None}
    )
    latest = {
        r.test_case_id: r
        for r in db.execute(test_case_service._latest_exec_select(tenant_id, list(cases))).all()
    }
    run_case_ids = {r.run_case_id for r in latest.values()}
    run_info = (
        {
            r.id: r
            for r in db.execute(
                select(TestRunCase.id, TestRunCase.test_run_id, TestRun.name)
                .join(TestRun, TestRun.id == TestRunCase.test_run_id)
                .where(TestRunCase.id.in_(run_case_ids))
                .execution_options(include_deleted=True)
            )
        }
        if run_case_ids
        else {}
    )
    origin_case_id = None
    if defect.test_run_case_id is not None:
        origin_case_id = db.execute(
            select(TestRunCase.test_case_id).where(TestRunCase.id == defect.test_run_case_id)
        ).scalar_one_or_none()
    names = lookups.value_map(db, User.id, User.name, (r.executed_by for r in latest.values()))
    out: list[LinkedTestCaseOut] = []
    for cid, primary, linked_at in rows:
        case_ = cases.get(cid)
        if case_ is None:
            continue
        run = latest.get(cid)
        info = run_info.get(run.run_case_id) if run else None
        leaf, path = paths.get(case_.module_id, (None, None))  # type: ignore[arg-type]
        out.append(
            LinkedTestCaseOut(
                id=cid,
                display_id=case_.display_id,
                title=case_.title,
                module_name=leaf,
                module_path=path,
                is_primary=primary,
                latest_execution_status=test_case_service.execution_status_label(
                    run.status if run else None
                ),
                latest_execution_at=run.executed_at if run else None,
                latest_executed_by=run.executed_by if run else None,
                latest_executed_by_name=names.get(run.executed_by) if run else None,
                test_run_id=info.test_run_id if info else None,
                test_run_name=info.name if info else None,
                test_run_case_id=run.run_case_id if run else None,
                raised_from_run_case_id=(
                    defect.test_run_case_id if origin_case_id == cid else None
                ),
                linked_at=linked_at,
            )
        )
    return out


def list_defects_for_test_case(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> list[LinkedDefectForCaseOut]:
    """`GET /test-cases/{id}/defects`: the defects of a case from the same unified source
    (primary FK or link row), newest first."""
    test_case_service.get_test_case(db, tenant_id, role_code, user_id, test_case_id)
    set_tenant_context(db, str(tenant_id))
    f = DefectFilters(test_case_id=test_case_id)
    query = _defects_query(db, tenant_id, role_code, user_id, f).order_by(
        Defect.created_at.desc(), Defect.id
    )
    defects = list(db.execute(query).scalars())
    names = lookups.value_map(db, User.id, User.name, (d.assigned_to for d in defects))
    return [
        LinkedDefectForCaseOut(
            id=d.id,
            display_id=d.display_id,
            title=d.title,
            status=cast(DefectStatus, d.status),
            severity=d.severity,
            priority=d.priority,
            assigned_to=d.assigned_to,
            assigned_to_name=names.get(d.assigned_to),
        )
        for d in defects
    ]


# --- history ----------------------------------------------------------------------------


def _history_changes(action: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """`{field: {from, to}}` of an audit event, whatever shape its metadata has."""
    changes = metadata.get("changes")
    if isinstance(changes, dict) and changes:
        return changes
    if action in ("defect.status_changed", "defect.reopened") and "from" in metadata:
        return {"status": {"from": metadata.get("from"), "to": metadata.get("to")}}
    if action == "defect.root_cause_set":
        return {"root_cause": {"from": metadata.get("from"), "to": metadata.get("to")}}
    return {}


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
            changes=_history_changes(log.action, log.event_metadata or {}),
        )
        for log, user_name in rows
    ]


# --- serialisation ----------------------------------------------------------------------


def _execution_evidences(db: Session, defects: list[Defect]) -> dict[UUID, ExecutionEvidenceOut]:
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

    project_names = lookups.value_map(db, Project.id, Project.name, (d.project_id for d in defects))
    case_titles = lookups.value_map(
        db, TestCase.id, TestCase.title, (d.test_case_id for d in defects), include_deleted=True
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
    task_refs = {
        t_id: (display_id, title)
        for t_id, display_id, title in db.execute(
            select(Task.id, Task.display_id, Task.title).where(
                Task.id.in_({d.task_id for d in defects if d.task_id is not None})
            )
        )
    }
    defect_ids = [d.id for d in defects]
    links_by_defect: dict[UUID, list[DefectLink]] = {did: [] for did in defect_ids}
    for link_ in db.execute(
        select(DefectLink).where(DefectLink.defect_id.in_(defect_ids))
    ).scalars():
        links_by_defect[link_.defect_id].append(link_)
    status_labels = status_label_service.get_labels_map(db, tenant_id, "defect")
    custom_fields = custom_field_service.get_values_for_owners(db, tenant_id, "defect", defect_ids)
    attachment_counts = {
        owner_id: n
        for owner_id, n in db.execute(
            select(Attachment.owner_id, func.count())
            .where(Attachment.owner_type == "defect", Attachment.owner_id.in_(defect_ids))
            .group_by(Attachment.owner_id)
        )
    }
    linked_cases = _linked_cases_compact(db, defects)

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
            task_ref=task_refs.get(defect.task_id),
            evidence=evidences.get(defect.id),
            links=links_by_defect[defect.id],
            status_labels=status_labels,
            custom_fields=custom_fields[defect.id],
            attachment_count=attachment_counts.get(defect.id, 0),
            linked_cases=linked_cases.get(defect.id, []),
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
    task_ref: tuple[str | None, str] | None,
    evidence: ExecutionEvidenceOut | None,
    links: list[DefectLink],
    status_labels: dict[str, str],
    custom_fields: dict[str, object],
    attachment_count: int,
    linked_cases: list[LinkedTestCaseOut],
) -> DefectOut:
    test_run_case_id = defect.test_run_case_id or (
        evidence.test_run_case_id if evidence is not None else None
    )
    age_days, sla_breached = compute_aging(defect)
    return DefectOut(
        id=defect.id,
        project_id=defect.project_id,
        row_version=defect.row_version,
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
        task_id=defect.task_id,
        task_display_id=task_ref[0] if task_ref else None,
        task_title=task_ref[1] if task_ref else None,
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
        display_id=defect.display_id,
        preconditions=defect.preconditions,
        resolution=defect.resolution,
        labels=list(defect.labels or []),
        repro_steps=effective_repro_steps(defect),
        build_found=defect.build_found,
        fix_version=defect.fix_version,
        root_cause_notes=defect.root_cause_notes,
        reporter=defect.reported_by,
        assignee=defect.assigned_to,
        date_reported=defect.created_at,
        attachment_count=attachment_count,
        linked_test_cases=linked_cases,
        linked_test_case_count=len(linked_cases),
    )
