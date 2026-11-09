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


def test_audit_log_response_includes_metadata_and_prev_hash(
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

    created = client.get(
        "/api/v1/audit-logs", params={"action": "user.created"}
    ).json()["data"]
    row = next(r for r in created if r["metadata"]["email"] == "manager@horizon.com")
    assert row["metadata"] == {"email": "manager@horizon.com", "role": "manager"}
    assert len(row["prev_hash"]) == 64
    assert row["tenant_id"] == tenant_id


def test_audit_logs_filter_by_entity_id_and_date_range(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    created = client.post(
        "/api/v1/users",
        json={
            "email": "manager@horizon.com",
            "name": "Manager One",
            "role": "manager",
            "password": "ManagerPassw0rd!",
        },
    ).json()["data"]
    manager_id = created["id"]

    by_entity = client.get(
        "/api/v1/audit-logs", params={"entity_id": manager_id}
    ).json()["data"]
    assert len(by_entity) == 1
    assert by_entity[0]["entity_id"] == manager_id

    future_only = client.get(
        "/api/v1/audit-logs", params={"date_from": "2999-01-01T00:00:00Z"}
    ).json()["data"]
    assert future_only == []

    all_time = client.get(
        "/api/v1/audit-logs", params={"date_from": "2000-01-01T00:00:00Z"}
    ).json()["data"]
    assert len(all_time) >= 2


def test_audit_logs_export_csv_contains_header_and_rows(
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

    response = client.get("/api/v1/audit-logs/export", params={"action": "user.created"})
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    text = response.text
    assert "Audit ID" in text
    assert "Previous Hash" in text
    assert "manager@horizon.com" in text


def test_tester_cannot_export_audit_logs(client: TestClient, platform_admin: dict) -> None:
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

    forbidden = tester_client.get("/api/v1/audit-logs/export")
    assert forbidden.status_code == 403


def test_user_can_view_own_account_history_without_audit_permission(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    created = client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    ).json()["data"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    history = tester_client.get("/api/v1/users/me/history").json()["data"]
    actions = {entry["action"] for entry in history}
    # Every event recorded against the tester's own `user` entity: its
    # creation, plus its own login/MFA events (also entity_type="user").
    assert "user.created" in actions
    assert "auth.login_attempted" in actions
    assert "auth.mfa_verified" in actions
    assert all(entry["entity_id"] == created["id"] for entry in history)

    # Scoped to self only -- never returns another user's history.
    admin_only_action = client.get(
        "/api/v1/audit-logs", params={"action": "user.created"}
    ).json()["data"]
    assert len(admin_only_action) >= 2  # sanity: more exist tenant-wide than this user's own
