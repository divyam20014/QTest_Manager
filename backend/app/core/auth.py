from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, set_tenant_context
from app.core.errors import ForbiddenError, UnauthorizedError
from app.models.identity import Permission, Role, RolePermission, User
from app.models.identity import Session as SessionModel

settings = get_settings()


@dataclass
class SessionContext:
    session_id: UUID
    tenant_id: UUID
    user_id: UUID
    role_code: str
    permissions: set[str]


def parse_session_cookie(request: Request) -> UUID:
    raw = request.cookies.get(settings.session_cookie_name)
    if not raw:
        raise UnauthorizedError("Not authenticated")
    try:
        return UUID(raw)
    except ValueError as exc:
        raise UnauthorizedError("Invalid session") from exc


def _load_role_and_permissions(db: Session, tenant_id: UUID, user_id: UUID) -> tuple[str, set[str]]:
    user_row = db.execute(
        select(User.role_id, User.is_active).where(User.id == user_id, User.tenant_id == tenant_id)
    ).first()
    if user_row is None or not user_row.is_active:
        raise UnauthorizedError("User not found or deactivated")

    role_code = db.execute(select(Role.code).where(Role.id == user_row.role_id)).scalar_one()

    permission_codes = (
        db.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == user_row.role_id)
        )
        .scalars()
        .all()
    )
    return role_code, set(permission_codes)


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
    if not session_row.mfa_verified:
        raise UnauthorizedError("MFA verification required")

    set_tenant_context(db, str(session_row.tenant_id))
    role_code, permissions = _load_role_and_permissions(
        db, session_row.tenant_id, session_row.user_id
    )

    return SessionContext(
        session_id=session_row.id,
        tenant_id=session_row.tenant_id,
        user_id=session_row.user_id,
        role_code=role_code,
        permissions=permissions,
    )


def require_permission(code: str):
    def _checker(ctx: SessionContext = Depends(get_current_context)) -> SessionContext:
        if code not in ctx.permissions:
            raise ForbiddenError(f"Missing permission: {code}")
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
