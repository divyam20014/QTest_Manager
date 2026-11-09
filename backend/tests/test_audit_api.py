"""Phase 10.8: the /audit-logs admin read surface (BR-13's remaining gap --
the dashboard's activity stream already existed, but there was no
dedicated, filterable, Admin-only endpoint over the full chain)."""

from fastapi.testclient import TestClient


def _bootstrap_tenant(client: TestClient, platform_admin: dict) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Horizon Mutual",
            "admin_name": "Admin A",
            "admin_email": "admin@horizon.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def test_admin_can_list_and_filter_audit_logs(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    client.post(
        "/api/v1/users",
        json={
            "email": "manager@horizon.com",
            "name": "Manager One",
            "role": "manager",
            "password": "ManagerPassw0rd!",
        },
    )

    all_logs = client.get("/api/v1/audit-logs").json()["data"]
    assert len(all_logs) >= 2  # tenant bootstrap + user creation, at minimum

    user_created = client.get(
        "/api/v1/audit-logs", params={"action": "user.created"}
    ).json()["data"]
    # One row for the tenant-bootstrap admin itself, one for the manager
    # just created above -- most recent first.
    assert len(user_created) == 2
    assert user_created[0]["action"] == "user.created"
    assert user_created[0]["user_name"] == "Admin A"


def test_tester_cannot_view_audit_logs(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    forbidden = tester_client.get("/api/v1/audit-logs")
    assert forbidden.status_code == 403


def test_verify_chain_reports_valid_for_untampered_log(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    client.post(
        "/api/v1/users",
        json={
            "email": "manager@horizon.com",
            "name": "Manager One",
            "role": "manager",
            "password": "ManagerPassw0rd!",
        },
    )

    result = client.get("/api/v1/audit-logs/verify-chain").json()["data"]
    assert result["valid"] is True
    assert result["checked_count"] >= 2
    assert result["broken_at_id"] is None
