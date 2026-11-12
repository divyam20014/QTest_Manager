"""ADR-067: tenant-less login's identity-resolution step (POST
/auth/identify). Lets a user resolve which tenant(s) their email belongs
to before typing a tenant_id -- the existing POST /auth/login and MFA
verify flow is unchanged and still requires tenant_id, which the frontend
now supplies from this endpoint's result rather than from the user."""

from fastapi.testclient import TestClient

from app.core.rate_limit import limiter


def _bootstrap_tenant(
    client: TestClient, platform_admin: dict, tenant_name: str, admin_email: str
) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": tenant_name,
            "admin_name": "Admin",
            "admin_email": admin_email,
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_identify_single_match(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin, "Horizon Mutual", "admin@horizon.com")
    tenant_id = bootstrap["tenant"]["id"]

    response = client.post("/api/v1/auth/identify", json={"email": "admin@horizon.com"})
    assert response.status_code == 200, response.text
    matches = response.json()["data"]["matches"]
    assert matches == [{"tenant_id": tenant_id, "tenant_name": "Horizon Mutual"}]


def test_identify_no_match_returns_empty_list_not_error(client: TestClient) -> None:
    """Must never 404/distinguish "no such email" from any other outcome --
    that would let the UI layer enumerate registered emails."""
    response = client.post("/api/v1/auth/identify", json={"email": "nobody@example.com"})
    assert response.status_code == 200
    assert response.json()["data"]["matches"] == []


def test_identify_multiple_matches_across_tenants(client: TestClient, platform_admin: dict) -> None:
    """Same email can legitimately exist under two different tenants
    (ADR-017: email is unique per-tenant, not globally) -- the picker case."""
    tenant_a = _bootstrap_tenant(client, platform_admin, "Tenant A", "shared@example.com")

    client_b = TestClient(client.app)
    tenant_b = _bootstrap_tenant(client_b, platform_admin, "Tenant B", "shared@example.com")

    response = client.post("/api/v1/auth/identify", json={"email": "shared@example.com"})
    assert response.status_code == 200, response.text
    matches = response.json()["data"]["matches"]
    assert {m["tenant_id"] for m in matches} == {
        tenant_a["tenant"]["id"],
        tenant_b["tenant"]["id"],
    }
    assert {m["tenant_name"] for m in matches} == {"Tenant A", "Tenant B"}


def test_identify_excludes_deactivated_user(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin, "Horizon Mutual", "admin@horizon.com")
    tenant_id = bootstrap["tenant"]["id"]
    admin_id = bootstrap["admin_user_id"]

    login_response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "AdminPassw0rd!"},
    )
    code = login_response.json()["data"]["debug_code"]
    client.post("/api/v1/auth/mfa/verify", json={"code": code})

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
    client.delete(f"/api/v1/users/{tester_id}")

    response = client.post("/api/v1/auth/identify", json={"email": "tester@horizon.com"})
    assert response.status_code == 200
    assert response.json()["data"]["matches"] == []

    # Sanity: the still-active admin in the same tenant is unaffected.
    response = client.post("/api/v1/auth/identify", json={"email": "admin@horizon.com"})
    assert response.json()["data"]["matches"] == [
        {"tenant_id": tenant_id, "tenant_name": "Horizon Mutual"}
    ]
    assert admin_id  # bootstrap returned a real admin id, not used further here


def test_identify_is_rate_limited_tighter_than_login(client: TestClient) -> None:
    limiter.enabled = True
    limiter.reset()
    try:
        responses = [
            client.post("/api/v1/auth/identify", json={"email": "nobody@example.com"})
            for _ in range(9)
        ]
    finally:
        limiter.enabled = False
        limiter.reset()

    statuses = [r.status_code for r in responses]
    assert statuses[:8] == [200] * 8
    assert statuses[8] == 429
    assert responses[8].json()["error"]["code"] == "rate_limited"
