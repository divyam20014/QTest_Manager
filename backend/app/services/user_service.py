from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.security import hash_password
from app.models.identity import Role, User
from app.models.identity import Session as SessionModel
from app.schemas.user import UserCreateRequest, UserOut, UserUpdateRequest
from app.services import plan_limits


def to_out(db: Session, user: User) -> UserOut:
    # The transaction-local `app.current_tenant` GUC resets on every commit
    # -- callers routinely call this right after create_user/update_user's
    # own commit, so it must be re-asserted before this query touches the
    # RLS-protected `roles` table (same recurring bug class fixed
    # repeatedly elsewhere in this codebase: GAP-17, GAP-49, and every
    # `_to_out` added since Tier 4).
    set_tenant_context(db, str(user.tenant_id))
    role_row = db.execute(
        select(Role.code, Role.name).where(Role.id == user.role_id)
    ).one()
    last_login_at = db.execute(
        select(func.max(SessionModel.last_seen_at)).where(SessionModel.user_id == user.id)
    ).scalar_one_or_none()
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=role_row.code or role_row.name,
        role_id=user.role_id,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login_at=last_login_at,
    )


def resolve_role_id(
    db: Session, tenant_id: UUID, *, role: str | None, role_id: UUID | None
) -> UUID:
    """ADR-059: exactly one of the legacy fixed-code `role` or the new
    `role_id` (any tenant-visible role, system or custom) must be given."""
    if role_id is not None and role is not None:
        raise ValidationAppError("Provide either role or role_id, not both")
    if role_id is not None:
        found = db.execute(
            select(Role.id).where(
                Role.id == role_id,
                (Role.tenant_id.is_(None)) | (Role.tenant_id == tenant_id),
                Role.is_active.is_(True),
            )
        ).scalar_one_or_none()
        if found is None:
            raise ValidationAppError("role_id does not refer to a usable role in this tenant")
        return found
    if role is not None:
        return _role_id_for_code(db, role)
    raise ValidationAppError("Provide either role or role_id")


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
        role_id=resolve_role_id(db, tenant_id, role=req.role, role_id=req.role_id),
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

    # Any role change away from the system Admin role -- whether via the
    # legacy `role` code or a `role_id` pointing at any other role,
    # including a custom one -- counts as demotion for this guard.
    changing_role = req.role is not None or req.role_id is not None
    demoting_admin = changing_role and req.role != "admin"
    deactivating = req.is_active is False
    current_role = db.execute(select(Role.code).where(Role.id == user.role_id)).scalar_one()

    if current_role == "admin" and (demoting_admin or deactivating):
        if _count_active_admins(db, tenant_id, exclude_user_id=user.id) == 0:
            raise ConflictError("Cannot remove the last remaining Admin in this tenant")

    if req.name is not None:
        user.name = req.name
    if changing_role:
        user.role_id = resolve_role_id(db, tenant_id, role=req.role, role_id=req.role_id)
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
