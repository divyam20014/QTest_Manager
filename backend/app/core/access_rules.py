"""RBAC Phase 4 (ADR-092): time and environment access rules.

`evaluate` is a pure, clock-injected function (unit-testable without a DB).
`enforce` loads the tenant's enabled rules (one indexed query) and applies
`evaluate`; it is wired into the existing policy registry as the
"access_rules" ctx rule (app.core.policy) and called from the
`require_*permission` dependencies for mutating requests only.

Off by default: a tenant with no enabled rules is never affected.
"""

from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AccessRuleBlockedError
from app.models.access_rule import AccessRule

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# Never blockable, so an admin can always lift a freeze they created.
NEVER_BLOCKED_CODES = frozenset({"access_rule.manage"})

# path-param name -> how to resolve the owning project_id for project scoping
_PROJECT_RESOLVERS = ("project_id", "test_case_id", "defect_id", "run_id", "test_run_case_id")


def action_matches(code: str, blocked_actions: Iterable[str]) -> bool:
    """A blocked entry is an exact permission code or a dotted prefix
    (`testrun` matches `testrun.create`, `testrun.finish`, ...)."""
    return any(code == p or code.startswith(p + ".") for p in blocked_actions)


def is_window_active(rule: Any, now: datetime) -> bool:
    if rule.starts_at is not None and now < rule.starts_at:
        return False
    return not (rule.ends_at is not None and now >= rule.ends_at)


def rule_is_restricting(rule: Any, now: datetime) -> bool:
    """freeze_window: blocking while inside [starts_at, ends_at).
    environment_restriction: blocking unless inside the optional allowed window."""
    if rule.rule_type == "freeze_window":
        return is_window_active(rule, now)
    if rule.starts_at is None and rule.ends_at is None:
        return True
    return not is_window_active(rule, now)


def evaluate(
    rules: Iterable[Any],
    *,
    action_code: str,
    now: datetime,
    role_code: str,
    project_id: UUID | None = None,
    environment: str | None = None,
) -> Any | None:
    """Returns the first rule that blocks this action, else None."""
    if action_code in NEVER_BLOCKED_CODES or role_code == "admin":
        return None
    for rule in rules:
        if not rule.enabled or role_code in rule.exempt_roles:
            continue
        if rule.project_id is not None and rule.project_id != project_id:
            continue
        if not action_matches(action_code, rule.blocked_actions):
            continue
        if rule.rule_type == "environment_restriction" and (
            environment is None
            or rule.environment is None
            or environment.strip().lower() != rule.environment.strip().lower()
        ):
            continue
        if rule_is_restricting(rule, now):
            return rule
    return None


def load_enabled_rules(db: Session, tenant_id: UUID, now: datetime) -> list[AccessRule]:
    return list(
        db.execute(
            select(AccessRule).where(
                AccessRule.tenant_id == tenant_id,
                AccessRule.enabled.is_(True),
                (AccessRule.ends_at.is_(None))
                | (AccessRule.ends_at > now)
                | (AccessRule.rule_type == "environment_restriction"),
            )
        )
        .scalars()
        .all()
    )


def _resolve_project(db: Session, tenant_id: UUID, path_params: dict[str, Any]) -> UUID | None:
    from app.models.defect import Defect
    from app.models.execution import TestRun, TestRunCase
    from app.models.test_case import TestCase

    def _uuid(v: Any) -> UUID | None:
        try:
            return UUID(str(v))
        except ValueError:
            return None

    for key in _PROJECT_RESOLVERS:
        raw = path_params.get(key)
        rid = _uuid(raw) if raw is not None else None
        if rid is None:
            continue
        if key == "project_id":
            return rid
        if key == "test_case_id":
            stmt = select(TestCase.project_id).where(
                TestCase.tenant_id == tenant_id, TestCase.id == rid
            )
        elif key == "defect_id":
            stmt = select(Defect.project_id).where(Defect.tenant_id == tenant_id, Defect.id == rid)
        elif key == "run_id":
            stmt = select(TestRun.project_id).where(
                TestRun.tenant_id == tenant_id, TestRun.id == rid
            )
        else:
            stmt = (
                select(TestRun.project_id)
                .join(TestRunCase, TestRunCase.test_run_id == TestRun.id)
                .where(TestRunCase.tenant_id == tenant_id, TestRunCase.id == rid)
            )
        return db.execute(stmt).scalar_one_or_none()
    return None


def enforce(
    db: Session,
    *,
    tenant_id: UUID,
    role_code: str,
    action_code: str,
    method: str,
    path_params: dict[str, Any] | None = None,
    project_id: UUID | None = None,
    environment: str | None = None,
    now: datetime | None = None,
) -> None:
    """Raises AccessRuleBlockedError if an active rule blocks the action."""
    if method.upper() in SAFE_METHODS or role_code == "admin":
        return
    if action_code in NEVER_BLOCKED_CODES:
        return
    now = now or datetime.now(UTC)
    rules = load_enabled_rules(db, tenant_id, now)
    if not rules:
        return
    if project_id is None and any(r.project_id is not None for r in rules):
        project_id = _resolve_project(db, tenant_id, path_params or {})
    hit = evaluate(
        rules,
        action_code=action_code,
        now=now,
        role_code=role_code,
        project_id=project_id,
        environment=environment,
    )
    if hit is not None:
        raise AccessRuleBlockedError(hit.reason)


def enforce_environment(
    db: Session,
    *,
    tenant_id: UUID,
    role_code: str,
    action_code: str,
    project_id: UUID,
    environment: str | None,
) -> None:
    """Service-layer hook for actions that carry an environment (defect
    create / set-environment): the route-level hook cannot see the body."""
    if not environment:
        return
    enforce(
        db,
        tenant_id=tenant_id,
        role_code=role_code,
        action_code=action_code,
        method="POST",
        project_id=project_id,
        environment=environment,
    )
