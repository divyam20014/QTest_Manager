import csv
import io
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.models.identity import User
from app.models.project import Project, ProjectMember
from app.models.test_case import TestCase, TestCaseVersion, TestCaseVersionStep
from app.schemas.csv_import import ImportReport, ImportRowResult
from app.services.project_service import is_assigned

EXPECTED_HEADERS = ["Title", "Project Name", "Priority", "Status", "Assignee Email", "Steps"]

VALID_PRIORITIES = {"Low", "Medium", "High", "Critical"}
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
    "Title,Project Name,Priority,Status,Assignee Email,Steps\n"
    '"Verify Total Loss Settlement Calculation","Apex Motor Claims Modernization",'
    '"Critical","Draft","tester@example.com",'
    '"Input Policy Number with Comprehensive Endorsement|System displays vehicle ACV;'
    'Apply $500 deductible|Payout amount equals ACV minus $500"\n'
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
            f"Download /test-cases/import/template.csv for a valid example."
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

    error_rows: list[ImportRowResult] = []
    created_count = 0
    total_rows = 0
    case_rows: list[dict] = []
    version_rows: list[dict] = []
    step_rows: list[dict] = []

    for row_number, row in enumerate(reader, start=1):
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

        priority = (row.get("Priority") or "").strip()
        if priority not in VALID_PRIORITIES:
            errors.append(
                f"Priority '{priority}' is invalid; must be one of {sorted(VALID_PRIORITIES)}."
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
                "created_by": actor_user_id,
            }
        )

        version_row = {
            "id": version_id,
            "tenant_id": tenant_id,
            "test_case_id": case_id,
            "version_number": 1,
            "title": title,
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

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPECTED_HEADERS)

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

        writer.writerow(
            [
                case.title,
                project.name,
                case.priority,
                STATUS_DISPLAY.get(case.status, case.status),
                assignee_email,
                steps_cell,
            ]
        )

    return buffer.getvalue()
