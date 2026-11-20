"""RBAC Phase 4 (ADR-092): CRUD + evaluation entry points for tenant access
rules. Enforcement itself lives in app.core.access_rules / app.core.policy."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access_rules
from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError, ValidationAppError
from app.models.access_rule import AccessRule
from app.models.identity import Permission
from app.models.project import Project
from app.schemas.access_rule import (
    AccessRuleCreateRequest,
    AccessRulePreviewRequest,
    AccessRuleUpdateRequest,
)

VALID_ROLES = ("admin", "manager", "tester")


def _utc(value: datetime | None, field: str) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise ValidationAppError(f"{field} must include a timezone (send UTC, e.g. ...Z)")
    return value.astimezone(UTC)


def validate_blocked_actions(db: Session, blocked_actions: list[str]) -> list[str]:
    codes = list(db.execute(select(Permission.code)).scalars().all())
    cleaned: list[str] = []
    for raw in blocked_actions:
        entry = raw.strip().lower()
        if not entry or any(c in entry for c in " *%"):
            raise ValidationAppError(f"Invalid blocked action '{raw}'")
        if access_rules.action_matches("access_rule.manage", [entry]):
            raise ValidationAppError(
                "Access rules can never block access_rule.manage (an Admin must always be "
                "able to lift a rule)"
            )
        if not any(access_rules.action_matches(c, [entry]) for c in codes):
            raise ValidationAppError(
                f"Unknown action '{raw}': use a permission code or prefix such as "
                "'testrun', 'testcase.edit', 'defect.create'"
            )
        if entry not in cleaned:
            cleaned.append(entry)
    return cleaned


def _normalise_roles(roles: list[str]) -> list[str]:
    cleaned = {r.strip().lower() for r in roles}
    bad = cleaned - set(VALID_ROLES)
    if bad:
        raise ValidationAppError(f"Unknown role(s): {', '.join(sorted(bad))}")
    cleaned.add("admin")  # Admin is always exempt: never lock the tenant out
    return [r for r in VALID_ROLES if r in cleaned]


def _validate_shape(db: Session, tenant_id: UUID, rule: AccessRule) -> None:
    if rule.rule_type == "freeze_window":
        if rule.starts_at is None or rule.ends_at is None:
            raise ValidationAppError("A freeze window needs both a start and an end time")
        if rule.ends_at <= rule.starts_at:
            raise ValidationAppError("The end time must be after the start time")
        rule.environment = None
    else:
        if not rule.environment or not rule.environment.strip():
            raise ValidationAppError("An environment restriction needs an environment name")
        rule.environment = rule.environment.strip()
        if (rule.starts_at is None) != (rule.ends_at is None):
            raise ValidationAppError(
                "Set both ends of the allowed window, or neither (always restricted)"
            )
        if rule.starts_at and rule.ends_at and rule.ends_at <= rule.starts_at:
            raise ValidationAppError("The end time must be after the start time")
    if rule.project_id is not None:
        exists = db.execute(
            select(Project.id).where(Project.tenant_id == tenant_id, Project.id == rule.project_id)
        ).scalar_one_or_none()
        if exists is None:
            raise NotFoundError("Project not found")


def _scope(rule: AccessRule) -> str:
    return "tenant" if rule.project_id is None else "project"


def _get(db: Session, tenant_id: UUID, rule_id: UUID) -> AccessRule:
    rule = db.execute(
        select(AccessRule).where(AccessRule.tenant_id == tenant_id, AccessRule.id == rule_id)
    ).scalar_one_or_none()
    if rule is None:
        raise NotFoundError("Access rule not found")
    return rule


def list_rules(db: Session, tenant_id: UUID) -> list[AccessRule]:
    set_tenant_context(db, str(tenant_id))
    return list(
        db.execute(
            select(AccessRule)
            .where(AccessRule.tenant_id == tenant_id)
            .order_by(AccessRule.created_at.desc(), AccessRule.id)
        )
        .scalars()
        .all()
    )


def get_rule(db: Session, tenant_id: UUID, rule_id: UUID) -> AccessRule:
    set_tenant_context(db, str(tenant_id))
    return _get(db, tenant_id, rule_id)


def create_rule(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: AccessRuleCreateRequest
) -> AccessRule:
    set_tenant_context(db, str(tenant_id))
    rule = AccessRule(
        tenant_id=tenant_id,
        name=req.name.strip(),
        enabled=req.enabled,
        rule_type=req.rule_type,
        project_id=req.project_id,
        environment=req.environment,
        starts_at=_utc(req.starts_at, "starts_at"),
        ends_at=_utc(req.ends_at, "ends_at"),
        blocked_actions=validate_blocked_actions(db, req.blocked_actions),
        exempt_roles=_normalise_roles(req.exempt_roles),
        reason=req.reason.strip(),
        created_by=actor_user_id,
    )
    _validate_shape(db, tenant_id, rule)
    db.add(rule)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="access_rule.created",
        entity_type="access_rule",
        entity_id=rule.id,
        metadata={
            "name": rule.name,
            "rule_type": rule.rule_type,
            "scope": _scope(rule),
            "enabled": rule.enabled,
        },
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))  # the commit cleared the RLS setting
    db.refresh(rule)
    return rule


def update_rule(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    rule_id: UUID,
    req: AccessRuleUpdateRequest,
) -> AccessRule:
    set_tenant_context(db, str(tenant_id))
    rule = _get(db, tenant_id, rule_id)
    changes = req.model_dump(exclude_unset=True)
    was_enabled = rule.enabled
    if changes.get("name") is not None:
        rule.name = changes["name"].strip()
    if changes.get("enabled") is not None:
        rule.enabled = changes["enabled"]
    if "project_id" in changes:
        rule.project_id = changes["project_id"]
    if "environment" in changes:
        rule.environment = changes["environment"]
    if "starts_at" in changes:
        rule.starts_at = _utc(changes["starts_at"], "starts_at")
    if "ends_at" in changes:
        rule.ends_at = _utc(changes["ends_at"], "ends_at")
    if changes.get("blocked_actions") is not None:
        rule.blocked_actions = validate_blocked_actions(db, changes["blocked_actions"])
    if changes.get("exempt_roles") is not None:
        rule.exempt_roles = _normalise_roles(changes["exempt_roles"])
    if changes.get("reason") is not None:
        rule.reason = changes["reason"].strip()
    _validate_shape(db, tenant_id, rule)
    db.flush()

    if "enabled" in changes and changes["enabled"] != was_enabled:
        action = "access_rule.enabled" if rule.enabled else "access_rule.disabled"
    else:
        action = "access_rule.updated"
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action=action,
        entity_type="access_rule",
        entity_id=rule.id,
        metadata={
            "name": rule.name,
            "rule_type": rule.rule_type,
            "scope": _scope(rule),
            "changed_fields": sorted(changes.keys()),
        },
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))  # the commit cleared the RLS setting
    db.refresh(rule)
    return rule


def delete_rule(db: Session, tenant_id: UUID, actor_user_id: UUID, rule_id: UUID) -> None:
    set_tenant_context(db, str(tenant_id))
    rule = _get(db, tenant_id, rule_id)
    meta = {"name": rule.name, "rule_type": rule.rule_type, "scope": _scope(rule)}
    db.delete(rule)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="access_rule.deleted",
        entity_type="access_rule",
        entity_id=rule_id,
        metadata=meta,
    )
    db.commit()


def active_rules_for_role(
    db: Session, tenant_id: UUID, role_code: str, now: datetime | None = None
) -> list[AccessRule]:
    """Rules currently restricting this role (for UI banners)."""
    set_tenant_context(db, str(tenant_id))
    now = now or datetime.now(UTC)
    if role_code == "admin":
        return []
    return [
        r
        for r in access_rules.load_enabled_rules(db, tenant_id, now)
        if role_code not in r.exempt_roles and access_rules.rule_is_restricting(r, now)
    ]


def preview(db: Session, tenant_id: UUID, req: AccessRulePreviewRequest) -> AccessRule | None:
    set_tenant_context(db, str(tenant_id))
    at = _utc(req.at, "at") or datetime.now(UTC)
    rules = access_rules.load_enabled_rules(db, tenant_id, at)
    return access_rules.evaluate(
        rules,
        action_code=req.action_code,
        now=at,
        role_code=req.role_code,
        project_id=req.project_id,
        environment=req.environment,
    )
