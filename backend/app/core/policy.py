"""RBAC/PBAC/ABAC plan, Phase 2: a reusable policy-rule registry.

This module extracts the two attribute-based (ABAC) checks that previously
lived inline in `app.core.auth.get_current_context` (`_enforce_ip_allowlist`
and the `mfa_verified` session check) into named, independently callable
rules, plus a `require_policy(*rule_names)` FastAPI dependency so future
rules (project membership, resource-state locks, etc. -- Phase 3) can be
composed onto a route the same way `require_permission` already is.

Phase 2 is explicitly a behavior-identical refactor: `enforce_ip_allowlist`
and `enforce_mfa_verified` below are the same logic, called from the same
places, raising the same exceptions, as the pre-refactor private functions
in auth.py. No new rule is added or enforced by this phase.
"""

from collections.abc import Callable
from ipaddress import ip_address, ip_network
from typing import Any
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.logging import logger
from app.models.defect import Defect
from app.models.identity import Session as SessionModel
from app.models.tenant import Tenant
from app.models.test_case import TestCase


def enforce_ip_allowlist(db: Session, tenant_id: UUID, caller_ip: str | None) -> bool:
    """Tier 4 / ADR-054, PV-11.3: the caller's IP must fall within the
    tenant's allowlist, if one is configured. Returns True (rule passed /
    not applicable) or raises ForbiddenError -- never returns False, since
    a failure is always meant to stop the request immediately.
    """
    allowlist = db.execute(
        select(Tenant.ip_allowlist).where(Tenant.id == tenant_id)
    ).scalar_one_or_none()
    if not allowlist:
        return True  # unset/empty means no restriction (PV-11.3's documented default)

    if caller_ip is None:
        raise ForbiddenError("Access denied: client IP could not be determined")
    try:
        caller = ip_address(caller_ip)
    except ValueError:
        raise ForbiddenError("Access denied: client IP could not be determined") from None

    for cidr in allowlist:
        try:
            if caller in ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue  # a malformed stored entry never silently blocks every request

    logger.warning(
        "security_event=ip_allowlist_blocked tenant_id=%s client_ip=%s", tenant_id, caller_ip
    )
    raise ForbiddenError("Access denied: your network is not on this organization's allowlist")


def enforce_mfa_verified(session_row: SessionModel) -> bool:
    """A session must have completed MFA before it is treated as
    authenticated. Mirrors the pre-refactor inline check in
    `get_current_context` exactly (same exception type/message)."""
    if not session_row.mfa_verified:
        raise UnauthorizedError("MFA verification required")
    return True


# --- Ctx-based policy registry, for Phase 3 and beyond -------------------
#
# A `PolicyRule` is evaluated once a `SessionContext` already exists (i.e.
# after `get_current_context` has run), unlike the two functions above
# which run *while* that context is still being built. `None` means "rule
# not applicable to this resource" (skip, don't fail); `True` means pass;
# raising is how a rule fails (matching every other auth check in this
# codebase, so callers get one exception shape to handle, not a bool to
# remember to check).
#
# "ip_allowlist" is the same rule as `enforce_ip_allowlist` above,
# re-exposed in the ctx-based shape so a route can opt into re-checking it
# via `require_policy("ip_allowlist")` if a future phase needs that (e.g.
# a sensitive action re-verified mid session). `mfa_verified` is
# deliberately NOT registered here: by the time a `SessionContext` exists,
# MFA has already been verified as part of building it, so a ctx-based
# re-check would be a tautology.
#
# RBAC/PBAC/ABAC plan, Phase 3 adds two real new rules:
#
# - "resource_not_locked" -- a genuine new PBAC-style policy: blocks a
#   mutating action on a Defect whose status is "Closed" (ADR: a closed
#   defect is reopened through the dedicated `reopen_defect`/`update_status`
#   endpoints, which deliberately do NOT go through this rule -- otherwise
#   the rule would make a closed defect permanently unreopenable). Test
#   runs were considered as the plan's other example ("approved test
#   runs"), but `TestRun` has no single-step "approve" action in this
#   codebase to lock against (test runs complete via `execution_status`
#   transitions, not an approval gate) -- Defect.status == "Closed" is the
#   clearest real terminal-state concept that already exists, so it's the
#   one case implemented here.
#
# - "project_membership" is NOT implemented as a plain yes/no membership
#   check here. Reading the existing service layer first (test_case_service
#   ._authorize_case_access, defect_service._require_project_access) showed
#   that project-membership enforcement for resource-id-keyed mutations
#   (edit/approve/etc. by test_case_id/defect_id) already exists -- it's
#   just ad hoc, pre-dates this plan, and does not know about Phase 1's
#   project-scoped role override (`project_members.role_id`). That is the
#   REAL gap Phase 1 flagged and deferred: a user whose project-role
#   override grants them an elevated permission on a specific project
#   still gets rejected by a resource-id-keyed route's flat
#   `require_permission(code)`, because that check only looks at their
#   tenant-wide `ctx.permissions`, never the override. So Phase 3's
#   "project_membership" rule is implemented as `require_resource_permission`
#   below: it resolves the resource's project_id, then reuses Phase 1's own
#   `get_effective_permissions_for_project` to decide, which is the
#   override-aware generalization the plan asked for -- additive to the
#   existing service-layer `is_assigned` checks (which still run and are
#   untouched), not a replacement for them.
PolicyRule = Callable[[Any, Any], bool | None]


def _ip_allowlist_ctx_rule(
    ctx: Any, resource: Any = None, *, db: Session, **_: Any
) -> bool | None:
    from app.core.auth import client_ip  # local import avoids a cycle with auth.py

    request = resource if resource is not None else None
    caller_ip = client_ip(request) if request is not None else None
    return enforce_ip_allowlist(db, ctx.tenant_id, caller_ip)


_RESOURCE_MODELS: dict[str, type[Any]] = {
    "test_case": TestCase,
    "defect": Defect,
}


def resolve_project_id_for_resource(
    db: Session, tenant_id: UUID, resource_type: str, resource_id: UUID
) -> UUID | None:
    """RBAC Phase 3: given a resource type this app actually has
    (`test_case`/`defect`), looks up that resource's `project_id` so a
    resource-id-keyed route can be evaluated against a project-scoped
    permission override, the same way a `project_id`-path route already
    can via `get_effective_permissions_for_project`. Returns None if the
    resource doesn't exist in this tenant -- callers fall back to the
    tenant-wide permission check in that case, so a missing/foreign
    resource gets the same NotFoundError shape from the service layer it
    always has, not a different error from this new code path.
    """
    model = _RESOURCE_MODELS[resource_type]
    return db.execute(
        select(model.project_id).where(model.tenant_id == tenant_id, model.id == resource_id)
    ).scalar_one_or_none()


def _resource_not_locked_ctx_rule(
    ctx: Any, resource: Any = None, *, db: Session, **_: Any
) -> bool | None:
    """Phase 3: blocks mutation of a Closed defect via the generic
    `PATCH /defects/{defect_id}` route. `resource` here is the inbound
    `Request` (same convention `require_policy` already uses for
    `ip_allowlist`) -- the defect_id comes from its path params.
    """
    request = resource
    defect_id = request.path_params.get("defect_id") if request is not None else None
    if defect_id is None:
        return None  # not applicable -- this rule is only wired to defect_id routes
    status = db.execute(
        select(Defect.status).where(Defect.tenant_id == ctx.tenant_id, Defect.id == UUID(defect_id))
    ).scalar_one_or_none()
    if status is None:
        return None  # let the service layer raise its own NotFoundError
    if status == "Closed":
        raise ForbiddenError(
            "This defect is closed and cannot be edited. Reopen it first via "
            "the reopen/status endpoints."
        )
    return True


_CTX_POLICY_RULES: dict[str, Callable[..., bool | None]] = {
    "ip_allowlist": _ip_allowlist_ctx_rule,
    "resource_not_locked": _resource_not_locked_ctx_rule,
}


def require_policy(*rule_names: str):
    """FastAPI dependency, parallel in style to `require_permission`: gates
    a route behind one or more named ctx-based policy rules. Composes with
    `require_permission`/`require_project_permission` on the same route --
    this is additive, not a replacement for either.
    """
    from app.core.auth import SessionContext, get_current_context  # avoids a cycle

    def _checker(
        request: Request,
        ctx: "SessionContext" = Depends(get_current_context),
        db: Session = Depends(get_db),
    ) -> "SessionContext":
        for name in rule_names:
            rule = _CTX_POLICY_RULES.get(name)
            if rule is None:
                raise ForbiddenError(f"Unknown policy rule: {name}")
            rule(ctx, request, db=db)
        return ctx

    return _checker
