"""Test helpers for the Platform Admin session + TOTP plane (ADR-074)."""

import time
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import totp
from app.core.config import get_settings
from app.core.crypto import encrypt_secret
from app.core.security import hash_password

PLATFORM_EMAIL = "owner@qtesthub.local"
PLATFORM_PASSWORD = "PlatformOwner123!"
PLATFORM_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
COOKIE_NAME = get_settings().platform_session_cookie_name


def seed_admin(
    owner_engine,
    email: str = PLATFORM_EMAIL,
    password: str = PLATFORM_PASSWORD,
    totp_secret: str | None = PLATFORM_TOTP_SECRET,
) -> None:
    """Inserts a platform admin; with a secret it is already MFA-enrolled."""
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO platform_admins "
                "(email, password_hash, mfa_secret_encrypted, mfa_enabled_at) "
                "VALUES (:email, :hash, :secret, :enabled)"
            ),
            {
                "email": email,
                "hash": hash_password(password),
                "secret": encrypt_secret(totp_secret) if totp_secret else None,
                "enabled": datetime.now(UTC) if totp_secret else None,
            },
        )


def cookie_from(response) -> str | None:
    """The raw platform session token set by a response (or None)."""
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{COOKIE_NAME}="):
            value = header.split(";", 1)[0].split("=", 1)[1]
            return value or None
    return None


def headers_for(token: str) -> dict[str, str]:
    return {"Cookie": f"{COOKIE_NAME}={token}"}


def sign_in(
    app_client: TestClient,
    email: str = PLATFORM_EMAIL,
    password: str = PLATFORM_PASSWORD,
    secret: str = PLATFORM_TOTP_SECRET,
    at: float | None = None,
) -> dict[str, str]:
    """Full real sign-in (password then TOTP); returns request headers that
    carry the fully authenticated session cookie."""
    login = app_client.post(
        "/api/v1/platform/auth/login", json={"email": email, "password": password}
    )
    assert login.status_code == 200, login.text
    token = cookie_from(login)
    assert token
    verify = app_client.post(
        "/api/v1/platform/auth/mfa/verify",
        json={"code": totp.generate_code(secret, at)},
        headers=headers_for(token),
    )
    assert verify.status_code == 200, verify.text
    full = cookie_from(verify)
    assert full and full != token
    return headers_for(full)


def current_code(secret: str = PLATFORM_TOTP_SECRET, offset_steps: int = 0) -> str:
    return totp.generate_code(secret, time.time() + offset_steps * totp.PERIOD_SECONDS)
