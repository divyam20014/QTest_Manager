"""Tier 0 / ADR-052: platform-admin brute-force lockout and audit
attribution on the existing HTTP Basic plane (a full session+MFA
replacement was deliberately deferred -- see ADR-052)."""

from fastapi.testclient import TestClient
from sqlalchemy import text


def _create_tenant(client: TestClient, platform_admin: dict) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Lockout Test Co",
            "admin_name": "Admin A",
            "admin_email": "admin@lockout.example.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_failed_logins_lock_the_platform_admin_account(
    client: TestClient, platform_admin: dict
) -> None:
    for _ in range(5):
        response = client.post(
            "/api/v1/platform/tenants",
            auth=(platform_admin["email"], "WrongPassword1!"),
            json={
                "tenant_name": "x",
                "admin_name": "x",
                "admin_email": "x@example.com",
                "admin_password": "x",
            },
        )
        assert response.status_code == 401

    # The 6th attempt, even with the CORRECT password, is rejected because
    # the account is now locked.
    locked_response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "x",
            "admin_name": "x",
            "admin_email": "x@example.com",
            "admin_password": "x",
        },
    )
    assert locked_response.status_code == 401
    assert "locked" in locked_response.json()["error"]["message"].lower()


def test_successful_login_resets_failed_count(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    for _ in range(3):
        client.post(
            "/api/v1/platform/tenants",
            auth=(platform_admin["email"], "WrongPassword1!"),
            json={
                "tenant_name": "x",
                "admin_name": "x",
                "admin_email": "x@example.com",
                "admin_password": "x",
            },
        )

    ok_response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Reset Test Co",
            "admin_name": "Admin A",
            "admin_email": "admin@reset.example.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
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
