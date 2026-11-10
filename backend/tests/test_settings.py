"""Phase 1 (AI/SaaS vision roadmap): tenant self-service settings
(GAP-80 / SAAS-GAP-7) -- lets an Admin read/update the tenant's default
currency and timezone, previously fixed at tenant-provisioning time with
no edit path at all."""

from fastapi.testclient import TestClient


def _bootstrap_tenant(
    client: TestClient, platform_admin: dict, name: str = "Horizon Mutual"
) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
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


def test_admin_can_read_and_update_settings(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    initial = client.get("/api/v1/settings")
    assert initial.status_code == 200, initial.text
    assert initial.json()["data"] == {
        "default_currency_code": "USD",
        "default_timezone": "UTC",
        "ai_enabled": False,
        "ai_provider": "gemini",
        "ai_api_key_configured": False,
        "ip_allowlist": [],
    }

    updated = client.patch(
        "/api/v1/settings",
        json={"default_currency_code": "gbp", "default_timezone": "Europe/London"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["default_currency_code"] == "GBP"
    assert updated.json()["data"]["default_timezone"] == "Europe/London"

    refetched = client.get("/api/v1/settings")
    assert refetched.json()["data"]["default_currency_code"] == "GBP"
    assert refetched.json()["data"]["default_timezone"] == "Europe/London"


def test_invalid_currency_code_rejected(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    response = client.patch("/api/v1/settings", json={"default_currency_code": "US"})
    assert response.status_code == 422, response.text


def test_partial_update_leaves_other_field_unchanged(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    response = client.patch("/api/v1/settings", json={"default_timezone": "Asia/Kolkata"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["default_currency_code"] == "USD"
    assert response.json()["data"]["default_timezone"] == "Asia/Kolkata"


def test_non_admin_cannot_read_or_update_settings(client: TestClient, platform_admin: dict) -> None:
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

    assert tester_client.get("/api/v1/settings").status_code == 403
    assert (
        tester_client.patch("/api/v1/settings", json={"default_timezone": "UTC"}).status_code == 403
    )


def test_settings_update_is_tenant_isolated_and_audit_logged(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap_a = _bootstrap_tenant(client, platform_admin, name="Horizon Mutual")
    tenant_a_id = bootstrap_a["tenant"]["id"]
    _login_and_verify(client, tenant_a_id, "admin@horizon.com", "AdminPassw0rd!")
    client.patch("/api/v1/settings", json={"default_currency_code": "EUR"})

    other_client = TestClient(client.app)
    bootstrap_b = _bootstrap_tenant(other_client, platform_admin, name="Summit Casualty")
    tenant_b_id = bootstrap_b["tenant"]["id"]
    _login_and_verify(other_client, tenant_b_id, "admin@horizon.com", "AdminPassw0rd!")

    # Tenant B never touched its own settings -- must still see its own
    # untouched defaults, not tenant A's EUR update.
    tenant_b_settings = other_client.get("/api/v1/settings").json()["data"]
    assert tenant_b_settings["default_currency_code"] == "USD"

    logs = client.get("/api/v1/audit-logs", params={"action": "tenant.settings_updated"}).json()[
        "data"
    ]
    assert len(logs) == 1
    assert logs[0]["metadata"]["default_currency_code"] == {"from": "USD", "to": "EUR"}


def test_enabling_ai_without_an_api_key_is_rejected(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    response = client.patch("/api/v1/settings", json={"ai_enabled": True})
    assert response.status_code == 422, response.text


def test_setting_api_key_then_enabling_ai_succeeds_and_key_is_never_returned(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    with_key = client.patch("/api/v1/settings", json={"ai_api_key": "AIza-super-secret-key"})
    assert with_key.status_code == 200, with_key.text
    assert with_key.json()["data"]["ai_api_key_configured"] is True
    assert "AIza-super-secret-key" not in with_key.text

    enabled = client.patch("/api/v1/settings", json={"ai_enabled": True})
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["data"]["ai_enabled"] is True
    assert "AIza-super-secret-key" not in enabled.text

    refetched = client.get("/api/v1/settings")
    assert "AIza-super-secret-key" not in refetched.text
    assert refetched.json()["data"]["ai_api_key_configured"] is True


def test_clearing_api_key_disables_ai_capability(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    client.patch("/api/v1/settings", json={"ai_api_key": "AIza-super-secret-key"})
    client.patch("/api/v1/settings", json={"ai_enabled": True})

    cleared = client.patch("/api/v1/settings", json={"ai_api_key": ""})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["data"]["ai_api_key_configured"] is False
