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


def test_mfa_verification_rotates_session_id(client: TestClient, platform_admin: dict) -> None:
    """Deployment-hardening pass: the pre-MFA session cookie must never still
    work for authenticated requests after MFA succeeds -- its id is rotated,
    not just a flag flipped on the same row (session-fixation mitigation)."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    login_response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "AdminPassw0rd!"},
    )
    pre_mfa_cookie = login_response.cookies.get("qth_session")
    code = login_response.json()["data"]["debug_code"]

    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200
    post_mfa_cookie = verify_response.cookies.get("qth_session")

    assert post_mfa_cookie is not None
    assert post_mfa_cookie != pre_mfa_cookie

    # The post-MFA cookie is now active in the client's jar; a request
    # presenting the old pre-MFA id explicitly must be rejected as revoked.
    stale_response = client.get("/api/v1/auth/me", cookies={"qth_session": pre_mfa_cookie})
    assert stale_response.status_code == 401


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

    # Reactivating a deactivated user is supported via the same PATCH.
    reactivate_response = client.patch(
        f"/api/v1/users/{manager_id}", json={"is_active": True}
    )
    assert reactivate_response.status_code == 200
    assert reactivate_response.json()["data"]["is_active"] is True


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


def test_manager_can_list_users_but_tester_cannot(client: TestClient, platform_admin: dict) -> None:
    """ADR-028: a Manager needs the tenant's user directory to allocate
    project members (FR-PROJ-002); Tester still cannot."""
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
    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")
    manager_list = manager_client.get("/api/v1/users")
    assert manager_list.status_code == 200
    assert len(manager_list.json()["data"]) == 3

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    tester_list = tester_client.get("/api/v1/users")
    assert tester_list.status_code == 403


def test_list_sessions_shows_current_and_others(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    # A second login as the same user opens a second, independent session.
    other_client = TestClient(client.app)
    _login_and_verify(other_client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    sessions = client.get("/api/v1/auth/sessions").json()["data"]["sessions"]
    assert len(sessions) == 2
    assert sum(1 for s in sessions if s["is_current"]) == 1


def test_revoke_other_session_logs_it_out(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    other_client = TestClient(client.app)
    _login_and_verify(other_client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    sessions = client.get("/api/v1/auth/sessions").json()["data"]["sessions"]
    other_session_id = next(s["id"] for s in sessions if not s["is_current"])

    revoke_response = client.delete(f"/api/v1/auth/sessions/{other_session_id}")
    assert revoke_response.status_code == 200, revoke_response.text

    # The now-revoked session can no longer make authenticated requests.
    stale_response = other_client.get("/api/v1/auth/me")
    assert stale_response.status_code == 401

    remaining = client.get("/api/v1/auth/sessions").json()["data"]["sessions"]
    assert len(remaining) == 1
    assert remaining[0]["is_current"] is True


def test_cannot_revoke_own_current_session_via_endpoint(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    current_session_id = client.cookies.get("qth_session")
    response = client.delete(f"/api/v1/auth/sessions/{current_session_id}")
    assert response.status_code == 409

    # Logout still works as the documented alternative.
    assert client.post("/api/v1/auth/logout").status_code == 200


def test_cannot_revoke_another_users_session(client: TestClient, platform_admin: dict) -> None:
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
    tester_session_id = tester_client.cookies.get("qth_session")

    response = client.delete(f"/api/v1/auth/sessions/{tester_session_id}")
    assert response.status_code == 404

    # The tester's own session is still valid.
    assert tester_client.get("/api/v1/auth/me").status_code == 200
