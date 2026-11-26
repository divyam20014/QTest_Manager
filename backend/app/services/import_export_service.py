"""ADR-120: standard import (preview, then commit) for test cases and defects.

Phase 1, ``create_preview``: read the uploaded csv/xlsx (`import_file_service`), match the
headers to the 22-field catalogue, validate every row against the current database and keep
the parsed cells in ``import_sessions`` under an unguessable token. Nothing in the real
tables is written.

Phase 2, ``commit``: load the stored cells, validate them again (the database may have
moved on), then insert in ONE transaction -- display ids reserved as a range, versions,
steps, links, modules, one compact audit event per record plus a summary event. In
``all_or_nothing`` mode any invalid row blocks the whole import; ``skip_invalid`` imports
the valid rows and reports the rest. Above ``import_async_threshold`` importable rows the
commit runs through the existing background-job queue.
"""

from __future__ import annotations

import gzip
import json
import re
from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from rapidfuzz import process
from sqlalchemy import bindparam, insert, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.core.audit import record_audit_events_bulk
from app.core.auth import get_effective_permissions_for_project
from app.core.config import get_settings
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.field_standards import (
    AUTOMATION_STATUSES,
    BUILD_FOUND_MAX,
    CLOSED_DEFECT_STATUSES,
    CONTENT_TEXT_MAX,
    CREATE_DEFECT_STATUSES,
    DEFAULT_AUTOMATION_STATUS,
    DEFECT_STATUSES,
    DESCRIPTION_MAX,
    FIX_VERSION_MAX,
    RESOLUTIONS,
    ROOT_CAUSE_NOTES_MAX,
    SHORT_TEXT_MAX,
    TEST_DATA_MAX,
    TITLE_MAX,
    TITLE_MIN,
    resolution_error,
)
from app.core.import_columns import (
    COLUMNS_BY_KIND,
    DEFECT_EXAMPLE_TITLE,
    TC_EXAMPLE_TITLE,
    TC_IMPORT_ONLY,
    ImportColumn,
    build_header_index,
)
from app.core.import_steps import ParsedStep, parse_steps
from app.core.text_sanitize import clean_plain, sanitize_markdown
from app.models.defect import Defect, DefectLink
from app.models.identity import User
from app.models.import_session import ImportSession
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskTestCaseLink
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_module import TestModule
from app.schemas.defect import ReproStepIn, normalise_labels
from app.services import (
    defect_service,
    display_id_service,
    field_option_service,
    job_service,
    status_label_service,
    tester_visibility,
)
from app.services.import_file_service import read_upload
from app.services.project_service import is_assigned

settings = get_settings()

KINDS = ("test_case", "defect")
MODES = ("all_or_nothing", "skip_invalid")
PREVIEW_ROWS = 200
MAX_LISTED_ISSUES = 5000
MAX_MODULE_DEPTH = 6
MODULE_NAME_MAX = 200
COMMIT_JOB_TYPE = "standard_import_commit"

_TC_ID_RE = re.compile(r"^TC_(\d{6,})$")
_BUG_ID_RE = re.compile(r"^BUG_(\d{6,})$")
_ID_RE = {"test_case": _TC_ID_RE, "defect": _BUG_ID_RE}
_DISPLAY_SEQ_MAX = 2_000_000_000
_REVIEW_STATUS = {
    "draft": "draft",
    "ready for review": "ready_for_review",
    "ready_for_review": "ready_for_review",
    "approved": "approved",
    "deprecated": "deprecated",
}
_REVIEW_STATUS_LABEL = {
    "draft": "Draft",
    "ready_for_review": "Ready for Review",
    "approved": "Approved",
    "deprecated": "Deprecated",
}
_ROOT_CAUSES = (
    "requirements_gap",
    "code_defect",
    "design_flaw",
    "test_data_issue",
    "environment_issue",
    "third_party_integration",
    "other",
)

# Columns shown in the preview table, per module.
PREVIEW_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "test_case": [
        ("display_id", "Test Case ID"),
        ("title", "Title"),
        ("module", "Module"),
        ("test_type", "Test Type"),
        ("priority", "Priority"),
        ("severity", "Severity"),
        ("automation_status", "Automation Status"),
        ("status", "Review Status"),
        ("steps", "Test Steps"),
        ("assignee", "Assignee"),
        ("task", "Task"),
    ],
    "defect": [
        ("display_id", "Bug ID"),
        ("title", "Title"),
        ("module", "Component / Module"),
        ("severity", "Severity"),
        ("priority", "Priority"),
        ("status", "Status"),
        ("resolution", "Resolution"),
        ("environment", "Environment"),
        ("steps", "Steps to Reproduce"),
        ("assignee", "Assignee"),
        ("linked_issues", "Linked Test Cases"),
        ("task", "Task"),
    ],
}


@dataclass(frozen=True)
class Actor:
    tenant_id: UUID
    user_id: UUID
    role_code: str
    permissions: frozenset[str]


@dataclass
class Issue:
    column: str | None
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {"column": self.column, "message": self.message}


@dataclass
class RowOutcome:
    row_number: int
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    data: dict[str, str] = field(default_factory=dict)
    plan: dict[str, Any] = field(default_factory=dict)

    @property
    def status(self) -> str:
        if self.errors:
            return "error"
        return "warning" if self.warnings else "valid"

    def as_dict(self) -> dict[str, Any]:
        return {
            "row_number": self.row_number,
            "status": self.status,
            "errors": [i.as_dict() for i in self.errors],
            "warnings": [i.as_dict() for i in self.warnings],
            "data": self.data,
        }


@dataclass
class Outcome:
    kind: str
    rows: list[RowOutcome]
    modules_to_create: list[str]
    module_plan: ModulePlan | None = None

    def counts(self) -> dict[str, int]:
        errors = sum(1 for r in self.rows if r.errors)
        warnings = sum(1 for r in self.rows if not r.errors and r.warnings)
        total = len(self.rows)
        return {
            "rows": total,
            "valid": total - errors - warnings,
            "warnings": warnings,
            "errors": errors,
            "importable": total - errors,
        }


# --- headers -----------------------------------------------------------------------------


@dataclass
class MappedFile:
    rows: list[tuple[int, dict[str, str]]]
    file_type: str
    file_warnings: list[str]
    unknown_columns: list[str]
    ignored_columns: list[str]
    present_columns: list[str]


def _columns(kind: str) -> dict[str, ImportColumn]:
    cols = {c.key: c for c in COLUMNS_BY_KIND[kind]}
    if kind == "test_case":
        for c in TC_IMPORT_ONLY:
            cols[c.key] = c
    return cols


def map_file(kind: str, filename: str | None, raw: bytes) -> MappedFile:
    parsed = read_upload(filename, raw)
    index = build_header_index(kind)
    columns = _columns(kind)
    key_by_position: list[str | None] = []
    seen: dict[str, str] = {}
    unknown: list[str] = []
    ignored: list[str] = []
    warnings: list[str] = []
    for header in parsed.headers:
        label = header.strip()
        if not label:
            key_by_position.append(None)
            continue
        key = index.get(re.sub(r"[^a-z0-9]", "", label.lower()))
        if key is None:
            unknown.append(label)
            key_by_position.append(None)
            continue
        if key in seen:
            warnings.append(f"Column '{label}' repeats '{seen[key]}'; only the first one is used.")
            key_by_position.append(None)
            continue
        seen[key] = label
        if columns[key].readonly:
            ignored.append(label)
            key_by_position.append(None)
            continue
        key_by_position.append(key)
    present = [k for k in key_by_position if k is not None]
    missing = [c.header for c in COLUMNS_BY_KIND[kind] if c.mandatory and c.key not in present]
    if missing:
        raise ValidationAppError(
            "The file is missing mandatory column(s): " + ", ".join(missing),
            fields={name: "Column is missing" for name in missing},
        )
    if unknown:
        warnings.append("Unknown column(s) ignored: " + ", ".join(unknown))
    rows: list[tuple[int, dict[str, str]]] = []
    example_title = TC_EXAMPLE_TITLE if kind == "test_case" else DEFECT_EXAMPLE_TITLE
    skipped_example = False
    for number, cells in parsed.rows:
        mapped: dict[str, str] = {}
        for position, key in enumerate(key_by_position):
            if key is not None and position < len(cells):
                mapped[key] = cells[position]
        if mapped.get("title", "").strip() == example_title:
            skipped_example = True
            continue
        rows.append((number, mapped))
    if skipped_example:
        warnings.append("The example row of the template was skipped.")
    if not rows:
        raise ValidationAppError("The file has no data rows")
    return MappedFile(
        rows=rows,
        file_type=parsed.file_type,
        file_warnings=warnings,
        unknown_columns=unknown,
        ignored_columns=ignored,
        present_columns=present,
    )


# --- lookups -----------------------------------------------------------------------------


class ModulePlan:
    """The project's module tree plus the modules an import would add. Nodes are keyed by
    their lower-cased path; matching is case-insensitive, new names keep the file's case."""

    def __init__(self, db: Session, tenant_id: UUID, project_id: UUID) -> None:
        self.tenant_id = tenant_id
        self.project_id = project_id
        modules = db.execute(
            select(TestModule.id, TestModule.parent_id, TestModule.name).where(
                TestModule.tenant_id == tenant_id, TestModule.project_id == project_id
            )
        ).all()
        by_id = {m.id: m for m in modules}
        self.ids: dict[tuple[str, ...], UUID] = {}
        for module in modules:
            parts: list[str] = []
            cursor: Any = module
            guard = 0
            while cursor is not None and guard < 20:
                parts.append(cursor.name.strip().lower())
                cursor = by_id.get(cursor.parent_id) if cursor.parent_id else None
                guard += 1
            self.ids.setdefault(tuple(reversed(parts)), module.id)
        # lower path -> (display parts), in creation order
        self.to_create: dict[tuple[str, ...], tuple[str, ...]] = {}

    def register(self, parts: list[str]) -> tuple[str, ...]:
        key = tuple(p.lower() for p in parts)
        for depth in range(1, len(key) + 1):
            prefix = key[:depth]
            if prefix not in self.ids and prefix not in self.to_create:
                self.to_create[prefix] = tuple(parts[:depth])
        return key

    def paths_to_create(self) -> list[str]:
        return ["/".join(display) for display in self.to_create.values()]

    def materialise(self, db: Session) -> int:
        """Create the planned modules (parents first); returns how many."""
        created = 0
        for prefix in sorted(self.to_create, key=len):
            display = self.to_create[prefix]
            parent_id = self.ids.get(prefix[:-1]) if len(prefix) > 1 else None
            module = TestModule(
                tenant_id=self.tenant_id,
                project_id=self.project_id,
                parent_id=parent_id,
                name=display[-1],
            )
            db.add(module)
            db.flush()
            self.ids[prefix] = module.id
            created += 1
        self.to_create = {}
        return created

    def id_for(self, key: tuple[str, ...]) -> UUID | None:
        return self.ids.get(key)


class _EnumSet:
    """Case-insensitive match of a cell to a canonical value (code or label)."""

    def __init__(self, label: str, pairs: list[tuple[str, str]]) -> None:
        # pairs: (canonical code, label)
        self.label = label
        self.canonical = [code for code, _ in pairs]
        self.lookup: dict[str, str] = {}
        for code, lab in pairs:
            self.lookup[code.strip().lower()] = code
            self.lookup.setdefault(lab.strip().lower(), code)

    def resolve(self, value: str) -> tuple[str | None, str | None]:
        found = self.lookup.get(value.strip().lower().replace("’", "'"))
        if found is not None:
            return found, None
        message = f"'{value}' is not an allowed {self.label}. Allowed: {', '.join(self.canonical)}."
        if self.canonical:
            best = process.extractOne(value, self.canonical, processor=str.lower, score_cutoff=55)
            if best is not None:
                message += f" Did you mean '{best[0]}'?"
        return None, message


def _options(db: Session, tenant_id: UUID, key: str, label: str) -> _EnumSet:
    return _EnumSet(
        label, [(o.code, o.label) for o in field_option_service.list_options(db, tenant_id, key)]
    )


def _fixed(label: str, values: Collection[str]) -> _EnumSet:
    return _EnumSet(label, [(v, v) for v in values])


def _cell(cells: dict[str, str], key: str) -> str:
    return (cells.get(key) or "").strip()


def _split_list(raw: str) -> list[str]:
    return [p.strip() for p in re.split(r"[;,\n]", raw) if p.strip()]


def _truncate(value: str, limit: int = 160) -> str:
    one = " ".join(value.split())
    return one if len(one) <= limit else one[: limit - 1] + "..."


@dataclass
class _People:
    by_email: dict[str, User]
    by_name: dict[str, list[User]]

    def find(self, value: str) -> User | None:
        user = self.by_email.get(value.strip().lower())
        if user is not None:
            return user
        named = self.by_name.get(value.strip().lower(), [])
        return named[0] if len(named) == 1 else None


def _load_people(db: Session, tenant_id: UUID) -> _People:
    by_email: dict[str, User] = {}
    by_name: dict[str, list[User]] = {}
    for user in db.execute(
        select(User).where(User.tenant_id == tenant_id, User.is_active.is_(True))
    ).scalars():
        by_email[str(user.email).lower()] = user
        by_name.setdefault(user.name.strip().lower(), []).append(user)
    return _People(by_email, by_name)


def load_project(db: Session, actor: Actor, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == actor.tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    if actor.role_code == "tester" and not is_assigned(db, project, actor.user_id):
        raise ForbiddenError("You are not assigned to this project")
    return project


# --- shared row helpers --------------------------------------------------------------------


def _check_module(raw: str, out: RowOutcome, header: str, *, required: bool) -> list[str] | None:
    value = raw.strip()
    if not value:
        if required:
            out.errors.append(Issue(header, "Module is required."))
        return None
    parts = [p.strip() for p in value.split("/")]
    if any(not p for p in parts):
        out.errors.append(Issue(header, "Module path has an empty part (use Module/Submodule)."))
        return None
    if len(parts) > MAX_MODULE_DEPTH:
        out.errors.append(Issue(header, f"Module path is deeper than {MAX_MODULE_DEPTH} levels."))
        return None
    if any(len(p) > MODULE_NAME_MAX for p in parts):
        out.errors.append(Issue(header, f"A module name is longer than {MODULE_NAME_MAX}."))
        return None
    return parts


def _register_modules(modules: ModulePlan, results: list[RowOutcome]) -> None:
    """Only rows that will be imported may add modules."""
    for out in results:
        parts = out.plan.get("module_parts")
        out.plan["module_key"] = modules.register(parts) if parts and not out.errors else None


def _check_display_id(
    kind: str,
    requested: str,
    header: str,
    out: RowOutcome,
    seen_in_file: dict[str, int],
    existing: set[str],
) -> None:
    """Preserved when well formed and unique, otherwise assigned (a warning)."""
    plan = out.plan
    plan["display_seq"] = None
    if not requested:
        return
    candidate = requested.strip().upper()
    match = _ID_RE[kind].match(candidate)
    if match is None or int(match.group(1)) > _DISPLAY_SEQ_MAX or int(match.group(1)) < 1:
        out.warnings.append(
            Issue(header, f"'{requested}' is not a valid id; a new id will be assigned.")
        )
        return
    if candidate in seen_in_file:
        out.errors.append(
            Issue(header, f"Duplicate id '{candidate}' (also on row {seen_in_file[candidate]}).")
        )
        return
    seen_in_file[candidate] = out.row_number
    if candidate in existing:
        out.warnings.append(
            Issue(
                header,
                f"'{candidate}' is already used in this workspace; a new id will be assigned.",
            )
        )
        return
    plan["display_seq"] = int(match.group(1))
    plan["display_id"] = candidate


def _existing_display_ids(
    db: Session, tenant_id: UUID, model: type, rows: list[tuple[int, dict[str, str]]]
) -> set[str]:
    wanted = {_cell(cells, "display_id").upper() for _, cells in rows if _cell(cells, "display_id")}
    if not wanted:
        return set()
    column = model.display_id  # type: ignore[attr-defined]
    found = db.execute(
        select(column)
        .where(model.tenant_id == tenant_id, column.in_(sorted(wanted)))  # type: ignore[attr-defined]
        .execution_options(include_deleted=True)
    ).scalars()
    return {d for d in found if d}


def _text_field(
    out: RowOutcome,
    header: str,
    value: str,
    limit: int,
    *,
    markdown: bool = True,
    required: bool = False,
) -> str | None:
    cleaned = sanitize_markdown(value) if markdown else clean_plain(value)
    if not cleaned:
        if required:
            out.errors.append(Issue(header, f"{header} is required."))
        return None
    if len(cleaned) > limit:
        out.errors.append(Issue(header, f"{header} must be at most {limit} characters."))
        return None
    return cleaned


def _title(out: RowOutcome, header: str, raw: str) -> str | None:
    title = clean_plain(raw)
    if len(title) < TITLE_MIN:
        out.errors.append(Issue(header, f"Title must be at least {TITLE_MIN} characters."))
        return None
    if len(title) > TITLE_MAX:
        out.errors.append(Issue(header, f"Title must be at most {TITLE_MAX} characters."))
        return None
    return title


def _enum(
    out: RowOutcome,
    header: str,
    raw: str,
    values: _EnumSet,
    *,
    required: bool,
) -> str | None:
    if not raw:
        if required:
            out.errors.append(Issue(header, f"{header} is required."))
        return None
    code, message = values.resolve(raw)
    if code is None:
        out.errors.append(Issue(header, message or "Invalid value."))
    return code


def _steps(out: RowOutcome, header: str, raw: str, *, require_expected: bool) -> list[ParsedStep]:
    steps, problems = parse_steps(raw, require_expected=require_expected)
    for problem in problems:
        out.errors.append(Issue(header, problem))
    if not steps and not problems:
        out.errors.append(Issue(header, "At least one step is required."))
    return steps


def _can(actor: Actor, *codes: str, tiers: tuple[str, ...] = ()) -> bool:
    return any(c in actor.permissions for c in codes) or actor.role_code in tiers


def _project_tasks(db: Session, tenant_id: UUID, project_id: UUID) -> dict[str, UUID]:
    """TASK_000001 -> task id, for the live tasks of one project."""
    rows = db.execute(
        select(Task.display_id, Task.id).where(
            Task.tenant_id == tenant_id,
            Task.project_id == project_id,
            Task.display_id.is_not(None),
        )
    )
    return {str(display).upper(): task_id for display, task_id in rows}


def _task_refs(
    out: RowOutcome, header: str, raw: str, tasks: dict[str, UUID]
) -> tuple[list[UUID], list[str]]:
    ids: list[UUID] = []
    labels: list[str] = []
    for ref in _split_list(raw):
        task_id = tasks.get(ref.upper())
        if task_id is None:
            out.errors.append(Issue(header, f"Task '{ref}' does not exist in this project."))
        elif task_id not in ids:
            ids.append(task_id)
            labels.append(ref.upper())
    return ids, labels


# --- test case validation ----------------------------------------------------------------


def validate_test_cases(
    db: Session, actor: Actor, project: Project, rows: list[tuple[int, dict[str, str]]]
) -> Outcome:
    columns = _columns("test_case")
    header = {k: c.header for k, c in columns.items()}
    people = _load_people(db, actor.tenant_id)
    modules = ModulePlan(db, actor.tenant_id, project.id)
    priorities = _options(db, actor.tenant_id, "test_case_priority", "Priority")
    test_types = _options(db, actor.tenant_id, "test_type", "Test Type")
    severities = _options(db, actor.tenant_id, "test_case_severity", "Severity")
    automation = _fixed("Automation Status", AUTOMATION_STATUSES)
    review = _fixed("Review Status", list(_REVIEW_STATUS_LABEL.values()))
    existing_ids = _existing_display_ids(db, actor.tenant_id, TestCase, rows)
    titles_in_project = {
        t.lower()
        for t in db.execute(
            select(TestCase.title).where(
                TestCase.tenant_id == actor.tenant_id, TestCase.project_id == project.id
            )
        ).scalars()
    }
    tasks = _project_tasks(db, actor.tenant_id, project.id)
    # The same rule as linking on the task page, including a project role override.
    # (it reads only the user id and permissions, which an Actor has).
    can_link_tasks = "task.manage" in get_effective_permissions_for_project(
        db,
        actor,  # type: ignore[arg-type]
        project.id,
    )
    seen_ids: dict[str, int] = {}
    seen_titles: dict[str, int] = {}
    results: list[RowOutcome] = []

    for number, cells in rows:
        out = RowOutcome(number)
        plan = out.plan
        _check_display_id(
            "test_case",
            _cell(cells, "display_id"),
            header["display_id"],
            out,
            seen_ids,
            existing_ids,
        )
        title = _title(out, header["title"], _cell(cells, "title"))
        plan["title"] = title
        if title:
            lowered = title.lower()
            if lowered in titles_in_project:
                out.warnings.append(
                    Issue(
                        header["title"],
                        f"A test case titled '{title}' already exists in this project.",
                    )
                )
            elif lowered in seen_titles:
                out.warnings.append(
                    Issue(
                        header["title"], f"Same title as row {seen_titles[lowered]} of this file."
                    )
                )
            seen_titles.setdefault(lowered, number)

        module_raw = _cell(cells, "module")
        sub = _cell(cells, "sub_module")
        if module_raw and sub:
            module_raw = f"{module_raw}/{sub}"
        plan["module_parts"] = _check_module(module_raw, out, header["module"], required=True)

        plan["priority"] = _enum(
            out, header["priority"], _cell(cells, "priority"), priorities, required=True
        )
        plan["test_type"] = _enum(
            out, header["test_type"], _cell(cells, "test_type"), test_types, required=False
        )
        plan["severity"] = _enum(
            out, header["severity"], _cell(cells, "severity"), severities, required=False
        )
        auto = _enum(
            out,
            header["automation_status"],
            _cell(cells, "automation_status"),
            automation,
            required=False,
        )
        plan["automation_status"] = auto or DEFAULT_AUTOMATION_STATUS

        status_label = _enum(
            out, header["status"], _cell(cells, "status").replace("_", " "), review, required=False
        )
        status = _REVIEW_STATUS[(status_label or "Draft").lower()]
        if status == "approved" and not _can(actor, "testcase.approve", tiers=("admin",)):
            out.errors.append(
                Issue(header["status"], "You are not allowed to import approved test cases.")
            )
        if status == "deprecated" and not _can(actor, "testcase.deprecate", tiers=("admin",)):
            out.errors.append(
                Issue(header["status"], "You are not allowed to import deprecated test cases.")
            )
        plan["status"] = status

        plan["description"] = _text_field(
            out, header["description"], _cell(cells, "description"), DESCRIPTION_MAX
        )
        plan["preconditions"] = _text_field(
            out,
            header["preconditions"],
            _cell(cells, "preconditions"),
            CONTENT_TEXT_MAX,
            required=True,
        )
        plan["test_data"] = _text_field(
            out,
            header["test_data"],
            _cell(cells, "test_data"),
            TEST_DATA_MAX,
            markdown=False,
            required=True,
        )
        plan["expected_result"] = _text_field(
            out,
            header["expected_result"],
            _cell(cells, "expected_result"),
            CONTENT_TEXT_MAX,
            required=True,
        )
        plan["postconditions"] = _text_field(
            out, header["postconditions"], _cell(cells, "postconditions"), CONTENT_TEXT_MAX
        )
        plan["requirement_ref"] = _text_field(
            out,
            header["requirement_ref"],
            _cell(cells, "requirement_ref"),
            SHORT_TEXT_MAX,
            markdown=False,
        )
        plan["environment"] = _text_field(
            out, header["environment"], _cell(cells, "environment"), SHORT_TEXT_MAX, markdown=False
        )
        plan["scenario_id"] = _text_field(
            out, header["scenario_id"], _cell(cells, "scenario_id"), SHORT_TEXT_MAX, markdown=False
        )
        plan["scenario_description"] = _text_field(
            out,
            header["scenario_description"],
            _cell(cells, "scenario_description"),
            CONTENT_TEXT_MAX,
        )
        steps = _steps(out, header["steps"], _cell(cells, "steps"), require_expected=True)
        plan["steps"] = steps

        assignee_raw = _cell(cells, "assignee")
        plan["assignee_id"] = None
        if assignee_raw:
            user = people.by_email.get(assignee_raw.lower())
            if user is None:
                out.errors.append(
                    Issue(header["assignee"], f"'{assignee_raw}' is not an active user's email.")
                )
            else:
                plan["assignee_id"] = user.id

        task_ids, task_labels = _task_refs(out, header["task"], _cell(cells, "task"), tasks)
        if task_ids and not can_link_tasks:
            out.errors.append(
                Issue(header["task"], "You are not allowed to link test cases to tasks.")
            )
        plan["task_ids"] = task_ids

        out.data = {
            "display_id": plan.get("display_id") or _cell(cells, "display_id"),
            "title": title or _cell(cells, "title"),
            "module": module_raw,
            "test_type": plan["test_type"] or _cell(cells, "test_type"),
            "priority": plan["priority"] or _cell(cells, "priority"),
            "severity": plan["severity"] or _cell(cells, "severity"),
            "automation_status": plan["automation_status"],
            "status": _REVIEW_STATUS_LABEL.get(status, status),
            "steps": f"{len(steps)} step{'s' if len(steps) != 1 else ''}",
            "assignee": assignee_raw,
            "task": "; ".join(task_labels) or _cell(cells, "task"),
        }
        results.append(out)
    _register_modules(modules, results)
    return Outcome("test_case", results, modules.paths_to_create(), modules)


# --- defect validation -------------------------------------------------------------------


def validate_defects(
    db: Session, actor: Actor, project: Project, rows: list[tuple[int, dict[str, str]]]
) -> Outcome:
    columns = _columns("defect")
    header = {k: c.header for k, c in columns.items()}
    people = _load_people(db, actor.tenant_id)
    member_ids = set(
        db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
        ).scalars()
    )
    member_ids.add(project.owner_id)
    modules = ModulePlan(db, actor.tenant_id, project.id)
    severities = _options(db, actor.tenant_id, "defect_severity", "Severity")
    priorities = _options(db, actor.tenant_id, "defect_priority", "Priority")
    labels_map = status_label_service.get_labels_map(db, actor.tenant_id, "defect")
    statuses = _EnumSet(
        "Status",
        [(code, labels_map.get(code, code)) for code in DEFECT_STATUSES],
    )
    resolutions = _fixed("Resolution", RESOLUTIONS)
    root_causes = _fixed("Root Cause", _ROOT_CAUSES)
    existing_ids = _existing_display_ids(db, actor.tenant_id, Defect, rows)
    titles_in_project = {
        t.lower()
        for t in db.execute(
            select(Defect.title).where(
                Defect.tenant_id == actor.tenant_id, Defect.project_id == project.id
            )
        ).scalars()
    }
    case_query = tester_visibility.scope_case_query(
        db,
        actor.tenant_id,
        actor.role_code,
        actor.user_id,
        select(TestCase.display_id, TestCase.id).where(
            TestCase.tenant_id == actor.tenant_id,
            TestCase.project_id == project.id,
            TestCase.display_id.is_not(None),
        ),
    )
    case_by_display = {str(d).upper(): cid for d, cid in db.execute(case_query)}
    tasks = _project_tasks(db, actor.tenant_id, project.id)
    can_assign = defect_service.can_assign(actor.role_code, actor.permissions)
    can_move = _can(actor, "defect.change_status", "defect.close", tiers=("admin", "manager"))
    can_close = defect_service.can_close(actor.role_code, actor.permissions)
    seen_ids: dict[str, int] = {}
    seen_titles: dict[str, int] = {}
    results: list[RowOutcome] = []

    for number, cells in rows:
        out = RowOutcome(number)
        plan = out.plan
        _check_display_id(
            "defect", _cell(cells, "display_id"), header["display_id"], out, seen_ids, existing_ids
        )
        title = _title(out, header["title"], _cell(cells, "title"))
        plan["title"] = title
        if title:
            lowered = title.lower()
            if lowered in titles_in_project:
                out.warnings.append(
                    Issue(
                        header["title"],
                        f"A defect titled '{title}' already exists in this project.",
                    )
                )
            elif lowered in seen_titles:
                out.warnings.append(
                    Issue(
                        header["title"], f"Same title as row {seen_titles[lowered]} of this file."
                    )
                )
            seen_titles.setdefault(lowered, number)

        plan["module_parts"] = _check_module(
            _cell(cells, "module"), out, header["module"], required=False
        )
        plan["description"] = _text_field(
            out, header["description"], _cell(cells, "description"), DESCRIPTION_MAX, required=True
        )
        plan["preconditions"] = _text_field(
            out, header["preconditions"], _cell(cells, "preconditions"), CONTENT_TEXT_MAX
        )
        plan["expected_result"] = _text_field(
            out,
            header["expected_result"],
            _cell(cells, "expected_result"),
            CONTENT_TEXT_MAX,
            required=True,
        )
        plan["actual_result"] = _text_field(
            out,
            header["actual_result"],
            _cell(cells, "actual_result"),
            CONTENT_TEXT_MAX,
            required=True,
        )
        plan["environment"] = _text_field(
            out,
            header["environment"],
            _cell(cells, "environment"),
            SHORT_TEXT_MAX,
            markdown=False,
            required=True,
        )
        plan["build_found"] = _text_field(
            out, header["build_found"], _cell(cells, "build_found"), BUILD_FOUND_MAX, markdown=False
        )
        plan["fix_version"] = _text_field(
            out, header["fix_version"], _cell(cells, "fix_version"), FIX_VERSION_MAX, markdown=False
        )
        plan["root_cause_notes"] = _text_field(
            out, header["root_cause_notes"], _cell(cells, "root_cause_notes"), ROOT_CAUSE_NOTES_MAX
        )
        plan["severity"] = _enum(
            out, header["severity"], _cell(cells, "severity"), severities, required=True
        )
        plan["priority"] = _enum(
            out, header["priority"], _cell(cells, "priority"), priorities, required=True
        )
        plan["root_cause"] = _enum(
            out, header["root_cause"], _cell(cells, "root_cause"), root_causes, required=False
        )
        steps = _steps(
            out, header["repro_steps"], _cell(cells, "repro_steps"), require_expected=False
        )
        plan["steps"] = steps

        status_raw = _cell(cells, "status")
        status = _enum(out, header["status"], status_raw, statuses, required=False)
        status_ok = status is not None or not status_raw
        status = status or "New"
        resolution_raw = _cell(cells, "resolution")
        resolution = _enum(out, header["resolution"], resolution_raw, resolutions, required=False)
        resolution_ok = resolution is not None or not resolution_raw
        if status == "Fixed" and resolution is None and resolution_ok:
            resolution = "Fixed"
        if status_ok and resolution_ok:
            problem = resolution_error(status, resolution)
            if problem:
                out.errors.append(Issue(header["resolution"], problem))
        closing = status in CLOSED_DEFECT_STATUSES
        if (closing and not can_close) or (
            status not in CREATE_DEFECT_STATUSES and not closing and not can_move
        ):
            out.errors.append(
                Issue(
                    header["status"],
                    f"You are not allowed to import defects in status '{status}' "
                    "(New and Assigned need no extra permission; Closed and Rejected need "
                    "the close permission).",
                )
            )
        plan["status"] = status
        plan["resolution"] = resolution
        plan["closed"] = status in CLOSED_DEFECT_STATUSES

        assignee_raw = _cell(cells, "assignee")
        plan["assignee_id"] = None
        if assignee_raw:
            user = people.find(assignee_raw)
            if user is None:
                out.errors.append(
                    Issue(header["assignee"], f"'{assignee_raw}' is not an active user's email.")
                )
            elif user.id not in member_ids:
                out.errors.append(
                    Issue(header["assignee"], f"'{assignee_raw}' is not a member of this project.")
                )
            elif not can_assign:
                out.errors.append(
                    Issue(header["assignee"], "You are not allowed to assign defects.")
                )
            else:
                plan["assignee_id"] = user.id

        try:
            plan["labels"] = normalise_labels(_split_list(_cell(cells, "labels"))) or []
        except ValueError as exc:
            plan["labels"] = []
            out.errors.append(Issue(header["labels"], str(exc)))

        linked: list[UUID] = []
        linked_labels: list[str] = []
        for ref in _split_list(_cell(cells, "linked_issues")):
            case_id = case_by_display.get(ref.upper())
            if case_id is None:
                out.errors.append(
                    Issue(
                        header["linked_issues"],
                        f"Linked test case '{ref}' does not exist in this project.",
                    )
                )
            elif case_id not in linked:
                linked.append(case_id)
                linked_labels.append(ref.upper())
        plan["linked_case_ids"] = linked

        task_ids, task_labels = _task_refs(out, header["task"], _cell(cells, "task"), tasks)
        if len(task_ids) > 1:
            out.errors.append(Issue(header["task"], "A defect can belong to only one task."))
        plan["task_id"] = task_ids[0] if task_ids else None

        out.data = {
            "display_id": plan.get("display_id") or _cell(cells, "display_id"),
            "title": title or _cell(cells, "title"),
            "module": _cell(cells, "module"),
            "severity": plan["severity"] or _cell(cells, "severity"),
            "priority": plan["priority"] or _cell(cells, "priority"),
            "status": labels_map.get(status, status),
            "resolution": resolution or "",
            "environment": _truncate(_cell(cells, "environment"), 60),
            "steps": f"{len(steps)} step{'s' if len(steps) != 1 else ''}",
            "assignee": assignee_raw,
            "linked_issues": "; ".join(linked_labels),
            "task": "; ".join(task_labels) or _cell(cells, "task"),
        }
        results.append(out)
    _register_modules(modules, results)
    return Outcome("defect", results, modules.paths_to_create(), modules)


def validate(
    db: Session, actor: Actor, kind: str, project: Project, rows: list[tuple[int, dict[str, str]]]
) -> Outcome:
    if kind == "test_case":
        return validate_test_cases(db, actor, project, rows)
    return validate_defects(db, actor, project, rows)


# --- sessions ----------------------------------------------------------------------------


def _pack(payload: dict[str, Any]) -> bytes:
    return gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"), 3)


def _unpack(blob: bytes) -> dict[str, Any]:
    return json.loads(gzip.decompress(blob).decode("utf-8"))


def purge_expired(db: Session, tenant_id: UUID) -> None:
    db.execute(
        text("DELETE FROM import_sessions WHERE tenant_id = :t AND expires_at < now()"),
        {"t": str(tenant_id)},
    )


def _issues(outcome: Outcome) -> tuple[list[dict[str, Any]], bool]:
    issues: list[dict[str, Any]] = []
    for row in outcome.rows:
        for severity, items in (("error", row.errors), ("warning", row.warnings)):
            for item in items:
                if len(issues) >= MAX_LISTED_ISSUES:
                    return issues, True
                issues.append(
                    {
                        "row_number": row.row_number,
                        "severity": severity,
                        "column": item.column,
                        "message": item.message,
                    }
                )
    return issues, False


def _preview_body(
    session: ImportSession, outcome: Outcome, mapped_meta: dict[str, Any]
) -> dict[str, Any]:
    issues, truncated = _issues(outcome)
    counts = outcome.counts()
    return {
        "token": str(session.id),
        "expires_at": session.expires_at.isoformat(),
        "kind": session.kind,
        "project_id": str(session.project_id),
        "filename": session.filename,
        "file_type": mapped_meta["file_type"],
        "totals": counts,
        "async_commit": counts["importable"] > settings.import_async_threshold,
        "file_warnings": mapped_meta["file_warnings"],
        "unknown_columns": mapped_meta["unknown_columns"],
        "ignored_columns": mapped_meta["ignored_columns"],
        "modules_to_create": outcome.modules_to_create,
        "preview_columns": [
            {"key": k, "label": label} for k, label in PREVIEW_COLUMNS[session.kind]
        ],
        "rows": [r.as_dict() for r in outcome.rows[:PREVIEW_ROWS]],
        "rows_shown": min(len(outcome.rows), PREVIEW_ROWS),
        "issues": issues,
        "issues_truncated": truncated,
    }


def create_preview(
    db: Session,
    actor: Actor,
    kind: str,
    project_id: UUID,
    filename: str | None,
    raw: bytes,
) -> dict[str, Any]:
    project = load_project(db, actor, project_id)
    mapped = map_file(kind, filename, raw)
    outcome = validate(db, actor, kind, project, mapped.rows)
    meta = {
        "file_type": mapped.file_type,
        "file_warnings": mapped.file_warnings,
        "unknown_columns": mapped.unknown_columns,
        "ignored_columns": mapped.ignored_columns,
    }
    counts = outcome.counts()
    payload = _pack(
        {
            "meta": meta,
            "rows": [[n, cells] for n, cells in mapped.rows],
            "results": [r.as_dict() for r in outcome.rows],
            "modules_to_create": outcome.modules_to_create,
        }
    )
    if len(payload) > settings.import_session_max_bytes:
        raise ValidationAppError("The file is too large to preview; split it into smaller files")
    purge_expired(db, actor.tenant_id)
    session = ImportSession(
        tenant_id=actor.tenant_id,
        user_id=actor.user_id,
        kind=kind,
        project_id=project.id,
        filename=(filename or "")[:255] or None,
        status="pending",
        payload=payload,
        row_count=counts["rows"],
        valid_count=counts["importable"],
        error_count=counts["errors"],
        expires_at=datetime.now(UTC) + timedelta(minutes=settings.import_session_ttl_minutes),
    )
    db.add(session)
    db.commit()
    return _preview_body(session, outcome, meta)


def _load_session(
    db: Session,
    actor: Actor,
    kind: str,
    token: str,
    *,
    lock: bool = False,
    any_status: bool = False,
) -> ImportSession:
    try:
        session_id = UUID(token)
    except ValueError as exc:
        raise NotFoundError("The import preview was not found or has expired") from exc
    query = select(ImportSession).where(
        ImportSession.tenant_id == actor.tenant_id,
        ImportSession.user_id == actor.user_id,
        ImportSession.kind == kind,
        ImportSession.id == session_id,
    )
    if lock:
        query = query.with_for_update()
    session = db.execute(query).scalar_one_or_none()
    if session is None or session.expires_at < datetime.now(UTC):
        raise NotFoundError("The import preview was not found or has expired")
    if not any_status and session.status != "pending":
        raise ConflictError("This preview has already been imported")
    return session


def preview_rows(
    db: Session,
    actor: Actor,
    kind: str,
    token: str,
    *,
    status: str | None,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    session = _load_session(db, actor, kind, token, any_status=True)
    data = _unpack(session.payload)
    results: list[dict[str, Any]] = data["results"]
    if status in ("valid", "warning", "error"):
        results = [r for r in results if r["status"] == status]
    elif status == "issues":
        results = [r for r in results if r["status"] != "valid"]
    return {
        "total": len(results),
        "offset": offset,
        "rows": results[offset : offset + limit],
    }


# --- commit ------------------------------------------------------------------------------


def _insert_chunks(db: Session, model: type, rows: list[dict]) -> None:
    """Batched multi-row INSERT (one compiled statement; see csv_import_service)."""
    if not rows:
        return
    table = model.__table__  # type: ignore[attr-defined]
    list(db.execute(insert(table).returning(table.c.id), rows))


def _assign_display_ids(
    db: Session, tenant_id: UUID, kind: str, plans: list[dict[str, Any]]
) -> None:
    """Kept ids first (the counter moves past the highest), then one range for the rest."""
    kept = [p["display_seq"] for p in plans if p.get("display_seq")]
    if kept:
        display_id_service.ensure_counter_above(db, tenant_id, kind, max(kept))
    missing = [p for p in plans if not p.get("display_seq")]
    if missing:
        first = display_id_service.reserve_range(db, tenant_id, kind, len(missing))
        for offset, plan in enumerate(missing):
            plan["display_seq"] = first + offset
            plan["display_id"] = display_id_service.format_display_id(kind, first + offset)


def _insert_test_cases(
    db: Session,
    actor: Actor,
    project: Project,
    plans: list[dict[str, Any]],
    module_ids: dict[tuple[str, ...], UUID],
) -> list[tuple[UUID, dict[str, Any]]]:
    now = datetime.now(UTC)
    case_rows: list[dict] = []
    version_rows: list[dict] = []
    step_rows: list[dict] = []
    created: list[tuple[UUID, dict[str, Any]]] = []
    for plan in plans:
        case_id, version_id = uuid4(), uuid4()
        created.append((case_id, plan))
        approved = plan["status"] == "approved"
        case_rows.append(
            {
                "id": case_id,
                "tenant_id": actor.tenant_id,
                "project_id": project.id,
                "title": plan["title"],
                "priority": plan["priority"],
                "status": plan["status"],
                "assignee_id": plan["assignee_id"],
                "module_id": module_ids.get(plan["module_key"]),
                "created_by": actor.user_id,
                "test_type": plan["test_type"],
                "severity": plan["severity"],
                "automation_status": plan["automation_status"],
                "environment": plan["environment"],
                "requirement_ref": plan["requirement_ref"],
                "display_seq": plan["display_seq"],
                "display_id": plan["display_id"],
            }
        )
        version_rows.append(
            {
                "id": version_id,
                "tenant_id": actor.tenant_id,
                "test_case_id": case_id,
                "version_number": 1,
                "title": plan["title"],
                "description": plan["description"] or "",
                "scenario_id": plan["scenario_id"],
                "scenario_description": plan["scenario_description"],
                "prerequisite": plan["preconditions"],
                "test_data": plan["test_data"],
                "postconditions": plan["postconditions"],
                "expected_result": plan["expected_result"],
                "created_by": actor.user_id,
                "approved_by": actor.user_id if approved else None,
                "approved_at": now if approved else None,
            }
        )
        for number, step in enumerate(plan["steps"], start=1):
            step_rows.append(
                {
                    "tenant_id": actor.tenant_id,
                    "test_case_version_id": version_id,
                    "step_number": number,
                    "action": step.action,
                    "expected": step.expected or "",
                    "test_data": step.test_data,
                }
            )
    _insert_chunks(db, TestCase, case_rows)
    _insert_chunks(db, TestCaseVersion, version_rows)
    _insert_chunks(db, TestCaseVersionStep, step_rows)
    _insert_chunks(
        db,
        TaskTestCaseLink,
        [
            {
                "tenant_id": actor.tenant_id,
                "task_id": task_id,
                "test_case_id": case_id,
                "linked_by": actor.user_id,
            }
            for case_id, plan in created
            for task_id in plan["task_ids"]
        ],
    )
    stmt = text(
        """
        UPDATE test_cases tc
        SET current_version_id = tcv.id
        FROM test_case_versions tcv
        WHERE tcv.test_case_id = tc.id
          AND tcv.version_number = 1
          AND tc.tenant_id = :tenant_id
          AND tc.id = ANY(:ids)
        """
    ).bindparams(bindparam("ids", type_=postgresql.ARRAY(postgresql.UUID(as_uuid=True))))
    db.execute(stmt, {"tenant_id": str(actor.tenant_id), "ids": [cid for cid, _ in created]})
    return created


def _insert_defects(
    db: Session,
    actor: Actor,
    project: Project,
    plans: list[dict[str, Any]],
    module_ids: dict[tuple[str, ...], UUID],
) -> list[tuple[UUID, dict[str, Any]]]:
    now = datetime.now(UTC)
    rows: list[dict] = []
    links: list[dict] = []
    created: list[tuple[UUID, dict[str, Any]]] = []
    for plan in plans:
        defect_id = uuid4()
        created.append((defect_id, plan))
        steps = defect_service.steps_to_json(
            ReproStepIn(action=s.action, test_data=s.test_data, expected_result=s.expected)
            for s in plan["steps"]
        )
        linked: list[UUID] = plan["linked_case_ids"]
        rows.append(
            {
                "id": defect_id,
                "tenant_id": actor.tenant_id,
                "project_id": project.id,
                "title": plan["title"],
                "severity": plan["severity"],
                "priority": plan["priority"],
                "status": plan["status"],
                "resolution": plan["resolution"],
                "description": plan["description"],
                "steps_to_reproduce": defect_service.render_steps_text(steps),
                "repro_steps": steps,
                "expected_result": plan["expected_result"],
                "actual_result": plan["actual_result"],
                "preconditions": plan["preconditions"],
                "environment": plan["environment"],
                "build_found": plan["build_found"],
                "fix_version": plan["fix_version"],
                "labels": plan["labels"],
                "root_cause": plan["root_cause"],
                "root_cause_notes": plan["root_cause_notes"],
                "module_id": module_ids.get(plan["module_key"]),
                "task_id": plan["task_id"],
                "assigned_to": plan["assignee_id"],
                "reported_by": actor.user_id,
                "test_case_id": linked[0] if linked else None,
                "closed_at": now if plan["closed"] else None,
                "display_seq": plan["display_seq"],
                "display_id": plan["display_id"],
            }
        )
        for case_id in linked[1:]:
            links.append(
                {
                    "tenant_id": actor.tenant_id,
                    "defect_id": defect_id,
                    "linkable_type": "test_case",
                    "linkable_id": case_id,
                    "link_type": "relates_to",
                }
            )
    _insert_chunks(db, Defect, rows)
    if links:
        _insert_chunks(db, DefectLink, links)
    return created


def _run_commit(db: Session, actor: Actor, session: ImportSession, mode: str) -> dict[str, Any]:
    """Validate again and insert in the caller's transaction (no commit here)."""
    kind = session.kind
    project = load_project(db, actor, session.project_id)
    data = _unpack(session.payload)
    rows = [(int(n), cells) for n, cells in data["rows"]]
    outcome = validate(db, actor, kind, project, rows)
    counts = outcome.counts()
    bad = [r for r in outcome.rows if r.errors]
    if bad and mode == "all_or_nothing":
        raise ValidationAppError(
            f"{len(bad)} row(s) have errors; nothing was imported. Fix the file and upload it "
            "again, or import the valid rows only.",
            fields={"mode": "all_or_nothing"},
        )
    good = [r for r in outcome.rows if not r.errors]
    if not good:
        raise ValidationAppError("There are no valid rows to import")
    plans = [r.plan for r in good]
    assert outcome.module_plan is not None
    modules_created = outcome.module_plan.materialise(db)
    _assign_display_ids(db, actor.tenant_id, kind, plans)
    if kind == "test_case":
        created = _insert_test_cases(db, actor, project, plans, outcome.module_plan.ids)
    else:
        created = _insert_defects(db, actor, project, plans, outcome.module_plan.ids)

    batch_id = uuid4()
    prefix = "testcase" if kind == "test_case" else "defect"
    entity = "test_case" if kind == "test_case" else "defect"
    events: list[tuple[str, str, UUID, dict | None]] = [
        (
            f"{prefix}.bulk_imported",
            f"{entity}_import_batch",
            batch_id,
            {
                "created_count": len(created),
                "skipped_count": len(bad),
                "error_count": len(bad),
                "total_rows": counts["rows"],
                "mode": mode,
                "source": "standard",
                "file": session.filename,
                "modules_created": modules_created,
            },
        )
    ]
    mapping: list[dict[str, Any]] = []
    for (record_id, plan), result in zip(created, good, strict=True):
        events.append(
            (
                f"{prefix}.created",
                entity,
                record_id,
                {
                    "source": "import",
                    "display_id": plan["display_id"],
                    "import_batch": str(batch_id),
                },
            )
        )
        # The task's own history records each link, as when linked by hand.
        events.extend(
            (
                "task.test_case_linked",
                "task",
                task_id,
                {
                    "source": "import",
                    "test_case_id": str(record_id),
                    "test_case_display_id": plan["display_id"],
                },
            )
            for task_id in plan.get("task_ids", [])
        )
        mapping.append(
            {
                "row_number": result.row_number,
                "id": str(record_id),
                "display_id": plan["display_id"],
            }
        )
    record_audit_events_bulk(db, tenant_id=actor.tenant_id, user_id=actor.user_id, events=events)
    session.status = "committed"
    return {
        "created": len(created),
        "skipped": len(bad),
        "failed": 0,
        "total_rows": counts["rows"],
        "modules_created": modules_created,
        "mode": mode,
        "errors": [
            {
                "row_number": r.row_number,
                "column": i.column,
                "message": i.message,
            }
            for r in bad
            for i in r.errors
        ][:MAX_LISTED_ISSUES],
        "ids": mapping,
        "batch_id": str(batch_id),
    }


def commit(
    db: Session, actor: Actor, kind: str, token: str, mode: str, *, allow_async: bool = True
) -> dict[str, Any]:
    if mode not in MODES:
        raise ValidationAppError("mode must be 'all_or_nothing' or 'skip_invalid'")
    session = _load_session(db, actor, kind, token, lock=True)
    if mode == "all_or_nothing" and session.error_count:
        raise ValidationAppError(
            f"{session.error_count} row(s) have errors; nothing was imported. Fix the file and "
            "upload it again, or import the valid rows only.",
            fields={"mode": "all_or_nothing"},
        )
    if session.valid_count < 1:
        raise ValidationAppError("There are no valid rows to import")
    if allow_async and session.valid_count > settings.import_async_threshold:
        session.status = "queued"
        job = job_service.enqueue(
            db,
            actor.tenant_id,
            actor.user_id,
            COMMIT_JOB_TYPE,
            {
                "session_id": str(session.id),
                "kind": kind,
                "mode": mode,
                "role_code": actor.role_code,
                "actor_user_id": str(actor.user_id),
                "permissions": sorted(actor.permissions),
            },
        )
        return {"async": True, "job_id": str(job.id), "status": job.status}
    try:
        summary = _run_commit(db, actor, session, mode)
        db.commit()
    except Exception:
        db.rollback()
        raise
    summary["async"] = False
    return summary


def run_commit_job(db: Session, job: Any) -> dict[str, Any]:
    """Worker side of an async commit (`job_service.run_job`). The session row was marked
    'queued' by the request; on failure it is released so the user can retry."""
    payload = job.payload
    actor = Actor(
        tenant_id=job.tenant_id,
        user_id=UUID(payload["actor_user_id"]),
        role_code=payload["role_code"],
        permissions=frozenset(payload.get("permissions", [])),
    )
    session_id = UUID(payload["session_id"])
    session = db.execute(
        select(ImportSession)
        .where(ImportSession.tenant_id == actor.tenant_id, ImportSession.id == session_id)
        .with_for_update()
    ).scalar_one_or_none()
    if session is None:
        raise NotFoundError("The import preview was not found or has expired")
    try:
        summary = _run_commit(db, actor, session, payload["mode"])
        db.commit()
    except Exception:
        db.rollback()
        from app.core.db import set_tenant_context

        set_tenant_context(db, str(actor.tenant_id))
        db.execute(
            text("UPDATE import_sessions SET status = 'pending' WHERE id = :i AND tenant_id = :t"),
            {"i": str(session_id), "t": str(actor.tenant_id)},
        )
        db.commit()
        raise
    summary["async"] = True
    return summary


def get_commit_job(db: Session, actor: Actor, kind: str, job_id: UUID) -> dict[str, Any]:
    """Status of an async commit; only its creator can read it."""
    from app.models.background_job import BackgroundJob

    job = db.execute(
        select(BackgroundJob).where(
            BackgroundJob.tenant_id == actor.tenant_id,
            BackgroundJob.id == job_id,
            BackgroundJob.created_by == actor.user_id,
            BackgroundJob.job_type == COMMIT_JOB_TYPE,
        )
    ).scalar_one_or_none()
    if job is None or job.payload.get("kind") != kind:
        raise NotFoundError("Job not found")
    return job_service._to_out(job).model_dump(mode="json")
