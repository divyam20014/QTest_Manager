import csv
import io
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.config import get_settings
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.models.defect import Defect
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_module import TestModule
from app.schemas.csv_import import (
    ColumnDetectionResult,
    DetectedColumn,
    ImportReport,
    ImportRowResult,
)
from app.services import field_option_service
from app.services.project_service import is_assigned
from app.services.test_case_service import _last_execution

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


def _parse_steps(raw: str) -> tuple[list[tuple[str, str]], list[str]]:
    errors: list[str] = []
    steps: list[tuple[str, str]] = []
    if not raw or not raw.strip():
        return steps, ["Steps column is empty; at least one step is required."]

    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = chunk.split("|")
        if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
            errors.append(f"Malformed step '{chunk}' (expected 'Action|Expected').")
            continue
        steps.append((parts[0].strip(), parts[1].strip()))

    if not steps and not errors:
        errors.append("Steps column is empty; at least one step is required.")
    return steps, errors


def import_test_cases(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, csv_text: str
) -> ImportReport:
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames is None or list(reader.fieldnames) != EXPECTED_HEADERS:
        raise ValidationAppError(
            f"CSV headers must be exactly: {', '.join(EXPECTED_HEADERS)}. "
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
TARGET_FIELDS = list(EXPECTED_HEADERS)
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

        module_name = (row.get("Module") or "").strip()
        if not module_name:
            errors.append("Module is required.")
        sub_module_name = (row.get("Sub Module") or "").strip()

        description = (row.get("Description") or "").strip()
        if not description:
            errors.append("Description is required.")

        scenario_id = (row.get("Scenario Id") or "").strip() or None
        scenario_description = (row.get("Scenario Description") or "").strip() or None
        prerequisite = (row.get("Prerequisite") or "").strip() or None
        test_data = (row.get("Test Data") or "").strip() or None

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
            "created_by": actor_user_id,
            "approved_by": actor_user_id if status_internal == "approved" else None,
            "approved_at": datetime.now(UTC) if status_internal == "approved" else None,
        }
        version_rows.append(version_row)

        for i, (action, expected) in enumerate(steps, start=1):
            step_rows.append(
                {
                    "tenant_id": tenant_id,
                    "test_case_version_id": version_id,
                    "step_number": i,
                    "action": action,
                    "expected": expected,
                }
            )

        created_count += 1

    error_count = len(error_rows)

    if case_rows:
        db.execute(insert(TestCase), case_rows)
        db.execute(insert(TestCaseVersion), version_rows)
        db.execute(insert(TestCaseVersionStep), step_rows)

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


def export_test_cases_csv(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> str:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    if role_code == "tester" and not is_assigned(db, project, user_id):
        raise ForbiddenError("You are not assigned to this project")

    cases = db.execute(
        select(TestCase)
        .where(TestCase.tenant_id == tenant_id, TestCase.project_id == project_id)
        .order_by(TestCase.created_at)
    ).scalars()

    users_by_id = {
        u.id: u for u in db.execute(select(User).where(User.tenant_id == tenant_id)).scalars()
    }
    modules_by_id = {
        m.id: m
        for m in db.execute(
            select(TestModule).where(TestModule.tenant_id == tenant_id)
        ).scalars()
    }

    # Pass 3, item 1: Actual_Result/Executed_By/Execution_Date are informational
    # only on export (reflecting real execution history) -- they are never
    # accepted back on import (see _import_test_case_rows/import_test_cases_mapped,
    # neither reads these column names), so an export->reimport round trip
    # correctly drops them rather than trying to "restore" derived data.
    export_headers = [*EXPECTED_HEADERS, "Actual Result", "Executed By", "Execution Date"]

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(export_headers)

    for case in cases:
        version = db.execute(
            select(TestCaseVersion).where(TestCaseVersion.id == case.current_version_id)
        ).scalar_one()
        steps = db.execute(
            select(TestCaseVersionStep)
            .where(TestCaseVersionStep.test_case_version_id == version.id)
            .order_by(TestCaseVersionStep.step_number)
        ).scalars()
        steps_cell = ";".join(f"{s.action}|{s.expected}" for s in steps)
        assignee_email = users_by_id[case.assignee_id].email if case.assignee_id else ""

        module_name = ""
        sub_module_name = ""
        if case.module_id is not None:
            module = modules_by_id.get(case.module_id)
            if module is not None:
                if module.parent_id is None:
                    module_name = module.name
                else:
                    sub_module_name = module.name
                    parent = modules_by_id.get(module.parent_id)
                    module_name = parent.name if parent is not None else ""

        last_result, last_executed_by_name, last_execution_date = _last_execution(
            db, tenant_id, case.id
        )

        writer.writerow(
            [
                case.title,
                module_name,
                sub_module_name,
                project.name,
                case.priority,
                STATUS_DISPLAY.get(case.status, case.status),
                version.description,
                version.scenario_id or "",
                version.scenario_description or "",
                version.prerequisite or "",
                version.test_data or "",
                assignee_email,
                steps_cell,
                last_result or "",
                last_executed_by_name or "",
                last_execution_date.isoformat() if last_execution_date else "",
            ]
        )

    return buffer.getvalue()


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


def import_defects(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, csv_text: str
) -> ImportReport:
    reader = csv.DictReader(io.StringIO(csv_text))
    if reader.fieldnames is None or list(reader.fieldnames) != DEFECT_EXPECTED_HEADERS:
        raise ValidationAppError(
            f"CSV headers must be exactly: {', '.join(DEFECT_EXPECTED_HEADERS)}. "
            f"Download /defects/import/template.csv for a valid example."
        )

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
            elif project is not None and assignee.id not in _project_members(
                project.id
            ) and assignee.id != project.owner_id:
                errors.append(
                    f"Assignee '{assignee_email}' is not a member of project '{project_name}'."
                )

        if errors:
            error_rows.append(ImportRowResult(row_number=row_number, status="error", errors=errors))
            continue

        assert project is not None

        module_id = _resolve_module(project.id, (row.get("Module") or "").strip())

        defect_rows.append(
            {
                "id": uuid4(),
                "tenant_id": tenant_id,
                "project_id": project.id,
                "title": title,
                "severity": severity,
                "priority": priority,
                "status": "New",
                "description": description,
                "steps_to_reproduce": (row.get("Steps to Reproduce") or "").strip() or None,
                "expected_result": (row.get("Expected Result") or "").strip() or None,
                "actual_result": (row.get("Actual Result") or "").strip() or None,
                "environment": (row.get("Environment") or "").strip() or None,
                "module_id": module_id,
                "assigned_to": assignee.id if assignee else None,
                "reported_by": actor_user_id,
            }
        )
        created_count += 1

    error_count = len(error_rows)

    if defect_rows:
        db.execute(insert(Defect), defect_rows)

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
