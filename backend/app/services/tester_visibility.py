"""ADR-093: per-tenant Tester visibility switches (both OFF by default).

This is the ONE place the Tester test-case filter lives. Every service path
that exposes a test case (list, detail, search, counts, coverage, exports)
calls into here, so a new read path has a single thing to reuse.

"Assigned to the Tester" means any of:
  * `test_cases.assignee_id` is the user, or
  * a `test_run_cases` row for the case has `assigned_to` = the user, or
  * the case is in a (non-deleted) run whose `executed_by` is the user.

Only the Tester access tier is affected (`role_code == "tester"`, which also
covers custom roles mapped to the tester tier -- ADR-059). A project-role
override that grants `project.view.all` exempts that project.
"""

from uuid import UUID

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError, NotFoundError
from app.models.execution import TestRun, TestRunCase
from app.models.identity import Permission, RolePermission
from app.models.project import ProjectMember
from app.models.tenant import Tenant
from app.models.test_case import TestCase


def _tenant_flag(db: Session, tenant_id: UUID, column) -> bool:
    return bool(db.execute(select(column).where(Tenant.id == tenant_id)).scalar_one_or_none())


def case_scope_active(db: Session, tenant_id: UUID, role_code: str) -> bool:
    if role_code != "tester":
        return False
    return _tenant_flag(db, tenant_id, Tenant.testers_see_assigned_cases_only)


def reports_hidden(db: Session, tenant_id: UUID, role_code: str) -> bool:
    if role_code != "tester":
        return False
    return _tenant_flag(db, tenant_id, Tenant.reports_hidden_from_testers)


def require_reports_visible(db: Session, tenant_id: UUID, role_code: str) -> None:
    if reports_hidden(db, tenant_id, role_code):
        raise ForbiddenError("Reports are not available to your role in this workspace")


def case_visibility_clause(user_id: UUID):
    """SQL clause over `TestCase` selecting the cases a scoped Tester may see."""
    run_assigned = select(TestRunCase.test_case_id).where(TestRunCase.assigned_to == user_id)
    run_owned = (
        select(TestRunCase.test_case_id)
        .join(TestRun, TestRun.id == TestRunCase.test_run_id)
        .where(TestRun.executed_by == user_id, TestRun.deleted_at.is_(None))
    )
    exempt_projects = (
        select(ProjectMember.project_id)
        .join(RolePermission, RolePermission.role_id == ProjectMember.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(ProjectMember.user_id == user_id, Permission.code == "project.view.all")
    )
    return or_(
        TestCase.assignee_id == user_id,
        TestCase.id.in_(run_assigned),
        TestCase.id.in_(run_owned),
        TestCase.project_id.in_(exempt_projects),
    )


def scope_case_query(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, query: Select
) -> Select:
    """Restrict a `select(...)` that has `TestCase` in its FROM list."""
    if case_scope_active(db, tenant_id, role_code):
        return query.where(case_visibility_clause(user_id))
    return query


def assert_case_visible(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, case_id: UUID
) -> None:
    """404 (never 403) for a case outside the Tester's scope."""
    if not case_scope_active(db, tenant_id, role_code):
        return
    ok = db.execute(
        select(func.count()).where(and_(TestCase.id == case_id, case_visibility_clause(user_id)))
    ).scalar_one()
    if not ok:
        raise NotFoundError("Test case not found")


def visible_case_ids(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, case_ids: list[UUID]
) -> set[UUID] | None:
    """Subset of `case_ids` the caller may see; None means 'no restriction'."""
    if not case_scope_active(db, tenant_id, role_code):
        return None
    rows = db.execute(
        select(TestCase.id).where(TestCase.id.in_(case_ids), case_visibility_clause(user_id))
    ).scalars()
    return set(rows)
