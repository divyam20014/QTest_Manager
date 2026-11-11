"""ADR-059: tenant-definable custom roles, superseding ADR-014's fixed
3-role matrix. System roles (admin/manager/tester) stay shared, globally
seeded, un-deletable rows (`tenant_id IS NULL`, `is_system=True`); a tenant
may additionally define its own roles with any subset of the permissions
the system actually enforces.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models.identity import Permission, Role, RolePermission, User
from app.schemas.role import PermissionOut, RoleCreateRequest, RoleOut, RoleUpdateRequest


def list_permissions(db: Session) -> list[PermissionOut]:
    """The full real set of permissions the backend actually enforces --
    the role builder may only ever grant combinations of these, never an
    invented permission string with no corresponding check anywhere."""
    rows = db.execute(select(Permission).order_by(Permission.code)).scalars()
    return [PermissionOut(code=r.code, description=r.description) for r in rows]


def _permission_codes_for_role(db: Session, role_id: UUID) -> list[str]:
    return list(
        db.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role_id)
            .order_by(Permission.code)
        ).scalars()
    )


def _to_out(db: Session, role: Role) -> RoleOut:
    user_count = db.execute(
        select(func.count(User.id)).where(User.role_id == role.id, User.is_active.is_(True))
    ).scalar_one()
    return RoleOut(
        id=role.id,
        name=role.name,
        code=role.code,
        is_system=role.is_system,
        is_active=role.is_active,
        permission_codes=_permission_codes_for_role(db, role.id),
        user_count=user_count,
    )


def list_roles(db: Session, tenant_id: UUID) -> list[RoleOut]:
    set_tenant_context(db, str(tenant_id))
    roles = db.execute(
        select(Role)
        .where((Role.tenant_id.is_(None)) | (Role.tenant_id == tenant_id))
        .order_by(Role.is_system.desc(), Role.name)
    ).scalars()
    return [_to_out(db, r) for r in roles]


def _get_role_or_404(db: Session, tenant_id: UUID, role_id: UUID) -> Role:
    set_tenant_context(db, str(tenant_id))
    role = db.execute(
        select(Role).where(
            Role.id == role_id, (Role.tenant_id.is_(None)) | (Role.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if role is None:
        raise NotFoundError("Role not found")
    return role


def _validate_permission_codes(db: Session, codes: list[str]) -> list[Permission]:
    if not codes:
        return []
    perms = list(db.execute(select(Permission).where(Permission.code.in_(codes))).scalars())
    found = {p.code for p in perms}
    unknown = set(codes) - found
    if unknown:
        raise ValidationAppError(f"Unknown permission code(s): {', '.join(sorted(unknown))}")
    return perms


def create_role(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: RoleCreateRequest
) -> RoleOut:
    set_tenant_context(db, str(tenant_id))
    perms = _validate_permission_codes(db, req.permission_codes)

    role = Role(name=req.name, tenant_id=tenant_id, is_system=False, is_active=True)
    db.add(role)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A role with this name already exists in this tenant") from exc

    for perm in perms:
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="role.created",
        entity_type="role",
        entity_id=role.id,
        metadata={"name": req.name, "permission_codes": req.permission_codes},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, role)


def update_role(
    db: Session, tenant_id: UUID, actor_user_id: UUID, role_id: UUID, req: RoleUpdateRequest
) -> RoleOut:
    role = _get_role_or_404(db, tenant_id, role_id)
    if role.is_system:
        raise ForbiddenSystemRoleError()
    if role.tenant_id != tenant_id:
        raise NotFoundError("Role not found")

    changes: dict = {}
    if req.name is not None and req.name != role.name:
        role.name = req.name
        changes["name"] = req.name
    if req.permission_codes is not None:
        perms = _validate_permission_codes(db, req.permission_codes)
        for rp in db.execute(
            select(RolePermission).where(RolePermission.role_id == role.id)
        ).scalars():
            db.delete(rp)
        db.flush()
        for perm in perms:
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        changes["permission_codes"] = req.permission_codes

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A role with this name already exists in this tenant") from exc

    if changes:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="role.updated",
            entity_type="role",
            entity_id=role.id,
            metadata=changes,
        )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, role)


def deactivate_role(db: Session, tenant_id: UUID, actor_user_id: UUID, role_id: UUID) -> RoleOut:
    role = _get_role_or_404(db, tenant_id, role_id)
    if role.is_system:
        raise ForbiddenSystemRoleError()
    if role.tenant_id != tenant_id:
        raise NotFoundError("Role not found")

    active_users = db.execute(
        select(func.count(User.id)).where(User.role_id == role.id, User.is_active.is_(True))
    ).scalar_one()
    if active_users > 0:
        raise ConflictError(
            f"Cannot deactivate this role: {active_users} active user(s) still hold it. "
            "Reassign them to another role first."
        )

    role.is_active = False
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="role.deactivated",
        entity_type="role",
        entity_id=role.id,
        metadata={},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, role)


class ForbiddenSystemRoleError(ForbiddenError):
    def __init__(self) -> None:
        super().__init__("System roles (Admin/Manager/Tester) cannot be edited or deactivated.")
