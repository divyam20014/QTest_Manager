"""Tier 1 / ADR-053: subscription/billing schema (SR-3, SAAS-GAP-1).
Schema + platform-admin assignment only -- no payment gateway."""

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
            "admin_email": f"admin@{name.lower().replace(' ', '')}.com",
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


def test_new_tenant_has_a_default_trial_subscription(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    response = client.get(
        f"/api/v1/platform/tenants/{tenant_id}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["plan"]["code"] == "trial"
    assert data["status"] == "trialing"


def test_platform_admin_can_assign_a_subscription(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    response = client.put(
        f"/api/v1/platform/tenants/{tenant_id}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"plan_code": "standard", "status": "active", "seat_count": 10},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["plan"]["code"] == "standard"
    assert data["status"] == "active"
    assert data["seat_count"] == 10


def test_assigning_an_unknown_plan_code_fails(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    response = client.put(
        f"/api/v1/platform/tenants/{tenant_id}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"plan_code": "nonexistent", "status": "active", "seat_count": 1},
    )
    assert response.status_code == 422, response.text


def test_tenant_admin_can_read_but_not_assign_their_own_subscription(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizonmutual.com", "AdminPassw0rd!")

    response = client.get("/api/v1/settings/subscription")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["plan"]["code"] == "trial"

    # No tenant-facing write endpoint exists at all -- assignment is
    # platform-admin-only, enforced by there being no PATCH/PUT route
    # under /settings/subscription.
    response = client.put("/api/v1/settings/subscription", json={"plan_code": "standard"})
    assert response.status_code == 405


def test_subscriptions_are_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    tenant_a = _bootstrap_tenant(client, platform_admin, "Horizon Mutual")
    tenant_b = _bootstrap_tenant(client, platform_admin, "Apex Insurance")

    client.put(
        f"/api/v1/platform/tenants/{tenant_a['tenant']['id']}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"plan_code": "standard", "status": "active", "seat_count": 5},
    )

    response = client.get(
        f"/api/v1/platform/tenants/{tenant_b['tenant']['id']}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
    )
    assert response.status_code == 200, response.text
    # Tenant B's own default Trial subscription is unaffected by Tenant A's
    # assignment.
    assert response.json()["data"]["plan"]["code"] == "trial"
