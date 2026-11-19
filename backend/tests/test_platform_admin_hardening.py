"""Tier 0 / ADR-052 + ADR-074: platform-admin brute-force lockout and audit
attribution. The lockout now applies to the session sign-in
(POST /platform/auth/login) rather than HTTP Basic."""

from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.platform_helpers import cookie_from


def _create_tenant(client: TestClient, platform_admin: dict) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Lockout Test Co",
            "admin_name": "Admin A",
            "admin_email": "admin@lockout.example.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/v1/platform/auth/login", json={"email": email, "password": password})


def test_failed_logins_lock_the_platform_admin_account(
    client: TestClient, platform_admin: dict
) -> None:
    for _ in range(5):
        assert _login(client, platform_admin["email"], "WrongPassword1!").status_code == 401

    # The 6th attempt, even with the CORRECT password, is rejected because
    # the account is now locked.
    locked_response = _login(client, platform_admin["email"], platform_admin["password"])
    assert locked_response.status_code == 401
    assert "locked" in locked_response.json()["error"]["message"].lower()
    assert cookie_from(locked_response) is None

    # ... and an already-issued session of a locked account stops working.
    me = client.get("/api/v1/platform/tenants", headers=platform_admin["headers"])
    assert me.status_code == 401


def test_successful_login_resets_failed_count(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    for _ in range(3):
        assert _login(client, platform_admin["email"], "WrongPassword1!").status_code == 401

    ok_response = _login(client, platform_admin["email"], platform_admin["password"])
    assert ok_response.status_code == 200, ok_response.text

    with owner_engine.begin() as conn:
        row = conn.execute(
            text("SELECT failed_login_count, locked_until FROM platform_admins WHERE email = :e"),
            {"e": platform_admin["email"]},
        ).one()
    assert row.failed_login_count == 0
    assert row.locked_until is None


def test_platform_actions_are_attributed_to_the_authenticating_admin(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    tenant = _create_tenant(client, platform_admin)
    tenant_id = tenant["tenant"]["id"]

    with owner_engine.begin() as conn:
        row = conn.execute(
            text(
                "SELECT al.platform_admin_id, pa.email FROM audit_logs al "
                "JOIN platform_admins pa ON pa.id = al.platform_admin_id "
                "WHERE al.tenant_id = :tid AND al.action = 'tenant.created'"
            ),
            {"tid": tenant_id},
        ).one()
    assert row.email == platform_admin["email"]
