from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.security import hash_password
from app.models.identity import Role, User
from app.models.identity import Session as SessionModel
from app.schemas.user import RoleCode, UserCreateRequest, UserOut, UserUpdateRequest
from app.services import plan_limits


def to_out(db: Session, user: User) -> UserOut:
    role_code = db.execute(select(Role.code).where(Role.id == user.role_id)).scalar_one()
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=cast(RoleCode, role_code),
        is_active=user.is_active,
        created_at=user.created_at,
    )


def list_users(db: Session, tenant_id: UUID) -> list[User]:
    return list(
        db.execute(
            select(User).where(User.tenant_id == tenant_id).order_by(User.created_at)
        ).scalars()
    )


def _role_id_for_code(db: Session, code: str) -> UUID:
    role_id = db.execute(select(Role.id).where(Role.code == code)).scalar_one_or_none()
    if role_id is None:
        raise ValidationAppError(f"Unknown role: {code}")
    return role_id


def _count_active_admins(db: Session, tenant_id: UUID, exclude_user_id: UUID | None = None) -> int:
    admin_role_id = db.execute(select(Role.id).where(Role.code == "admin")).scalar_one()
    query = select(func.count(User.id)).where(
        User.tenant_id == tenant_id, User.role_id == admin_role_id, User.is_active.is_(True)
    )
    if exclude_user_id is not None:
        query = query.where(User.id != exclude_user_id)
    return db.execute(query).scalar_one()


def create_user(db: Session, tenant_id: UUID, actor_user_id: UUID, req: UserCreateRequest) -> User:
    plan_limits.enforce_seat_limit(db, tenant_id)
    user = User(
        tenant_id=tenant_id,
        email=req.email,
        name=req.name,
        role_id=_role_id_for_code(db, req.role),
        password_hash=hash_password(req.password),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A user with this email already exists in this tenant") from exc

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": req.email, "role": req.role},
    )
    db.commit()
    return user


def _get_user_or_404(db: Session, tenant_id: UUID, user_id: UUID) -> User:
    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == user_id)
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")
    return user


def update_user(
    db: Session, tenant_id: UUID, actor_user_id: UUID, user_id: UUID, req: UserUpdateRequest
) -> User:
    user = _get_user_or_404(db, tenant_id, user_id)

    demoting_admin = req.role is not None and req.role != "admin"
    deactivating = req.is_active is False
    current_role = db.execute(select(Role.code).where(Role.id == user.role_id)).scalar_one()

    if current_role == "admin" and (demoting_admin or deactivating):
        if _count_active_admins(db, tenant_id, exclude_user_id=user.id) == 0:
            raise ConflictError("Cannot remove the last remaining Admin in this tenant")

    if req.name is not None:
        user.name = req.name
    if req.role is not None:
        user.role_id = _role_id_for_code(db, req.role)
    if req.is_active is not None:
        user.is_active = req.is_active

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        metadata=req.model_dump(exclude_unset=True),
    )
    db.commit()
    return user


def deactivate_user(db: Session, tenant_id: UUID, actor_user_id: UUID, user_id: UUID) -> User:
    return update_user(db, tenant_id, actor_user_id, user_id, UserUpdateRequest(is_active=False))


def reset_password(
    db: Session, tenant_id: UUID, actor_user_id: UUID, user_id: UUID, new_password: str
) -> User:
    """Admin-initiated password reset. Revokes every existing session for
    the target user so a credential reset (e.g. after suspected compromise)
    can't be bypassed by an already-open session."""
    user = _get_user_or_404(db, tenant_id, user_id)
    user.password_hash = hash_password(new_password)

    now = datetime.now(UTC)
    active_sessions = select(SessionModel).where(
        SessionModel.user_id == user_id, SessionModel.revoked_at.is_(None)
    )
    for session_row in db.execute(active_sessions).scalars():
        session_row.revoked_at = now

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="user.password_reset",
        entity_type="user",
        entity_id=user.id,
    )
    db.commit()
    return user


def gdpr_erase(db: Session, tenant_id: UUID, actor_user_id: UUID, user_id: UUID) -> User:
    """Pseudonymizes PII while retaining the row for audit continuity
    (ADR-009). Does not physically delete the user or touch audit_logs."""
    user = _get_user_or_404(db, tenant_id, user_id)

    pseudonym = f"user_{uuid4().hex}"
    user.name = pseudonym
    user.email = f"{pseudonym}@erased.invalid"
    user.pseudonymized_at = datetime.now(UTC)
    user.is_active = False

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="user.gdpr_erased",
        entity_type="user",
        entity_id=user.id,
    )
    db.commit()
    return user
