"""Post-gap-closure pass (ADR-059): machine-to-machine auth plane for
CI/CD result ingestion (PV-5, GAP-73).

Mirrors app/services/scim_service.py's token-management functions exactly
(create/list/revoke/authenticate, argon2-hashed at rest, revoke-not-delete)
-- a third, deliberately narrow auth plane alongside the human
session-cookie plane (ADR-007) and the platform-admin HTTP-Basic plane
(ADR-008). `scope` is checked at each call site (app/api/ci.py), never
granted as a blanket "all tenant access" -- a service token only ever
authorizes the one capability (`ci_results`) it was issued for.
"""

import secrets
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError
from app.core.security import hash_password, verify_password
from app.models.service_token import ServiceToken

_VALID_SCOPES = ("ci_results",)


def create_token(
    db: Session, tenant_id: UUID, actor_user_id: UUID, name: str, scope: str = "ci_results"
) -> tuple[ServiceToken, str]:
    if scope not in _VALID_SCOPES:
        from app.core.errors import ValidationAppError

        raise ValidationAppError(f"Unknown scope '{scope}'")

    set_tenant_context(db, str(tenant_id))
    raw = secrets.token_urlsafe(32)
    token = ServiceToken(tenant_id=tenant_id, name=name, scope=scope, token_hash=hash_password(raw))
    db.add(token)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="tenant.service_token_created",
        entity_type="service_token",
        entity_id=token.id,
        metadata={"name": name, "scope": scope},
    )
    db.commit()
    return token, raw


def list_tokens(db: Session, tenant_id: UUID) -> list[ServiceToken]:
    set_tenant_context(db, str(tenant_id))
    return list(
        db.execute(
            select(ServiceToken)
            .where(ServiceToken.tenant_id == tenant_id)
            .order_by(ServiceToken.created_at.desc())
        ).scalars()
    )


def revoke_token(db: Session, tenant_id: UUID, actor_user_id: UUID, token_id: UUID) -> None:
    set_tenant_context(db, str(tenant_id))
    token = db.execute(
        select(ServiceToken).where(ServiceToken.tenant_id == tenant_id, ServiceToken.id == token_id)
    ).scalar_one_or_none()
    if token is None:
        raise NotFoundError("Service token not found")
    token.revoked_at = datetime.now(UTC)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="tenant.service_token_revoked",
        entity_type="service_token",
        entity_id=token.id,
    )
    db.commit()


def authenticate(
    db: Session, tenant_id: UUID, raw_token: str, required_scope: str
) -> ServiceToken | None:
    """tenant_id is already known from the URL path (same as SCIM) -- a
    plain tenant-scoped lookup, not a cross-tenant scan. Returns the token
    row (for audit attribution and last_used_at bookkeeping) only if it is
    unrevoked AND carries the exact scope the calling route requires."""
    set_tenant_context(db, str(tenant_id))
    tokens = db.execute(
        select(ServiceToken).where(
            ServiceToken.tenant_id == tenant_id, ServiceToken.revoked_at.is_(None)
        )
    ).scalars()
    for token in tokens:
        if verify_password(raw_token, token.token_hash):
            if token.scope != required_scope:
                return None
            token.last_used_at = datetime.now(UTC)
            db.commit()
            return token
    return None


__all__ = ["create_token", "list_tokens", "revoke_token", "authenticate"]
