"""Tier 4 / ADR-054: tenant SSO via OIDC (PV-11.1).

Scope decision: OIDC only, not SAML. No real external IdP (Okta/Azure
AD/Google) is reachable from this sandbox to validate against, and OIDC
is both simpler to implement correctly and more broadly supported by
modern IdPs than SAML -- SAML stays a documented future option (ADR-054),
not attempted here. **This flow is validated against a stub OIDC
provider in tests, not a real production IdP** -- a real pre-launch
validation pass against an actual IdP is a required follow-up before any
tenant relies on this in production.

MFA decision: a successful SSO login issues a session with
`mfa_verified=True` immediately -- the identity provider is treated as
the trust anchor and is assumed to enforce its own MFA policy. This app's
own MFA challenge is never issued for SSO logins. Documented here and in
ADR-054 because it is a genuine security-relevant trade-off, not an
oversight.
"""

import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode
from uuid import UUID

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError, UnauthorizedError
from app.core.security import hash_password
from app.models.identity import Role, User
from app.models.identity import Session as SessionModel
from app.models.sso_config import SsoConfig
from app.schemas.sso import SsoConfigOut, SsoConfigUpsertRequest

settings = get_settings()


def _discovery_url(issuer: str) -> str:
    return issuer.rstrip("/") + "/.well-known/openid-configuration"


def _fetch_discovery(issuer: str) -> dict:
    resp = httpx.get(_discovery_url(issuer), timeout=settings.sso_http_timeout_seconds)
    resp.raise_for_status()
    return resp.json()  # type: ignore[no-any-return]


def get_config(db: Session, tenant_id: UUID) -> SsoConfig | None:
    set_tenant_context(db, str(tenant_id))
    return db.execute(
        select(SsoConfig).where(SsoConfig.tenant_id == tenant_id)
    ).scalar_one_or_none()


def get_config_out(db: Session, tenant_id: UUID) -> SsoConfigOut:
    set_tenant_context(db, str(tenant_id))
    cfg = get_config(db, tenant_id)
    if cfg is None:
        return SsoConfigOut(enabled=False, issuer=None, client_id=None, default_role_code="tester")
    return SsoConfigOut(
        enabled=cfg.enabled,
        issuer=cfg.issuer,
        client_id=cfg.client_id,
        default_role_code=cfg.default_role_code,
    )


def is_enabled(db: Session, tenant_id: UUID) -> bool:
    set_tenant_context(db, str(tenant_id))
    cfg = get_config(db, tenant_id)
    return bool(cfg is not None and cfg.enabled)


def upsert_config(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: SsoConfigUpsertRequest
) -> SsoConfigOut:
    set_tenant_context(db, str(tenant_id))
    cfg = get_config(db, tenant_id)
    if cfg is None:
        if not req.client_secret:
            from app.core.errors import ValidationAppError

            raise ValidationAppError("client_secret is required when first configuring SSO")
        cfg = SsoConfig(
            tenant_id=tenant_id,
            issuer=req.issuer,
            client_id=req.client_id,
            client_secret_encrypted=encrypt_secret(req.client_secret),
            default_role_code=req.default_role_code,
            enabled=req.enabled,
        )
        db.add(cfg)
    else:
        cfg.issuer = req.issuer
        cfg.client_id = req.client_id
        if req.client_secret:
            cfg.client_secret_encrypted = encrypt_secret(req.client_secret)
        cfg.default_role_code = req.default_role_code
        cfg.enabled = req.enabled
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="tenant.sso_configured",
        entity_type="tenant",
        entity_id=tenant_id,
        metadata={"enabled": req.enabled, "issuer": req.issuer},
    )
    db.commit()
    return get_config_out(db, tenant_id)


def build_authorization_url(cfg: SsoConfig, redirect_uri: str, state: str) -> str:
    discovery = _fetch_discovery(cfg.issuer)
    params = {
        "response_type": "code",
        "client_id": cfg.client_id,
        "redirect_uri": redirect_uri,
        "scope": "openid email profile",
        "state": state,
    }
    return f"{discovery['authorization_endpoint']}?{urlencode(params)}"


def exchange_code_and_provision(
    db: Session, tenant_id: UUID, code: str, redirect_uri: str
) -> SessionModel:
    set_tenant_context(db, str(tenant_id))
    cfg = get_config(db, tenant_id)
    if cfg is None or not cfg.enabled:
        raise NotFoundError("SSO is not configured for this organization")

    discovery = _fetch_discovery(cfg.issuer)
    client_secret = decrypt_secret(cfg.client_secret_encrypted)
    token_resp = httpx.post(
        discovery["token_endpoint"],
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": cfg.client_id,
            "client_secret": client_secret,
        },
        timeout=settings.sso_http_timeout_seconds,
    )
    token_resp.raise_for_status()
    id_token = token_resp.json()["id_token"]

    jwks_client = jwt.PyJWKClient(discovery["jwks_uri"])
    signing_key = jwks_client.get_signing_key_from_jwt(id_token)
    claims = jwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256"],
        audience=cfg.client_id,
        issuer=cfg.issuer,
    )
    email = claims.get("email")
    if not email:
        raise UnauthorizedError("SSO identity provider did not return an email claim")

    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    ).scalar_one_or_none()
    if user is None:
        role_id = db.execute(
            select(Role.id).where(Role.code == cfg.default_role_code)
        ).scalar_one()
        # SSO-provisioned users authenticate only via the IdP -- the
        # password hash is an unguessable random value, never usable for
        # password login, mirroring how this codebase never stores a
        # usable credential it doesn't intend to be exercised.
        user = User(
            tenant_id=tenant_id,
            email=email,
            name=claims.get("name") or email,
            role_id=role_id,
            password_hash=hash_password(secrets.token_urlsafe(32)),
        )
        db.add(user)
        db.flush()
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=user.id,
            action="user.sso_provisioned",
            entity_type="user",
            entity_id=user.id,
            metadata={"email": email},
        )
    elif not user.is_active:
        raise UnauthorizedError("This account has been deactivated")

    now = datetime.now(UTC)
    session_row = SessionModel(
        tenant_id=tenant_id,
        user_id=user.id,
        expires_at=now + timedelta(hours=settings.session_absolute_ttl_hours),
        mfa_verified=True,  # ADR-054: the IdP is the trust anchor for SSO
        last_seen_at=now,
    )
    db.add(session_row)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="auth.sso_login",
        entity_type="user",
        entity_id=user.id,
    )
    db.commit()
    return session_row


__all__ = [
    "get_config",
    "get_config_out",
    "is_enabled",
    "upsert_config",
    "build_authorization_url",
    "exchange_code_and_provision",
]
