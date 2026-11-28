"""ADR-143: what a person may do on a project.

A project role (`project_members.role_id`), when set, replaces the organization role for
everything that belongs to that project: both the permission codes and the access tier
(`admin` / `manager` / `tester`) that service rules look at. Organization permissions are
never changed by it. An organization Admin is never restricted.

The decision is made once, when the request's context is built, from the project the
request is about. So route checks and service checks read the same answer.
"""

from collections.abc import Iterable, Mapping
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError
from app.models.identity import Permission, Role, RolePermission
from app.models.project import ProjectMember

SYSTEM_TIERS = ("admin", "manager", "tester")

# Permissions about the organization. A project role neither gives nor takes them.
ORGANIZATION_PERMISSIONS = frozenset(
    {
        "access_rule.manage",
        "audit.view",
        "field_customization.manage",
        "integration.manage",
        "project.create",
        "report.schedule_manage",
        "sso.manage",
        "task_status.manage",
        "tenant.settings.manage",
        "user.erase",
        "user.manage",
    }
)


def tier_of(role_code: str | None, permissions: Iterable[str]) -> str:
    """The access tier of a role: its own code if it is one of the three tiers, otherwise
    Manager when it may see every project, else Tester (ADR-059)."""
    if role_code in SYSTEM_TIERS:
        return role_code
    return "manager" if "project.view.all" in set(permissions) else "tester"


def permissions_of_role(db: Session, role_id: UUID) -> set[str]:
    return set(
        db.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role_id)
        )
        .scalars()
        .all()
    )


def access_for_project(
    db: Session,
    user_id: UUID,
    org_tier: str,
    org_permissions: set[str],
    project_id: UUID,
) -> tuple[str, set[str]]:
    """(access tier, permission codes) of this user for records of this project."""
    if org_tier == "admin":
        return org_tier, org_permissions
    row = db.execute(
        select(Role.id, Role.code)
        .join(ProjectMember, ProjectMember.role_id == Role.id)
        .where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    ).first()
    if row is None:
        return org_tier, org_permissions
    granted = permissions_of_role(db, row.id)
    permissions = (granted - ORGANIZATION_PERMISSIONS) | (
        org_permissions & ORGANIZATION_PERMISSIONS
    )
    tier = tier_of(row.code, granted)
    # A project role never makes anyone an Admin: that tier skips checks organization-wide.
    return ("manager" if tier == "admin" else tier), permissions


# --- which project is a request about? -------------------------------------------------------

_BY_RUN_CASE = (
    "select r.project_id from test_run_cases c join test_runs r on r.id = c.test_run_id "
    "where c.id = :id"
)
_BY_STEP = (
    "select r.project_id from execution_steps e "
    "join test_run_cases c on c.id = e.test_run_case_id "
    "join test_runs r on r.id = c.test_run_id where e.id = :id"
)


def _own(table: str) -> str:
    return f"select project_id from {table} where id = :id"


# Path parameter -> how to find the project of the record it names. Every path parameter of
# every route is here or in `NOT_PROJECT_PARAMETERS`; a test enforces that.
PROJECT_PARAMETERS: dict[str, str | None] = {
    "project_id": None,  # the value itself
    "build_id": _own("builds"),
    "defect_id": _own("defects"),
    "depends_on_task_id": _own("tasks"),
    "milestone_id": _own("milestones"),
    "module_id": _own("test_modules"),
    "release_id": _own("releases"),
    "requirement_id": _own("requirements"),
    "run_id": _own("test_runs"),
    "shared_step_id": _own("shared_steps"),
    "sprint_id": _own("sprints"),
    "suite_id": _own("test_suites"),
    "plan_id": _own("test_plans"),
    "task_id": _own("tasks"),
    "test_case_id": _own("test_cases"),
    "test_run_case_id": _BY_RUN_CASE,
    "execution_step_id": _BY_STEP,
    "data_set_id": (
        "select c.project_id from test_data_sets s join test_cases c on c.id = s.test_case_id "
        "where s.id = :id"
    ),
    "row_id": (
        "select c.project_id from test_data_set_rows w "
        "join test_data_sets s on s.id = w.test_data_set_id "
        "join test_cases c on c.id = s.test_case_id where w.id = :id"
    ),
    # Comments and attachments name their owner; see `_owner_project`.
    "attachment_id": None,
    "comment_id": None,
    "owner_id": None,
}

NOT_PROJECT_PARAMETERS: dict[str, str] = {
    "owner_type": "says what owner_id is",
    "link_id": "only appears under the record it links, which names the project",
    "dashboard_id": "personal and team dashboards",
    "definition_id": "organization-wide custom field",
    "environment_id": "organization-wide",
    "job_id": "background job of the organization",
    "notification_id": "the user's own",
    "option_id": "organization-wide field option",
    "report_id": "saved report; its own sharing rules",
    "role_id": "organization role",
    "rule_id": "organization access rule",
    "schedule_id": "organization report schedule",
    "session_id": "the user's own session",
    "status_id": "organization task status",
    "team_id": "organization team",
    "tenant_id": "an organization",
    "token": "invitation token",
    "token_id": "organization integration token",
    "user_id": "a person",
    "view_id": "the user's saved view",
}

_OWNER_PARAMETER = {
    "test_case": "test_case_id",
    "defect": "defect_id",
    "requirement": "requirement_id",
    "task": "task_id",
    "execution_step": "execution_step_id",
}


def _uuid(value: object) -> UUID | None:
    try:
        return UUID(str(value))
    except ValueError:
        return None


def _owner_project(db: Session, owner_type: str, owner_id: UUID) -> UUID | None:
    parameter = _OWNER_PARAMETER.get(owner_type)
    return _project_by(db, parameter, owner_id) if parameter else None


def _project_by(db: Session, parameter: str, value: UUID) -> UUID | None:
    if parameter == "project_id":
        return value
    if parameter in ("attachment_id", "comment_id"):
        table = "attachments" if parameter == "attachment_id" else "comments"
        owner = db.execute(
            text(f"select owner_type, owner_id from {table} where id = :id"), {"id": value}
        ).first()
        return _owner_project(db, owner.owner_type, owner.owner_id) if owner else None
    query = PROJECT_PARAMETERS[parameter]
    assert query is not None, parameter
    return db.execute(text(query), {"id": value}).scalar_one_or_none()


def projects_of_request(
    db: Session, method: str, path_params: Mapping[str, object], query_project: str | None
) -> set[UUID]:
    """The projects the request is about. Empty when it names none.

    A `?project_id=` counts only for reads, and only when the path names no project:
    otherwise it could be used to act under another project's role."""
    found: set[UUID] = set()
    for parameter, raw in path_params.items():
        if parameter not in PROJECT_PARAMETERS:
            continue
        value = _uuid(raw)
        if value is None:  # the route's own validation answers 422
            continue
        if parameter == "owner_id":
            project = _owner_project(db, str(path_params.get("owner_type")), value)
        else:
            project = _project_by(db, parameter, value)
        if project is not None:
            found.add(project)
    if not found and method == "GET" and query_project is not None:
        value = _uuid(query_project)
        if value is not None:
            found.add(value)
    return found


def access_for_request(
    db: Session,
    user_id: UUID,
    org_tier: str,
    org_permissions: set[str],
    projects: set[UUID],
) -> tuple[str, set[str]]:
    if org_tier == "admin" or not projects:
        return org_tier, org_permissions
    answers = [access_for_project(db, user_id, org_tier, org_permissions, p) for p in projects]
    first = answers[0]
    if any(answer != first for answer in answers[1:]):
        # Records of two projects where this user's access differs: neither role may be
        # used for the other's record.
        raise ForbiddenError("Your role differs between the projects of these records")
    return first
