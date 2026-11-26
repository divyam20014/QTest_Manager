import csv
import io
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.config import get_settings
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.core.field_standards import (
    AUTOMATION_STATUSES,
    CONTENT_TEXT_MAX,
    DEFAULT_AUTOMATION_STATUS,
    DESCRIPTION_MAX,
    MAX_STEPS,
    SHORT_TEXT_MAX,
    STEP_DATA_MAX,
    STEP_TEXT_MAX,
    TEST_DATA_MAX,
    TITLE_MAX,
)
from app.core.import_columns import TEST_CASE_COLUMNS
from app.core.import_steps import format_steps
from app.core.text_sanitize import clean_plain, sanitize_markdown
from app.models.defect import Defect, DefectLink
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskTestCaseLink
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_module import TestModule
from app.schemas.csv_import import (
    ColumnDetectionResult,
    DetectedColumn,
    ImportReport,
    ImportRowResult,
)
from app.schemas.defect import normalise_labels
from app.services import (
    defect_service,
    display_id_service,
    export_common,
    field_option_service,
    test_case_service,
    tester_visibility,
)
from app.services.project_service import is_assigned
from app.services.test_case_service import _last_executions

settings = get_settings()

# Pass 2 (schema realignment): Module/Description are now mandatory
# (matching TestCaseCreateRequest's own mandatory set), Scenario Id/
# Scenario Description/Prerequisite/Test Data/Sub Module are optional.
# Actual_Result/Executed_By/Execution_Date/Status-as-outcome are NOT
# columns here at all -- they are derived from real execution history
# (test_case_service._last_execution), never importable.
EXPECTED_HEADERS = [
    "Title",
    "Module",
    "Sub Module",
    "Project Name",
    "Priority",
    "Status",
    "Description",
    "Scenario Id",
    "Scenario Description",
    "Prerequisite",
    "Test Data",
    "Assignee Email",
    "Steps",
]

# ADR-116: optional columns of the 22-field standard. A file that carries ANY of
# them is a "standard" import and must also fill Prerequisite (preconditions), Test
# Data and Expected Result for every row (the mandatory fields of a new case); the
# legacy 13-column file keeps its old rules.
EXTENDED_HEADERS = [
    "Requirement ID",
    "Test Type",
    "Severity",
    "Automation Status",
    "Environment",
    "Expected Result",
    "Postconditions",
]

STATUS_MAP = {
    "draft": "draft",
    "ready for review": "ready_for_review",
    "approved": "approved",
}
STATUS_DISPLAY = {
    "draft": "Draft",
    "ready_for_review": "Ready for Review",
    "approved": "Approved",
    "deprecated": "Deprecated",
}

TEMPLATE_CSV = (
    "Title,Module,Sub Module,Project Name,Priority,Status,Description,"
    "Scenario Id,Scenario Description,Prerequisite,Test Data,Assignee Email,Steps\n"
    '"Verify Total Loss Settlement Calculation","Claims","Total Loss",'
    '"Apex Motor Claims Modernization","Critical","Draft",'
    '"Confirms the system correctly computes a total-loss settlement.",'
    '"SCN-001","Total loss settlement with a comprehensive endorsement",'
    '"Policy must be active with comprehensive coverage",'
    '"Policy Number: AUTO-100234",'
    '"tester@example.com",'
    '"Input Policy Number with Comprehensive Endorsement|System displays vehicle ACV;'
    'Apply $500 deductible|Payout amount equals ACV minus $500"\n'
)
# Columns marked (required) in the header comment below are enforced
# server-side; Actual Result/Executed By/Execution Date intentionally do
# not appear here -- they are read-only, derived from real execution
# history, never importable (see TestCaseOut.last_execution_*).
TEMPLATE_NOTES = (
    "# Required columns: Title, Module, Project Name, Priority, Description, Steps.\n"
    "# All other columns are optional. Sub Module nests under Module.\n"
    "# Steps format: 'Action|Expected' pairs separated by ';'.\n"
)


# A plain `db.execute(insert(Model), rows)` is sent by the driver as one single-row
# INSERT per row (about 16,000 statements for a 2,000-case import with steps), so
# the import is dominated by database round trips. Asking for the inserted ids back
# (RETURNING) switches SQLAlchemy to its 'insertmanyvalues' mode: one compiled
# statement template sent as multi-row INSERTs in batches. (Building the multi-row
# `.values([...])` clause by hand was ~4x slower: it recompiles every batch.)


def _insert_in_chunks(db: Session, model: type, rows: list[dict]) -> None:
    """Insert dict rows in batched multi-row INSERTs. Rows the caller omits
    defaults for are filled by the database, as with the single-row path."""
    table = model.__table__  # type: ignore[attr-defined]
    list(db.execute(insert(table).returning(table.c.id), rows))


def _parse_steps(raw: str) -> tuple[list[tuple[str, str, str | None]], list[str]]:
    """'Action|Expected' (optionally '|Test data') steps separated by ';'."""
    errors: list[str] = []
    steps: list[tuple[str, str, str | None]] = []
    if not raw or not raw.strip():
        return steps, ["Steps column is empty; at least one step is required."]

    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = chunk.split("|")
        if len(parts) not in (2, 3) or not parts[0].strip() or not parts[1].strip():
            errors.append(f"Malformed step '{chunk}' (expected 'Action|Expected[|Test data]').")
            continue
        action = sanitize_markdown(parts[0])
        expected = sanitize_markdown(parts[1])
        data = clean_plain(parts[2]) if len(parts) == 3 else ""
        if not action or not expected:
            errors.append(f"Malformed step '{chunk}' (empty action or expected result).")
            continue
        if (
            len(action) > STEP_TEXT_MAX
            or len(expected) > STEP_TEXT_MAX
            or len(data) > STEP_DATA_MAX
        ):
            errors.append(f"Step '{chunk[:40]}...' is too long.")
            continue
        steps.append((action, expected, data or None))

    if len(steps) > MAX_STEPS:
        errors.append(f"A test case may have at most {MAX_STEPS} steps.")
    if not steps and not errors:
        errors.append("Steps column is empty; at least one step is required.")
    return steps, errors


def import_test_cases(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, csv_text: str
) -> ImportReport:
    reader = csv.DictReader(io.StringIO(csv_text))
    headers = list(reader.fieldnames or [])
    # The 13 legacy headers, in order, optionally followed by any of the ADR-116
    # extension columns.
    legacy_ok = headers[: len(EXPECTED_HEADERS)] == EXPECTED_HEADERS
    extras = headers[len(EXPECTED_HEADERS) :]
    if (
        not headers
        or not legacy_ok
        or len(set(extras)) != len(extras)
        or any(h not in EXTENDED_HEADERS for h in extras)
    ):
        raise ValidationAppError(
            f"CSV headers must be exactly: {', '.join(EXPECTED_HEADERS)}"
            f" (optionally followed by: {', '.join(EXTENDED_HEADERS)}). "
            f"Download /test-cases/import/template.csv for a valid example, or use "
            f"/test-cases/import/detect-columns for a flexible, mapped import instead."
        )
    rows = list(reader)
    return _import_test_case_rows(db, tenant_id, role_code, actor_user_id, rows)


# ---------------------------------------------------------------------------
# Pass 3: flexible, mapped import -- lets a user import ANY CSV (including
# one shaped like a TestRail/Zephyr/Jira export) by mapping its own columns
# onto QTestHub's canonical field set, rather than requiring the exact
# EXPECTED_HEADERS. Reuses _import_test_case_rows for every bit of
# validation/duplicate-detection/bulk-insert logic below -- only the header
# step differs.
# ---------------------------------------------------------------------------

#: Canonical target fields a column can be mapped onto. Keys double as the
#: row dict keys _import_test_case_rows already expects (EXPECTED_HEADERS),
#: so a mapped row is simply "the same row dict, assembled differently."
TARGET_FIELDS = [*EXPECTED_HEADERS, *EXTENDED_HEADERS]
REQUIRED_TARGET_FIELDS = ["Title", "Module", "Project Name", "Priority", "Description", "Steps"]

# Best-effort, NOT verified against a real export from any of these tools --
# no real TestRail/Zephyr/Jira account or export file was available to test
# against. Built from each tool's publicly documented/commonly-known CSV
# column conventions. A user should always review the suggested mapping
# before confirming, especially for Steps (see the caveat below).
PRESET_CANDIDATE_COLUMNS: dict[str, dict[str, list[str]]] = {
    "testrail": {
        "Title": ["title", "case title", "name"],
        "Module": ["section", "section hierarchy", "suite"],
        "Sub Module": ["subsection"],
        "Project Name": ["project"],
        "Priority": ["priority"],
        "Status": ["status", "state"],
        "Description": ["preconditions", "description"],
        "Scenario Id": ["references", "case id"],
        "Scenario Description": ["objective"],
        "Prerequisite": ["preconditions"],
        "Test Data": ["test data"],
        "Assignee Email": ["assignee", "assignedto"],
        # TestRail typically exports one Step/Expected Result pair per row,
        # not a combined cell -- mapping either column directly into our
        # single "Steps" field is a best-effort approximation, not a real
        # multi-step reconstruction. Flagged in the UI, not silently assumed.
        "Steps": ["steps", "expected result"],
    },
    "zephyr": {
        "Title": ["name", "test case name"],
        "Module": ["folder", "component"],
        "Project Name": ["project", "project key"],
        "Priority": ["priority"],
        "Status": ["status"],
        "Description": ["objective", "description"],
        "Scenario Id": ["key", "issue key", "test case key"],
        "Scenario Description": ["objective"],
        "Prerequisite": ["precondition", "preconditions"],
        "Test Data": ["test data"],
        "Assignee Email": ["owner", "assignee"],
        "Steps": ["test script", "step", "steps"],
    },
    "jira": {
        "Title": ["summary"],
        "Module": ["component/s", "components"],
        "Project Name": ["project", "project key"],
        "Priority": ["priority"],
        "Status": ["status"],
        "Description": ["description"],
        "Scenario Id": ["issue key", "key"],
        "Prerequisite": ["precondition", "preconditions"],
        "Test Data": ["data"],
        "Assignee Email": ["assignee"],
        "Steps": ["action", "manual test steps", "steps"],
    },
}


def _normalize_column_name(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


def detect_columns(csv_text: str, preset: str | None = None) -> ColumnDetectionResult:
    """Pass 3, item 2: parses only the header row + a few sample rows of an
    arbitrary CSV so the caller can offer a mapping UI, without committing
    to any schema assumption yet."""
    reader = csv.DictReader(io.StringIO(csv_text))
    fieldnames = list(reader.fieldnames or [])
    if not fieldnames:
        raise ValidationAppError("CSV has no header row.")

    sample_rows: list[dict] = []
    for i, row in enumerate(reader):
        if i >= 3:
            break
        sample_rows.append(row)

    columns = [
        DetectedColumn(
            name=name,
            sample_values=[(r.get(name) or "")[:80] for r in sample_rows],
        )
        for name in fieldnames
    ]

    suggested: dict[str, str] = {}
    if preset:
        candidates = PRESET_CANDIDATE_COLUMNS.get(preset.lower())
        if candidates is None:
            raise ValidationAppError(
                f"Unknown preset '{preset}'; must be one of {sorted(PRESET_CANDIDATE_COLUMNS)}."
            )
        normalized_columns = {_normalize_column_name(name): name for name in fieldnames}
        for target, candidate_names in candidates.items():
            for candidate in candidate_names:
                match = normalized_columns.get(_normalize_column_name(candidate))
                if match is not None:
                    suggested[target] = match
                    break

    return ColumnDetectionResult(
        columns=columns,
        suggested_mapping=suggested,
        target_fields=TARGET_FIELDS,
        required_fields=REQUIRED_TARGET_FIELDS,
    )


def import_test_cases_mapped(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    csv_text: str,
    column_mapping: dict[str, str],
) -> ImportReport:
    """Pass 3, item 2: import using a user-confirmed column_mapping
    (target field -> source column name) instead of requiring exact
    EXPECTED_HEADERS. Every other validation/duplicate/insert rule is
    identical to the fixed-header path (_import_test_case_rows)."""
    missing_required = [f for f in REQUIRED_TARGET_FIELDS if f not in column_mapping]
    if missing_required:
        raise ValidationAppError(
            f"These required fields must be mapped to a column: {', '.join(missing_required)}."
        )

    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames is None:
        raise ValidationAppError("CSV has no header row.")
    source_columns = set(reader.fieldnames)
    unknown_sources = set(column_mapping.values()) - source_columns
    if unknown_sources:
        raise ValidationAppError(
            f"Mapped column(s) not found in this file: {', '.join(sorted(unknown_sources))}."
        )

    raw_rows = list(reader)
    canonical_rows = [
        {target: raw.get(source, "") for target, source in column_mapping.items()}
        for raw in raw_rows
    ]
    return _import_test_case_rows(db, tenant_id, role_code, actor_user_id, canonical_rows)


def _import_test_case_rows(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    rows: list[dict],
) -> ImportReport:
    # Materialized up front (not streamed row-by-row) so the row-count cap
    # can be enforced before any validation or DB writes happen.
    if len(rows) > settings.csv_import_max_rows:
        raise ValidationAppError(
            f"CSV has {len(rows)} rows, exceeding the {settings.csv_import_max_rows}-row "
            "import limit. Split the file into smaller batches."
        )

    projects_by_name = {
        p.name.lower(): p
        for p in db.execute(select(Project).where(Project.tenant_id == tenant_id)).scalars()
    }
    users_by_email = {
        u.email.lower(): u
        for u in db.execute(
            select(User).where(User.tenant_id == tenant_id, User.is_active.is_(True))
        ).scalars()
    }
    assigned_project_ids: set[UUID] = set()
    if role_code == "tester":
        assigned_project_ids = set(
            db.execute(
                select(ProjectMember.project_id).where(ProjectMember.user_id == actor_user_id)
            ).scalars()
        )

    # Duplicate detection (GAP: spec functionality item 9) -- a title is a
    # duplicate if it already exists in the same project, or appears more
    # than once in this same batch for the same project. Case-insensitive,
    # scoped per-project (not tenant-wide) since two different projects
    # legitimately having a case titled e.g. "Verify Login" is not a
    # duplicate of anything.
    project_ids = {p.id for p in projects_by_name.values()}
    existing_titles: set[tuple[UUID, str]] = set()
    if project_ids:
        existing_titles = {
            (pid, title.lower())
            for pid, title in db.execute(
                select(TestCase.project_id, TestCase.title).where(
                    TestCase.tenant_id == tenant_id, TestCase.project_id.in_(project_ids)
                )
            ).all()
        }
    seen_in_batch: dict[tuple[UUID, str], int] = {}
    # Fetched once, not per-row: Tier 5 made priority tenant-configurable
    # (field_option_service), and this import path has a 2.5s/2000-row NFR
    # budget it must not regress.
    valid_priorities = {
        o.code for o in field_option_service.list_options(db, tenant_id, "test_case_priority")
    }
    valid_test_types = {
        o.code for o in field_option_service.list_options(db, tenant_id, "test_type")
    }
    valid_severities = {
        o.code for o in field_option_service.list_options(db, tenant_id, "test_case_severity")
    }
    automation_by_lower = {a.lower(): a for a in AUTOMATION_STATUSES}
    # ADR-116: a file with any of the extension columns is a "standard" import and
    # must fill the mandatory fields of a new case; the legacy file keeps its rules.
    standard_mode = bool(rows) and any(h in rows[0] for h in EXTENDED_HEADERS)

    error_rows: list[ImportRowResult] = []
    created_count = 0
    total_rows = 0
    case_rows: list[dict] = []
    version_rows: list[dict] = []
    step_rows: list[dict] = []
    # (project_id, parent_name_or_None, module_name) -> TestModule.id,
    # reused across rows in the same batch so a repeated Module/Sub Module
    # pairing on later rows doesn't re-query/re-create.
    module_cache: dict[tuple[UUID, str | None, str], UUID] = {}

    def _resolve_module(project_id: UUID, module_name: str, sub_module_name: str) -> UUID:
        key = (project_id, None, module_name)
        parent_id = module_cache.get(key)
        if parent_id is None:
            parent = db.execute(
                select(TestModule).where(
                    TestModule.tenant_id == tenant_id,
                    TestModule.project_id == project_id,
                    TestModule.parent_id.is_(None),
                    TestModule.name == module_name,
                )
            ).scalar_one_or_none()
            if parent is None:
                parent = TestModule(
                    tenant_id=tenant_id, project_id=project_id, parent_id=None, name=module_name
                )
                db.add(parent)
                db.flush()
            parent_id = parent.id
            module_cache[key] = parent_id

        if not sub_module_name:
            return parent_id

        child_key = (project_id, module_name, sub_module_name)
        child_id = module_cache.get(child_key)
        if child_id is None:
            child = db.execute(
                select(TestModule).where(
                    TestModule.tenant_id == tenant_id,
                    TestModule.project_id == project_id,
                    TestModule.parent_id == parent_id,
                    TestModule.name == sub_module_name,
                )
            ).scalar_one_or_none()
            if child is None:
                child = TestModule(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    parent_id=parent_id,
                    name=sub_module_name,
                )
                db.add(child)
                db.flush()
            child_id = child.id
            module_cache[child_key] = child_id
        return child_id

    for row_number, row in enumerate(rows, start=1):
        total_rows += 1
        errors: list[str] = []

        title = (row.get("Title") or "").strip()
        if len(title) < 5:
            errors.append("Title must be at least 5 characters.")
        elif len(title) > TITLE_MAX:
            errors.append(f"Title must be at most {TITLE_MAX} characters.")

        module_name = (row.get("Module") or "").strip()
        if not module_name:
            errors.append("Module is required.")
        sub_module_name = (row.get("Sub Module") or "").strip()

        description = sanitize_markdown(row.get("Description") or "")
        if not description:
            errors.append("Description is required.")
        elif len(description) > DESCRIPTION_MAX:
            errors.append(f"Description must be at most {DESCRIPTION_MAX} characters.")

        scenario_id = clean_plain(row.get("Scenario Id") or "")[:SHORT_TEXT_MAX] or None
        scenario_description = sanitize_markdown(row.get("Scenario Description") or "") or None
        prerequisite = sanitize_markdown(row.get("Prerequisite") or "") or None
        test_data = clean_plain(row.get("Test Data") or "") or None
        expected_result = sanitize_markdown(row.get("Expected Result") or "") or None
        postconditions = sanitize_markdown(row.get("Postconditions") or "") or None
        requirement_ref = clean_plain(row.get("Requirement ID") or "") or None
        environment = clean_plain(row.get("Environment") or "") or None
        test_type = clean_plain(row.get("Test Type") or "") or None
        severity = clean_plain(row.get("Severity") or "") or None
        automation_raw = clean_plain(row.get("Automation Status") or "")
        automation_status = automation_by_lower.get(automation_raw.lower())
        if automation_raw and automation_status is None:
            errors.append(
                f"Automation Status '{automation_raw}' is invalid; must be one of "
                f"{list(AUTOMATION_STATUSES)}."
            )
        automation_status = automation_status or DEFAULT_AUTOMATION_STATUS
        if test_type is not None and test_type not in valid_test_types:
            errors.append(f"Test Type '{test_type}' is not a configured option.")
        if severity is not None and severity not in valid_severities:
            errors.append(f"Severity '{severity}' is not a configured option.")
        for label, value, limit in (
            ("Requirement ID", requirement_ref, SHORT_TEXT_MAX),
            ("Environment", environment, SHORT_TEXT_MAX),
            ("Prerequisite", prerequisite, CONTENT_TEXT_MAX),
            ("Expected Result", expected_result, CONTENT_TEXT_MAX),
            ("Postconditions", postconditions, CONTENT_TEXT_MAX),
            ("Test Data", test_data, TEST_DATA_MAX),
        ):
            if value is not None and len(value) > limit:
                errors.append(f"{label} must be at most {limit} characters.")
        if standard_mode:
            for label, value in (
                ("Prerequisite (preconditions)", prerequisite),
                ("Test Data", test_data),
                ("Expected Result", expected_result),
            ):
                if not value:
                    errors.append(f"{label} is required.")

        project_name = (row.get("Project Name") or "").strip()
        project = projects_by_name.get(project_name.lower())
        dedup_key: tuple[UUID, str] | None = None
        if project is None:
            errors.append(f"Project '{project_name}' does not exist in this tenant.")
        elif (
            role_code == "tester"
            and project.owner_id != actor_user_id
            and project.id not in assigned_project_ids
        ):
            errors.append(f"You are not assigned to project '{project_name}'.")
        elif title:
            dedup_key = (project.id, title.lower())
            if dedup_key in existing_titles:
                errors.append(
                    f"A test case titled '{title}' already exists in project '{project_name}'."
                )
            elif dedup_key in seen_in_batch:
                errors.append(
                    f"Duplicate title '{title}' for project '{project_name}' "
                    f"(already used by row {seen_in_batch[dedup_key]} in this file)."
                )
            else:
                seen_in_batch[dedup_key] = row_number

        priority = (row.get("Priority") or "").strip()
        if priority not in valid_priorities:
            errors.append(
                f"Priority '{priority}' is invalid; must be one of {sorted(valid_priorities)}."
            )

        status_raw = (row.get("Status") or "Draft").strip()
        status_internal = STATUS_MAP.get(status_raw.lower())
        if status_internal is None:
            errors.append(
                f"Status '{status_raw}' is invalid; must be Draft, Ready for Review, or Approved."
            )

        assignee_email = (row.get("Assignee Email") or "").strip()
        assignee: User | None = None
        if assignee_email:
            assignee = users_by_email.get(assignee_email.lower())
            if assignee is None:
                errors.append(f"Assignee email '{assignee_email}' does not match an active user.")

        steps, step_errors = _parse_steps(row.get("Steps") or "")
        errors.extend(step_errors)

        if errors:
            error_rows.append(ImportRowResult(row_number=row_number, status="error", errors=errors))
            continue

        assert project is not None  # for type-checkers; guaranteed by the error branch above

        module_id = _resolve_module(project.id, module_name, sub_module_name)

        # Plain dict rows + Core-style bulk insert (not ORM Model(...)
        # instances + session.add()) -- at 2,000+ rows, per-object
        # unit-of-work/identity-map tracking was the dominant cost, far
        # more than network round-trips (NFR 8.1 budgets 2.5s total).
        #
        # test_cases.current_version_id and test_case_versions.test_case_id
        # are a genuine circular FK (ADR-003's use_alter), so cases are
        # inserted first with current_version_id left NULL, then
        # versions/steps, then current_version_id is set in one batched
        # UPDATE (see below) -- never resolved automatically without a
        # relationship(post_update=True), which isn't configured here.
        case_id = uuid4()
        version_id = uuid4()

        case_rows.append(
            {
                "id": case_id,
                "tenant_id": tenant_id,
                "project_id": project.id,
                "title": title,
                "priority": priority,
                "status": status_internal,
                "assignee_id": assignee.id if assignee else None,
                "module_id": module_id,
                "created_by": actor_user_id,
                "test_type": test_type,
                "severity": severity,
                "automation_status": automation_status,
                "environment": environment,
                "requirement_ref": requirement_ref,
            }
        )

        version_row = {
            "id": version_id,
            "tenant_id": tenant_id,
            "test_case_id": case_id,
            "version_number": 1,
            "title": title,
            "description": description,
            "scenario_id": scenario_id,
            "scenario_description": scenario_description,
            "prerequisite": prerequisite,
            "test_data": test_data,
            "postconditions": postconditions,
            "expected_result": expected_result,
            "created_by": actor_user_id,
            "approved_by": actor_user_id if status_internal == "approved" else None,
            "approved_at": datetime.now(UTC) if status_internal == "approved" else None,
        }
        version_rows.append(version_row)

        for i, (action, expected, step_data) in enumerate(steps, start=1):
            step_rows.append(
                {
                    "tenant_id": tenant_id,
                    "test_case_version_id": version_id,
                    "step_number": i,
                    "action": action,
                    "expected": expected,
                    "test_data": step_data,
                }
            )

        created_count += 1

    error_count = len(error_rows)

    if case_rows:
        # One reservation for the whole batch (ADR-115), assigned in CSV order.
        first_seq = display_id_service.reserve_range(db, tenant_id, "test_case", len(case_rows))
        for offset, case_row in enumerate(case_rows):
            case_row["display_seq"] = first_seq + offset
            case_row["display_id"] = display_id_service.format_display_id(
                "test_case", first_seq + offset
            )
        _insert_in_chunks(db, TestCase, case_rows)
        _insert_in_chunks(db, TestCaseVersion, version_rows)
        _insert_in_chunks(db, TestCaseVersionStep, step_rows)

        # One round trip for the whole batch instead of one UPDATE per row
        # (each row's version_number is always 1 at import time, so the
        # join is unambiguous).
        db.execute(
            text(
                """
                UPDATE test_cases tc
                SET current_version_id = tcv.id
                FROM test_case_versions tcv
                WHERE tcv.test_case_id = tc.id
                  AND tcv.version_number = 1
                  AND tc.tenant_id = :tenant_id
                  AND tc.current_version_id IS NULL
                """
            ),
            {"tenant_id": str(tenant_id)},
        )

    batch_id = uuid4()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="testcase.bulk_imported",
        entity_type="test_case_import_batch",
        entity_id=batch_id,
        metadata={
            "created_count": created_count,
            "error_count": error_count,
            "total_rows": total_rows,
        },
    )
    db.commit()

    return ImportReport(
        total_rows=total_rows,
        created_count=created_count,
        error_count=error_count,
        rows=error_rows,
    )


EXPORT_CHUNK = export_common.EXPORT_CHUNK

# ADR-120: export columns, in file order: the 22 standard fields under the catalogue's own
# labels (the same headers as the import template) followed by the few extra columns of the
# legacy file layout. Key -> header. `module` is the full 'Module/Submodule/Feature' path;
# `status` is the lifecycle ("Review") status; `execution_status` is the derived outcome.
EXPORT_COLUMNS: list[tuple[str, str]] = [(c.key, c.header) for c in TEST_CASE_COLUMNS]
EXPORT_COLUMN_KEYS = [k for k, _ in EXPORT_COLUMNS]
EXPORT_HEADER_BY_KEY = dict(EXPORT_COLUMNS)


def parse_export_columns(columns: str | None) -> list[str]:
    """`columns=display_id,title,...` -> validated keys in the requested order
    (default: every column). Unknown or repeated keys are a 422."""
    if columns is None or not columns.strip():
        return list(EXPORT_COLUMN_KEYS)
    keys = [c.strip() for c in columns.split(",") if c.strip()]
    unknown = [k for k in keys if k not in EXPORT_HEADER_BY_KEY]
    if unknown:
        raise ValidationAppError(
            f"Unknown export column(s): {', '.join(unknown)}. "
            f"Valid keys: {', '.join(EXPORT_COLUMN_KEYS)}."
        )
    if len(set(keys)) != len(keys):
        raise ValidationAppError("Export columns must not repeat")
    return keys


def _filtered_cases(
    db: Session, tenant_id: UUID, case_query: Any, filters: dict[str, Any], sort: str
) -> list[TestCase]:
    """Walks the shared list filter/sort/paging page by page so an export of a
    filtered view can never disagree with the list about which rows match."""
    page = 1
    out: list[TestCase] = []
    criteria: dict[str, Any] = {
        "search": None,
        "priority": None,
        "status": None,
        "assignee_id": None,
        "module_id": None,
        **filters,
    }
    while True:
        rows, _total, _cursor = test_case_service._filter_sort_page(
            db,
            case_query.order_by(None),  # the requested sort replaces the default one
            tenant_id=tenant_id,
            sort=sort,
            page=page,
            page_size=test_case_service.MAX_PAGE_SIZE,
            include_total=False,
            **criteria,
        )
        out.extend(rows)
        if len(rows) < test_case_service.MAX_PAGE_SIZE:
            return out
        page += 1


def _linked_task_ids(db: Session, case_ids: list[UUID]) -> dict[UUID, list[str]]:
    """case id -> the display ids of the tasks it is linked to (deleted tasks left out)."""
    out: dict[UUID, list[str]] = {}
    for case_id, display_id in db.execute(
        select(TaskTestCaseLink.test_case_id, Task.display_id)
        .join(Task, Task.id == TaskTestCaseLink.task_id)
        .where(TaskTestCaseLink.test_case_id.in_(case_ids))
        .order_by(Task.display_seq)
    ):
        out.setdefault(case_id, []).append(display_id or "")
    return out


def export_test_cases_data(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    columns: str | None = None,
    filters: dict[str, Any] | None = None,
    sort: str | None = None,
    ids: list[UUID] | None = None,
) -> export_common.ExportData:
    """`filters` / `sort` (ADR-117) are the list page's own filters (the keyword
    arguments of `test_case_service.list_test_cases`), so "export the current view"
    produces exactly the rows the list shows; `ids` (ADR-120) narrows to the selected
    rows. At most `EXPORT_MAX_ROWS` rows (the result is flagged when it was cut)."""
    keys = parse_export_columns(columns)
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    if role_code == "tester" and not is_assigned(db, project, user_id):
        raise ForbiddenError("You are not assigned to this project")

    # Soft-deleted cases are excluded by the ORM hook; ADR-093 scoping applies to a
    # scoped Tester's export.
    case_query = (
        select(TestCase)
        .where(TestCase.tenant_id == tenant_id, TestCase.project_id == project_id)
        .order_by(TestCase.created_at, TestCase.id)
    )
    if ids is not None:
        case_query = case_query.where(TestCase.id.in_(ids))
    case_query = tester_visibility.scope_case_query(db, tenant_id, role_code, user_id, case_query)
    if filters or sort:
        cases = _filtered_cases(db, tenant_id, case_query, filters or {}, sort or "created_at")
    else:
        cases = list(db.execute(case_query).scalars())
    truncated = len(cases) > export_common.EXPORT_MAX_ROWS
    cases = cases[: export_common.EXPORT_MAX_ROWS]

    users_by_id = {
        u.id: u for u in db.execute(select(User).where(User.tenant_id == tenant_id)).scalars()
    }
    module_paths = test_case_service._module_paths(
        db, {c.module_id for c in cases if c.module_id is not None}
    )
    data = export_common.ExportData(
        headers=[EXPORT_HEADER_BY_KEY[k] for k in keys], truncated=truncated
    )

    # ADR-113: serialized per chunk of cases (a handful of queries per 500 cases)
    # instead of several per case. `to_out_many` is the one place the derived
    # fields (execution status, executor, linked defects, counts) are computed, so
    # the export can never disagree with the list.
    outs: dict = {}
    last_by_case: dict = {}
    tasks_by_case: dict = {}
    for case_index, case in enumerate(cases):
        if case_index % EXPORT_CHUNK == 0:
            chunk = cases[case_index : case_index + EXPORT_CHUNK]
            outs = {o.id: o for o in test_case_service.to_out_many(db, chunk)}
            last_by_case = _last_executions(db, tenant_id, [c.id for c in chunk])
            tasks_by_case = _linked_task_ids(db, [c.id for c in chunk])
        out = outs[case.id]
        steps_cell = format_steps([(s.action, s.test_data, s.expected) for s in out.steps])
        assignee_email = users_by_id[case.assignee_id].email if case.assignee_id else ""
        module_cell = module_paths[case.module_id][1] if case.module_id in module_paths else ""
        last_result = last_by_case.get(case.id, (None, None, None))[0]
        values = {
            "display_id": out.display_id or "",
            "title": out.title,
            "module": module_cell,
            "project": project.name,
            "task": "; ".join(tasks_by_case.get(case.id, [])),
            "priority": out.priority,
            "status": STATUS_DISPLAY.get(out.status, out.status),
            "description": out.description,
            "scenario_id": out.scenario_id or "",
            "scenario_description": out.scenario_description or "",
            "preconditions": out.preconditions or "",
            "test_data": out.test_data or "",
            "assignee": assignee_email,
            "steps": steps_cell,
            "requirement_ref": out.requirement_ref or "",
            "test_type": out.test_type or "",
            "severity": out.severity or "",
            "automation_status": out.automation_status or "",
            "environment": out.environment or "",
            "expected_result": out.expected_result or "",
            "postconditions": out.postconditions or "",
            "execution_status": out.execution_status,
            "actual_result": out.last_actual_result or last_result or "",
            "executed_by": out.last_executed_by or out.last_executed_by_name or "",
            "last_executed_at": (
                (out.last_executed_at or out.last_execution_date).isoformat()
                if (out.last_executed_at or out.last_execution_date)
                else ""
            ),
            "linked_defects": "; ".join(d.display_id or str(d.id) for d in out.linked_defects),
            "created_by": out.created_by_name or "",
            "attachments": f"{out.attachment_count} attachments, {out.comment_count} comments",
        }
        data.rows.append([export_common.safe_text(values[k]) for k in keys])
    return data


def export_test_cases_csv(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    columns: str | None = None,
    filters: dict[str, Any] | None = None,
    sort: str | None = None,
    ids: list[UUID] | None = None,
) -> str:
    return export_common.to_csv(
        export_test_cases_data(
            db, tenant_id, role_code, user_id, project_id, columns, filters, sort, ids
        )
    )


# ---------------------------------------------------------------------------
# Defect bulk import/export (Pass 2) -- newly built, following the exact same
# architecture as import_test_cases/export_test_cases_csv above (materialize
# rows up front, per-row validation with collected errors, bulk Core insert,
# audit event, no partial-success silent failures).
# ---------------------------------------------------------------------------

DEFECT_EXPECTED_HEADERS = [
    "Title",
    "Project Name",
    "Severity",
    "Priority",
    "Description",
    "Steps to Reproduce",
    "Expected Result",
    "Actual Result",
    "Environment",
    "Module",
    "Assignee Email",
]

DEFECT_TEMPLATE_CSV = (
    "Title,Project Name,Severity,Priority,Description,Steps to Reproduce,"
    "Expected Result,Actual Result,Environment,Module,Assignee Email\n"
    '"Settlement amount incorrect for total loss claim",'
    '"Apex Motor Claims Modernization","High","High",'
    '"The computed settlement amount does not match policy terms.",'
    '"1. Open claim AUTO-100234|2. Mark vehicle as total loss|3. Review settlement",'
    '"Settlement = ACV - deductible","Settlement = ACV","Staging","Claims",'
    '""\n'
)
# Required columns: Title, Project Name, Severity, Priority, Description.
# Status/Reported By are system-managed (New / the importing user) and are
# intentionally not import columns.


# ADR-118: optional columns of the 22-field defect standard. A file that carries ANY of
# them is a "standard" import and must also satisfy the new mandatory rules (steps to
# reproduce, expected and actual result, environment); the legacy 11-column file keeps
# its old rules. `Bug ID` is kept when it is well formed and unique, otherwise the next
# id is assigned; `Linked Test Case IDs` are test case display ids (';' separated) of the
# row's project.
DEFECT_EXTENDED_HEADERS = [
    "Bug ID",
    "Preconditions",
    "Build Found",
    "Fix Version",
    "Labels",
    "Linked Test Case IDs",
    "Root Cause",
    "Root Cause Notes",
]
_BUG_ID_RE = re.compile(r"^BUG_(\d{6,})$")
_ROOT_CAUSES = {
    "requirements_gap",
    "code_defect",
    "design_flaw",
    "test_data_issue",
    "environment_issue",
    "third_party_integration",
    "other",
}


def import_defects(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, csv_text: str
) -> ImportReport:
    reader = csv.DictReader(io.StringIO(csv_text))
    headers = list(reader.fieldnames or [])
    # The 11 legacy headers, in order, optionally followed by any of the ADR-118
    # extension columns.
    extras = headers[len(DEFECT_EXPECTED_HEADERS) :]
    if (
        not headers
        or headers[: len(DEFECT_EXPECTED_HEADERS)] != DEFECT_EXPECTED_HEADERS
        or len(set(extras)) != len(extras)
        or any(h not in DEFECT_EXTENDED_HEADERS for h in extras)
    ):
        raise ValidationAppError(
            f"CSV headers must be exactly: {', '.join(DEFECT_EXPECTED_HEADERS)}"
            f" (optionally followed by: {', '.join(DEFECT_EXTENDED_HEADERS)}). "
            f"Download /defects/import/template.csv for a valid example."
        )
    standard_mode = bool(extras)

    rows = list(reader)
    if len(rows) > settings.csv_import_max_rows:
        raise ValidationAppError(
            f"CSV has {len(rows)} rows, exceeding the {settings.csv_import_max_rows}-row "
            "import limit. Split the file into smaller batches."
        )

    projects_by_name = {
        p.name.lower(): p
        for p in db.execute(select(Project).where(Project.tenant_id == tenant_id)).scalars()
    }
    users_by_email = {
        u.email.lower(): u
        for u in db.execute(
            select(User).where(User.tenant_id == tenant_id, User.is_active.is_(True))
        ).scalars()
    }
    assigned_project_ids: set[UUID] = set()
    if role_code == "tester":
        assigned_project_ids = set(
            db.execute(
                select(ProjectMember.project_id).where(ProjectMember.user_id == actor_user_id)
            ).scalars()
        )
    valid_severities = {
        o.code for o in field_option_service.list_options(db, tenant_id, "defect_severity")
    }
    valid_priorities = {
        o.code for o in field_option_service.list_options(db, tenant_id, "defect_priority")
    }
    project_member_ids: dict[UUID, set[UUID]] = {}

    def _project_members(project_id: UUID) -> set[UUID]:
        if project_id not in project_member_ids:
            project_member_ids[project_id] = set(
                db.execute(
                    select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
                ).scalars()
            )
        return project_member_ids[project_id]

    module_cache: dict[tuple[UUID, str], UUID] = {}

    def _resolve_module(project_id: UUID, name: str) -> UUID | None:
        if not name:
            return None
        key = (project_id, name)
        if key in module_cache:
            return module_cache[key]
        module = db.execute(
            select(TestModule).where(
                TestModule.tenant_id == tenant_id,
                TestModule.project_id == project_id,
                TestModule.parent_id.is_(None),
                TestModule.name == name,
            )
        ).scalar_one_or_none()
        if module is None:
            module = TestModule(
                tenant_id=tenant_id, project_id=project_id, parent_id=None, name=name
            )
            db.add(module)
            db.flush()
        module_cache[key] = module.id
        return module.id

    error_rows: list[ImportRowResult] = []
    created_count = 0
    total_rows = 0
    defect_rows: list[dict] = []
    link_rows: list[tuple[UUID, list[UUID]]] = []  # (defect id, test case ids)
    # Bug ids already used in this tenant (soft-deleted defects keep theirs).
    taken_ids: set[str] = set()
    if "Bug ID" in extras:
        taken_ids = {
            d
            for d in db.execute(
                select(Defect.display_id)
                .where(Defect.tenant_id == tenant_id, Defect.display_id.is_not(None))
                .execution_options(include_deleted=True)
            ).scalars()
            if d is not None
        }
    case_ids_by_project: dict[UUID, dict[str, UUID]] = {}

    def _case_ids(project_id: UUID) -> dict[str, UUID]:
        if project_id not in case_ids_by_project:
            case_ids_by_project[project_id] = {
                cid: tid
                for cid, tid in db.execute(
                    select(TestCase.display_id, TestCase.id).where(
                        TestCase.tenant_id == tenant_id,
                        TestCase.project_id == project_id,
                        TestCase.display_id.is_not(None),
                    )
                )
            }
        return case_ids_by_project[project_id]

    for row_number, row in enumerate(rows, start=1):
        total_rows += 1
        errors: list[str] = []

        title = (row.get("Title") or "").strip()
        if len(title) < 5:
            errors.append("Title must be at least 5 characters.")

        project_name = (row.get("Project Name") or "").strip()
        project = projects_by_name.get(project_name.lower())
        if project is None:
            errors.append(f"Project '{project_name}' does not exist in this tenant.")
        elif (
            role_code == "tester"
            and project.owner_id != actor_user_id
            and project.id not in assigned_project_ids
        ):
            errors.append(f"You are not assigned to project '{project_name}'.")

        severity = (row.get("Severity") or "").strip()
        if severity not in valid_severities:
            errors.append(
                f"Severity '{severity}' is invalid; must be one of {sorted(valid_severities)}."
            )

        priority = (row.get("Priority") or "").strip()
        if priority not in valid_priorities:
            errors.append(
                f"Priority '{priority}' is invalid; must be one of {sorted(valid_priorities)}."
            )

        description = (row.get("Description") or "").strip()
        if not description:
            errors.append("Description is required.")

        assignee_email = (row.get("Assignee Email") or "").strip()
        assignee: User | None = None
        if assignee_email:
            assignee = users_by_email.get(assignee_email.lower())
            if assignee is None:
                errors.append(f"Assignee email '{assignee_email}' does not match an active user.")
            elif (
                project is not None
                and assignee.id not in _project_members(project.id)
                and assignee.id != project.owner_id
            ):
                errors.append(
                    f"Assignee '{assignee_email}' is not a member of project '{project_name}'."
                )

        steps_text = (row.get("Steps to Reproduce") or "").strip()
        expected_text = (row.get("Expected Result") or "").strip()
        actual_text = (row.get("Actual Result") or "").strip()
        environment_text = (row.get("Environment") or "").strip()
        steps = defect_service.steps_from_text(steps_text)
        if standard_mode:
            # ADR-118: the mandatory fields of a new defect apply to a standard file.
            if not steps:
                errors.append("Steps to Reproduce is required (at least one step).")
            if not expected_text:
                errors.append("Expected Result is required.")
            if not actual_text:
                errors.append("Actual Result is required.")
            if not environment_text:
                errors.append("Environment is required.")
        if len(title) > TITLE_MAX:
            errors.append(f"Title must be at most {TITLE_MAX} characters.")

        labels: list[str] = []
        linked_ids: list[UUID] = []
        root_cause = (row.get("Root Cause") or "").strip()
        bug_id = (row.get("Bug ID") or "").strip()
        if standard_mode:
            try:
                labels = (
                    normalise_labels(
                        [x for x in re.split(r"[;,]", row.get("Labels") or "") if x.strip()]
                    )
                    or []
                )
            except ValueError as exc:
                errors.append(f"Labels: {exc}")
            if root_cause and root_cause not in _ROOT_CAUSES:
                errors.append(
                    f"Root Cause '{root_cause}' is invalid; must be one of {sorted(_ROOT_CAUSES)}."
                )
            if project is not None:
                known = _case_ids(project.id)
                refs = [x.strip() for x in re.split(r"[;,]", row.get("Linked Test Case IDs") or "")]
                for ref in refs:
                    if not ref:
                        continue
                    if ref not in known:
                        errors.append(
                            f"Linked test case '{ref}' does not exist in project '{project_name}'."
                        )
                    elif known[ref] not in linked_ids:
                        linked_ids.append(known[ref])

        if errors:
            error_rows.append(ImportRowResult(row_number=row_number, status="error", errors=errors))
            continue

        assert project is not None

        module_id = _resolve_module(project.id, (row.get("Module") or "").strip())
        repro_rows = defect_service.steps_to_json(steps) if steps else None

        defect_id = uuid4()
        defect_rows.append(
            {
                "id": defect_id,
                "tenant_id": tenant_id,
                "project_id": project.id,
                "title": title,
                "severity": severity,
                "priority": priority,
                "status": "New",
                "description": sanitize_markdown(description),
                "steps_to_reproduce": steps_text or None,
                "repro_steps": repro_rows,
                "expected_result": sanitize_markdown(expected_text) or None,
                "actual_result": sanitize_markdown(actual_text) or None,
                "environment": environment_text or None,
                "module_id": module_id,
                "assigned_to": assignee.id if assignee else None,
                "reported_by": actor_user_id,
                "preconditions": sanitize_markdown(row.get("Preconditions") or "") or None,
                "build_found": clean_plain(row.get("Build Found") or "") or None,
                "fix_version": clean_plain(row.get("Fix Version") or "") or None,
                "labels": labels,
                "root_cause": root_cause or None,
                "root_cause_notes": sanitize_markdown(row.get("Root Cause Notes") or "") or None,
                "test_case_id": linked_ids[0] if linked_ids else None,
                "_requested_bug_id": bug_id,
            }
        )
        if len(linked_ids) > 1:
            link_rows.append((defect_id, linked_ids[1:]))
        created_count += 1

    error_count = len(error_rows)

    if defect_rows:
        # A provided Bug ID is kept only when it is well formed, unused in this tenant and
        # not repeated in the file; every other row is assigned the next id. The counter
        # is moved past the kept ids BEFORE the range for the others is reserved, so an
        # assigned id can never collide with a kept one.
        kept: dict[int, int] = {}
        seen: set[str] = set()
        for index, defect_row in enumerate(defect_rows):
            requested = defect_row.pop("_requested_bug_id")
            match = _BUG_ID_RE.match(requested) if requested else None
            if match and requested not in taken_ids and requested not in seen:
                seen.add(requested)
                kept[index] = int(match.group(1))
                defect_row["display_seq"] = kept[index]
                defect_row["display_id"] = requested
        if kept:
            display_id_service.ensure_counter_above(db, tenant_id, "defect", max(kept.values()))
        missing = [i for i in range(len(defect_rows)) if i not in kept]
        if missing:
            first_seq = display_id_service.reserve_range(db, tenant_id, "defect", len(missing))
            for offset, index in enumerate(missing):
                defect_rows[index]["display_seq"] = first_seq + offset
                defect_rows[index]["display_id"] = display_id_service.format_display_id(
                    "defect", first_seq + offset
                )
        db.execute(insert(Defect), defect_rows)
        if link_rows:
            db.execute(
                insert(DefectLink),
                [
                    {
                        "tenant_id": tenant_id,
                        "defect_id": defect_id,
                        "linkable_type": "test_case",
                        "linkable_id": case_id,
                        "link_type": "relates_to",
                    }
                    for defect_id, case_ids in link_rows
                    for case_id in case_ids
                ],
            )

    batch_id = uuid4()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.bulk_imported",
        entity_type="defect_import_batch",
        entity_id=batch_id,
        metadata={
            "created_count": created_count,
            "error_count": error_count,
            "total_rows": total_rows,
        },
    )
    db.commit()

    return ImportReport(
        total_rows=total_rows,
        created_count=created_count,
        error_count=error_count,
        rows=error_rows,
    )
