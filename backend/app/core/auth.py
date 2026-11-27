from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, set_tenant_context
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.policy import (
    apply_access_rules,
    enforce_ip_allowlist,
    enforce_mfa_verified,
    resolve_project_id_for_resource,
)
from app.core.project_access import (
    SYSTEM_TIERS,
    access_for_project,
    access_for_request,
    projects_of_request,
    tier_of,
)
from app.models.identity import Permission, Role, RolePermission, User
from app.models.identity import Session as SessionModel
from app.models.tenant import Tenant

settings = get_settings()


@dataclass
class SessionContext:
    session_id: UUID
    tenant_id: UUID
    user_id: UUID
    # ADR-059: for a system role this is the real code ("admin"/"manager"/
    # "tester"), unchanged from before custom roles existed. For a custom
    # role (no fixed code), this is a derived access-tier value -- "manager"
    # if the role holds `project.view.all`, else "tester" -- so every
    # pre-existing `role_code in ("admin","manager")` / `== "tester"` check
    # across the codebase (dozens of call sites, several reached only
    # indirectly via owner_access.py/ai.py/search.py/etc.) keeps working
    # unchanged and composes correctly with custom roles, without needing
    # to touch each call site individually. Never shown to the end user as
    # their role name -- see `display_role` for that.
    role_code: str
    display_role: str
    permissions: set[str]
    # ADR-143: `role_code` and `permissions` describe the project the request is about,
    # if it is about one. These keep the organization-wide answer.
    org_role_code: str = ""
    org_permissions: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if not self.org_role_code:
            self.org_role_code = self.role_code
            self.org_permissions = set(self.permissions)


def client_ip(request: Request) -> str | None:
    """Tier 4 / ADR-054: resolves the caller's IP for allowlist enforcement
    (PV-11.3). Only honors X-Forwarded-For when `trust_proxy_headers` is on
    -- see config.py's note on why a bare client-supplied header is never
    trusted by default."""
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _enforce_ip_allowlist(db: Session, tenant_id: UUID, request: Request) -> None:
    """Thin wrapper kept for backward compatibility with existing callers
    (`app.services.auth_service.start_login`) -- the real logic now lives
    in `app.core.policy.enforce_ip_allowlist` (RBAC/PBAC/ABAC plan, Phase 2:
    a behavior-identical extraction, not a new check)."""
    enforce_ip_allowlist(db, tenant_id, client_ip(request))


def parse_session_cookie(request: Request) -> UUID:
    raw = request.cookies.get(settings.session_cookie_name)
    if not raw:
        raise UnauthorizedError("Not authenticated")
    try:
        return UUID(raw)
    except ValueError as exc:
        raise UnauthorizedError("Invalid session") from exc


def _load_role_and_permissions(
    db: Session, tenant_id: UUID, user_id: UUID
) -> tuple[str, str, set[str]]:
    user_row = db.execute(
        select(User.role_id, User.is_active).where(User.id == user_id, User.tenant_id == tenant_id)
    ).first()
    if user_row is None or not user_row.is_active:
        raise UnauthorizedError("User not found or deactivated")

    role_row = db.execute(select(Role.code, Role.name).where(Role.id == user_row.role_id)).one()

    permission_codes = set(
        db.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == user_row.role_id)
        )
        .scalars()
        .all()
    )

    # A system role outside the three tiers (QA Lead, Developer, Viewer) and a custom
    # role are shown by name and mapped onto a tier.
    display_role = role_row.code if role_row.code in SYSTEM_TIERS else role_row.name

    return tier_of(role_row.code, permission_codes), display_role, permission_codes


def get_current_context(request: Request, db: Session = Depends(get_db)) -> SessionContext:
    """Resolves the session cookie into a tenant-bound context (ADR-015: the
    sessions table itself is looked up without tenant RLS; once resolved,
    its tenant_id becomes the trusted context for every other query this
    request makes)."""
    session_id = parse_session_cookie(request)

    session_row = db.execute(
        select(SessionModel).where(SessionModel.id == session_id)
    ).scalar_one_or_none()
    if session_row is None:
        raise UnauthorizedError("Session not found")
    if session_row.revoked_at is not None:
        raise UnauthorizedError("Session revoked")
    if session_row.expires_at < datetime.now(UTC):
        raise UnauthorizedError("Session expired")
    enforce_mfa_verified(session_row)

    now = datetime.now(UTC)
    idle_cutoff = now - timedelta(minutes=settings.session_ttl_minutes)
    if session_row.last_seen_at < idle_cutoff:
        session_row.revoked_at = now
        db.commit()
        raise UnauthorizedError("Session expired due to inactivity")

    tenant_status = db.execute(
        select(Tenant.status).where(Tenant.id == session_row.tenant_id)
    ).scalar_one_or_none()
    if tenant_status is not None and tenant_status != "approved":
        raise ForbiddenError("This organization's account is no longer active.")

    enforce_ip_allowlist(db, session_row.tenant_id, client_ip(request))

    session_row.last_seen_at = now
    db.commit()

    set_tenant_context(db, str(session_row.tenant_id))
    role_code, display_role, permissions = _load_role_and_permissions(
        db, session_row.tenant_id, session_row.user_id
    )

    # ADR-143: if the request is about a project where this user has a project role, that
    # role decides, both for the route's check and for the rules inside services.
    projects = projects_of_request(
        db, request.method, request.path_params, request.query_params.get("project_id")
    )
    effective_role, effective_permissions = access_for_request(
        db, session_row.user_id, role_code, permissions, projects
    )

    return SessionContext(
        session_id=session_row.id,
        tenant_id=session_row.tenant_id,
        user_id=session_row.user_id,
        role_code=effective_role,
        display_role=display_role,
        permissions=effective_permissions,
        org_role_code=role_code,
        org_permissions=permissions,
    )


def context_for_project(db: Session, ctx: SessionContext, project_id: UUID) -> SessionContext:
    """The context for a project the request names somewhere other than its path."""
    role_code, permissions = access_for_project(
        db, ctx.user_id, ctx.org_role_code, ctx.org_permissions, project_id
    )
    return replace(ctx, role_code=role_code, permissions=permissions)


def require_permission(code: str):
    def _checker(
        request: Request,
        ctx: SessionContext = Depends(get_current_context),
        db: Session = Depends(get_db),
    ) -> SessionContext:
        if code not in ctx.permissions:
            raise ForbiddenError(f"Missing permission: {code}")
        apply_access_rules(ctx, request, db, code)  # RBAC Phase 4 (ADR-092)
        return ctx

    return _checker


def get_effective_permissions_for_project(
    db: Session, ctx: SessionContext, project_id: UUID
) -> set[str]:
    """The user's permission codes for records of this project (ADR-143)."""
    return context_for_project(db, ctx, project_id).permissions


def require_project_permission(code: str):
    """Project-aware variant of `require_permission`, for routes where
    `project_id` is itself a path parameter (FastAPI binds it here by
    parameter name). Only use this where a project-scoped role override
    should actually take effect; routes with no project in their path
    keep using the plain `require_permission`/`require_any_permission`.
    """

    def _checker(
        project_id: UUID,
        request: Request,
        ctx: SessionContext = Depends(get_current_context),
        db: Session = Depends(get_db),
    ) -> SessionContext:
        effective = get_effective_permissions_for_project(db, ctx, project_id)
        if code not in effective:
            raise ForbiddenError(f"Missing permission: {code}")
        apply_access_rules(ctx, request, db, code, project_id)  # RBAC Phase 4 (ADR-092)
        return ctx

    return _checker


def require_resource_permission(code: str, resource_type: str, id_param: str | None = None):
    """RBAC Phase 3: resource-id-keyed sibling of `require_project_permission`,
    for routes where the resource is addressed by its own id
    (`test_case_id`/`defect_id`) rather than by a `project_id` path param.
    `resource_type` must be a key `policy.resolve_project_id_for_resource`
    knows (`"test_case"`/`"defect"`) and its id must be bound in the route
    path under `f"{resource_type}_id"`.

    This generalizes Phase 1's project-role override to these routes: if
    the resource's project_id resolves and the caller has a project-scoped
    role override there, that override's permissions decide this check,
    same as `require_project_permission` already does for `project_id`-path
    routes. If the resource can't be resolved (wrong tenant / doesn't
    exist), falls back to the plain tenant-wide permission check so the
    service layer still gets to raise its own NotFoundError, unchanged.

    Additive, not a replacement: the existing service-layer project-access
    checks (`_authorize_case_access`, `_require_project_access`) still run
    exactly as before and are untouched by this.
    """

    id_param = id_param or f"{resource_type}_id"

    def _checker(
        request: Request,
        ctx: SessionContext = Depends(get_current_context),
        db: Session = Depends(get_db),
    ) -> SessionContext:
        # GAP-89/ADR-088: a malformed id here is not this dependency's error to
        # raise (it used to be a bare `UUID(raw)` -> ValueError -> 500). Treat it as
        # unresolvable and let FastAPI's own path validation return the 422.
        raw_id = request.path_params.get(id_param)
        try:
            resource_id = UUID(str(raw_id)) if raw_id is not None else None
        except ValueError:
            resource_id = None
        project_id = (
            resolve_project_id_for_resource(db, ctx.tenant_id, resource_type, resource_id)
            if resource_id is not None
            else None
        )
        effective = (
            get_effective_permissions_for_project(db, ctx, project_id)
            if project_id is not None
            else ctx.permissions
        )
        if code not in effective:
            raise ForbiddenError(f"Missing permission: {code}")
        apply_access_rules(ctx, request, db, code, project_id)  # RBAC Phase 4 (ADR-092)
        return ctx

    return _checker


def require_any_permission(*codes: str):
    """ADR-028: gate a route behind any one of several permissions, for
    cases where more than one role-capability legitimately needs the same
    read (e.g. listing users: Admin via user.manage, Manager via
    project.members.manage)."""

    def _checker(ctx: SessionContext = Depends(get_current_context)) -> SessionContext:
        if not any(code in ctx.permissions for code in codes):
            raise ForbiddenError(f"Missing permission: one of {codes}")
        return ctx

    return _checker


def set_session_cookie(response: Response, session_id: UUID) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=str(session_id),
        httponly=True,
        samesite="lax",
        secure=settings.environment != "development",
        max_age=settings.session_absolute_ttl_hours * 3600,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.session_cookie_name)
