from fastapi.testclient import TestClient


def _bootstrap_tenant(
    client: TestClient, platform_admin: dict, tenant_name: str = "Horizon Mutual"
) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": tenant_name,
            "admin_name": "Admin A",
            "admin_email": "admin@horizon.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": email, "password": password},
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]

    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text
    assert verify_response.json()["data"]["verified"] is True


def test_platform_requires_authentication(client: TestClient) -> None:
    response = client.post(
        "/api/v1/platform/tenants",
        json={
            "tenant_name": "No Auth Co",
            "admin_name": "X",
            "admin_email": "x@example.com",
            "admin_password": "Whatever123!",
        },
    )
    assert response.status_code == 401


def test_full_bootstrap_login_and_me(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    me_response = client.get("/api/v1/auth/me")
    assert me_response.status_code == 200
    me = me_response.json()["data"]
    assert me["email"] == "admin@horizon.com"
    assert me["role"] == "admin"
    assert me["tenant_id"] == tenant_id


def test_logout_revokes_session(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    logout_response = client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 200

    me_response = client.get("/api/v1/auth/me")
    assert me_response.status_code == 401


def test_wrong_password_is_generic_error(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Invalid tenant, email, or password"


def test_mfa_lockout_after_three_attempts(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    login_response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "AdminPassw0rd!"},
    )
    real_code = login_response.json()["data"]["debug_code"]
    wrong_code = "000000" if real_code != "000000" else "111111"

    for _ in range(3):
        resp = client.post("/api/v1/auth/mfa/verify", json={"code": wrong_code})
        assert resp.status_code == 401

    # Session is now revoked even with the correct code.
    final_attempt = client.post("/api/v1/auth/mfa/verify", json={"code": real_code})
    assert final_attempt.status_code == 401


def test_cross_tenant_isolation_on_user_list(client: TestClient, platform_admin: dict) -> None:
    tenant_a = _bootstrap_tenant(client, platform_admin, tenant_name="Tenant A")
    tenant_b_client = TestClient(client.app)
    tenant_b = _bootstrap_tenant(tenant_b_client, platform_admin, tenant_name="Tenant B")

    _login_and_verify(client, tenant_a["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!")
    users_a = client.get("/api/v1/users").json()["data"]
    assert {u["email"] for u in users_a} == {"admin@horizon.com"}
    assert tenant_b["tenant"]["id"] != tenant_a["tenant"]["id"]


def test_user_management_and_last_admin_guard(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    admin_id = bootstrap["admin_user_id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    create_response = client.post(
        "/api/v1/users",
        json={
            "email": "manager@horizon.com",
            "name": "Manager One",
            "role": "manager",
            "password": "ManagerPassw0rd!",
        },
    )
    assert create_response.status_code == 200, create_response.text
    manager_id = create_response.json()["data"]["id"]

    # Deactivating the sole Admin must be blocked (FR-ADM-001).
    guard_response = client.delete(f"/api/v1/users/{admin_id}")
    assert guard_response.status_code == 409

    # Deactivating a non-admin user is fine.
    deactivate_response = client.delete(f"/api/v1/users/{manager_id}")
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["data"]["is_active"] is False

    # Duplicate email within the tenant is rejected.
    dup_response = client.post(
        "/api/v1/users",
        json={
            "email": "admin@horizon.com",
            "name": "Duplicate",
            "role": "tester",
            "password": "AnotherPassw0rd!",
        },
    )
    assert dup_response.status_code == 409


def test_gdpr_erase_pseudonymizes_pii(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    create_response = client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    tester_id = create_response.json()["data"]["id"]

    erase_response = client.post(f"/api/v1/users/{tester_id}/gdpr-erase")
    assert erase_response.status_code == 200
    erased = erase_response.json()["data"]
    assert erased["name"].startswith("user_")
    assert erased["email"].endswith("@erased.invalid")
    assert erased["is_active"] is False
