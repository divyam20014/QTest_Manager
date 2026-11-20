from dataclasses import dataclass
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
from app.models.identity import Permission, Role, RolePermission, User
from app.models.identity import Session as SessionModel
from app.models.project import ProjectMember
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


_SYSTEM_ROLE_CODES = ("admin", "manager", "tester")


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

    if role_row.code in _SYSTEM_ROLE_CODES:
        effective_role_code = role_row.code
        display_role = role_row.code
    else:
        # ADR-059: a custom role maps onto whichever existing access tier
        # its permissions match most closely, so it composes with every
        # pre-existing hardcoded role_code comparison in the codebase.
        effective_role_code = "manager" if "project.view.all" in permission_codes else "tester"
        display_role = role_row.name

    return effective_role_code, display_role, permission_codes


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

    return SessionContext(
        session_id=session_row.id,
        tenant_id=session_row.tenant_id,
        user_id=session_row.user_id,
        role_code=role_code,
        display_role=display_role,
        permissions=permissions,
    )


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
    """RBAC Phase 1 (project-level role scoping): if this member has a
    project-scoped role override (`project_members.role_id`), their
    permissions FOR ACTIONS SCOPED TO THIS PROJECT come from that role
    instead of their tenant-wide role. No override (the default -- every
    member until an admin/manager explicitly sets one) means this returns
    `ctx.permissions` unchanged, so behavior for the overwhelming majority
    of users is identical to before this feature existed.

    This only generalizes the FastAPI permission *gate* -- it does not
    change `ctx.role_code`, so deeper service-layer logic that branches on
    role_code (e.g. manager-assigned-or-admin checks) still uses the
    tenant-wide role. Extending the override to that layer is a
    deliberately deferred, separately-scoped follow-up, not part of this
    phase.
    """
    override_role_id = db.execute(
        select(ProjectMember.role_id).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == ctx.user_id
        )
    ).scalar_one_or_none()
    if override_role_id is None:
        return ctx.permissions

    return set(
        db.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == override_role_id)
        )
        .scalars()
        .all()
    )


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


def require_resource_permission(code: str, resource_type: str):
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

    id_param = f"{resource_type}_id"

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
