"""Tier 4 / ADR-054: minimal SCIM 2.0 server, Users only (PV-11.2).

Depends on Tier 4's SSO work existing (SCIM is normally paired with an
IdP integration). Scoped narrowly and documented, not silently limited:

- Groups/Roles sync is NOT implemented -- every SCIM-provisioned user
  gets a fixed default role (see `_DEFAULT_SCIM_ROLE`), the same
  no-role-claim-trusted stance SSO auto-provisioning takes.
- SCIM DELETE deactivates (`is_active = false`), never hard-deletes --
  preserving audit/FK integrity matters more here than literal DELETE
  semantics, mirroring how `user_service` already treats removal
  elsewhere in this codebase.
- **Validated against the SCIM 2.0 spec's documented request/response
  shapes directly, not against a real IdP's SCIM client** (Okta/Azure AD
  Entra/etc.) -- there is no real IdP reachable from this sandbox. A real
  pre-launch validation pass against an actual IdP's SCIM client is a
  required follow-up before any tenant relies on this in production.
"""

import secrets
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError, ValidationAppError
from app.core.security import hash_password, verify_password
from app.models.identity import Role, User
from app.models.scim_token import ScimToken
from app.schemas.scim import (
    ScimEmail,
    ScimListResponse,
    ScimMeta,
    ScimPatchRequest,
    ScimUserCreateRequest,
    ScimUserOut,
    ScimUserReplaceRequest,
)

_DEFAULT_SCIM_ROLE = "tester"


def _to_scim_user(user: User) -> ScimUserOut:
    return ScimUserOut(
        id=str(user.id),
        userName=user.email,
        displayName=user.name,
        emails=[ScimEmail(value=user.email, primary=True)],
        active=user.is_active,
        meta=ScimMeta(created=user.created_at, lastModified=user.created_at),
    )


def list_users(db: Session, tenant_id: UUID, start_index: int, count: int) -> ScimListResponse:
    set_tenant_context(db, str(tenant_id))
    query = select(User).where(User.tenant_id == tenant_id).order_by(User.created_at)
    all_rows = list(db.execute(query).scalars())
    page = all_rows[start_index - 1 : start_index - 1 + count]
    return ScimListResponse(
        totalResults=len(all_rows),
        startIndex=start_index,
        itemsPerPage=len(page),
        Resources=[_to_scim_user(u) for u in page],
    )


def get_user(db: Session, tenant_id: UUID, user_id: UUID) -> ScimUserOut:
    set_tenant_context(db, str(tenant_id))
    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == user_id)
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")
    return _to_scim_user(user)


def create_user(db: Session, tenant_id: UUID, req: ScimUserCreateRequest) -> ScimUserOut:
    set_tenant_context(db, str(tenant_id))
    existing = db.execute(
        select(User.id).where(User.tenant_id == tenant_id, User.email == req.userName)
    ).scalar_one_or_none()
    if existing is not None:
        raise ValidationAppError("A user with this userName already exists")

    role_id = db.execute(select(Role.id).where(Role.code == _DEFAULT_SCIM_ROLE)).scalar_one()
    user = User(
        tenant_id=tenant_id,
        email=req.userName,
        name=req.displayName or req.userName,
        role_id=role_id,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        is_active=req.active,
    )
    db.add(user)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="user.scim_provisioned",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": req.userName},
    )
    db.commit()
    return _to_scim_user(user)


def replace_user(
    db: Session, tenant_id: UUID, user_id: UUID, req: ScimUserReplaceRequest
) -> ScimUserOut:
    set_tenant_context(db, str(tenant_id))
    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == user_id)
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")

    if req.userName is not None:
        user.email = req.userName
    if req.displayName is not None:
        user.name = req.displayName
    if req.active is not None:
        user.is_active = req.active
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="user.scim_updated",
        entity_type="user",
        entity_id=user.id,
    )
    db.commit()
    return _to_scim_user(user)


def patch_user(db: Session, tenant_id: UUID, user_id: UUID, req: ScimPatchRequest) -> ScimUserOut:
    """Supports the common case IdPs actually send: a flat `replace` of
    `active` (deprovisioning) or `displayName`/`userName`. Anything else
    (add/remove on multi-valued attributes, nested paths) is out of scope
    for this minimal implementation and is ignored rather than erroring --
    documented, not silent-by-accident."""
    set_tenant_context(db, str(tenant_id))
    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == user_id)
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")

    for operation in req.Operations:
        if operation.op.lower() != "replace":
            continue
        is_plain_active = operation.path == "active"
        is_nested_active = operation.path is None and isinstance(operation.value, dict)
        if is_plain_active or is_nested_active:
            value = operation.value if is_plain_active else operation.value.get("active")
            if isinstance(value, bool):
                user.is_active = value
        elif operation.path == "displayName" and isinstance(operation.value, str):
            user.name = operation.value
        elif operation.path == "userName" and isinstance(operation.value, str):
            user.email = operation.value

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="user.scim_updated",
        entity_type="user",
        entity_id=user.id,
    )
    db.commit()
    return _to_scim_user(user)


def deactivate_user(db: Session, tenant_id: UUID, user_id: UUID) -> None:
    """SCIM DELETE deprovisions -- deactivates, never hard-deletes (see
    module docstring)."""
    set_tenant_context(db, str(tenant_id))
    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == user_id)
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")
    user.is_active = False
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="user.scim_deprovisioned",
        entity_type="user",
        entity_id=user.id,
    )
    db.commit()


# -- Bearer token management (tenant-admin, authenticated) --------------


def create_token(db: Session, tenant_id: UUID, actor_user_id: UUID) -> tuple[ScimToken, str]:
    set_tenant_context(db, str(tenant_id))
    raw = secrets.token_urlsafe(32)
    token = ScimToken(tenant_id=tenant_id, token_hash=hash_password(raw))
    db.add(token)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="tenant.scim_token_created",
        entity_type="scim_token",
        entity_id=token.id,
    )
    db.commit()
    return token, raw


def list_tokens(db: Session, tenant_id: UUID) -> list[ScimToken]:
    set_tenant_context(db, str(tenant_id))
    return list(
        db.execute(
            select(ScimToken)
            .where(ScimToken.tenant_id == tenant_id)
            .order_by(ScimToken.created_at.desc())
        ).scalars()
    )


def revoke_token(db: Session, tenant_id: UUID, actor_user_id: UUID, token_id: UUID) -> None:
    set_tenant_context(db, str(tenant_id))
    token = db.execute(
        select(ScimToken).where(ScimToken.tenant_id == tenant_id, ScimToken.id == token_id)
    ).scalar_one_or_none()
    if token is None:
        raise NotFoundError("SCIM token not found")
    token.revoked_at = datetime.now(UTC)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="tenant.scim_token_revoked",
        entity_type="scim_token",
        entity_id=token.id,
    )
    db.commit()


def authenticate(db: Session, tenant_id: UUID, raw_token: str) -> bool:
    """Used by the SCIM API's own bearer-token dependency -- tenant_id is
    already known from the URL path, so this is a plain tenant-scoped
    lookup, not a cross-tenant scan."""
    set_tenant_context(db, str(tenant_id))
    tokens = db.execute(
        select(ScimToken).where(ScimToken.tenant_id == tenant_id, ScimToken.revoked_at.is_(None))
    ).scalars()
    for token in tokens:
        if verify_password(raw_token, token.token_hash):
            token.last_used_at = datetime.now(UTC)
            db.commit()
            return True
    return False


__all__ = [
    "list_users",
    "get_user",
    "create_user",
    "replace_user",
    "patch_user",
    "deactivate_user",
    "create_token",
    "list_tokens",
    "revoke_token",
    "authenticate",
]
