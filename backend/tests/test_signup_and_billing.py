"""Pass 2 / ADR-064: self-service signup + self-serve plan browsing/
switching (schema + UI only -- no payment gateway, confirmed scope)."""

from fastapi.testclient import TestClient

from app.core.rate_limit import limiter


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _signup(client: TestClient, tenant_name: str, admin_email: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "tenant_name": tenant_name,
            "admin_name": "Jamie Founder",
            "admin_email": admin_email,
            "admin_password": "FoundingAdmin1!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_signup_creates_working_tenant_with_sample_project_and_trial_subscription(
    client: TestClient,
) -> None:
    data = _signup(client, "Brand New Co", "founder@brandnew.com")
    tenant_id = data["tenant"]["id"]

    _login_and_verify(client, tenant_id, "founder@brandnew.com", "FoundingAdmin1!")

    projects = client.get("/api/v1/projects")
    assert projects.status_code == 200
    names = [p["name"] for p in projects.json()["data"]["items"]]
    assert "Sample Project — Getting Started" in names

    sub = client.get("/api/v1/settings/subscription")
    assert sub.status_code == 200
    assert sub.json()["data"]["plan"]["code"] == "trial"


def test_signup_sample_project_never_leaks_across_tenants(client: TestClient) -> None:
    data_a = _signup(client, "Tenant Alpha Co", "alpha@alpha.com")
    _login_and_verify(client, data_a["tenant"]["id"], "alpha@alpha.com", "FoundingAdmin1!")
    projects_a = client.get("/api/v1/projects").json()["data"]["items"]
    assert len(projects_a) == 1

    client.post("/api/v1/auth/logout")

    data_b = _signup(client, "Tenant Beta Co", "beta@beta.com")
    _login_and_verify(client, data_b["tenant"]["id"], "beta@beta.com", "FoundingAdmin1!")
    projects_b = client.get("/api/v1/projects").json()["data"]["items"]
    assert len(projects_b) == 1
    assert projects_b[0]["id"] != projects_a[0]["id"]


def test_signup_rejects_weak_password(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "tenant_name": "Weak Pass Co",
            "admin_name": "A",
            "admin_email": "weak@weak.com",
            "admin_password": "short",
        },
    )
    assert response.status_code == 422


def test_signup_is_rate_limited_after_five_attempts_per_hour(client: TestClient) -> None:
    limiter.enabled = True
    limiter.reset()
    try:
        responses = [
            client.post(
                "/api/v1/auth/signup",
                json={
                    "tenant_name": f"Rate Co {i}",
                    "admin_name": "A",
                    "admin_email": f"rate{i}@rate.com",
                    "admin_password": "FoundingAdmin1!",
                },
            )
            for i in range(6)
        ]
    finally:
        limiter.enabled = False
        limiter.reset()

    statuses = [r.status_code for r in responses]
    assert statuses[:5] == [200] * 5
    assert statuses[5] == 429


def test_new_admin_can_log_in_after_signup(client: TestClient) -> None:
    data = _signup(client, "Login Check Co", "logincheck@example.com")
    tenant_id = data["tenant"]["id"]
    _login_and_verify(client, tenant_id, "logincheck@example.com", "FoundingAdmin1!")
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["data"]["email"] == "logincheck@example.com"


def test_tenant_can_list_available_plans(client: TestClient) -> None:
    data = _signup(client, "Plan List Co", "planlist@example.com")
    _login_and_verify(client, data["tenant"]["id"], "planlist@example.com", "FoundingAdmin1!")
    response = client.get("/api/v1/settings/subscription/plans")
    assert response.status_code == 200
    codes = {p["code"] for p in response.json()["data"]}
    assert {"trial", "standard"}.issubset(codes)


def test_tenant_can_switch_plan_and_it_is_audit_logged(client: TestClient) -> None:
    data = _signup(client, "Switch Co", "switch@example.com")
    tenant_id = data["tenant"]["id"]
    _login_and_verify(client, tenant_id, "switch@example.com", "FoundingAdmin1!")

    response = client.post(
        "/api/v1/settings/subscription/switch-plan", json={"plan_code": "standard"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["plan"]["code"] == "standard"

    history = client.get("/api/v1/settings/subscription/history")
    assert history.status_code == 200
    actions = [h["action"] for h in history.json()["data"]]
    assert "subscription.plan_switched" in actions


def test_switching_to_a_plan_below_current_seat_count_is_blocked(
    client: TestClient, platform_admin: dict
) -> None:
    """A plan with seat_limit=1 and a tenant that already has 2 active
    users (the admin + one invited) cannot switch to it -- blocked (409),
    not silently allowed to later break seat creation."""
    data = _signup(client, "Seat Block Co", "seatblock@example.com")
    tenant_id = data["tenant"]["id"]
    _login_and_verify(client, tenant_id, "seatblock@example.com", "FoundingAdmin1!")

    plan_response = client.put(
        f"/api/v1/platform/tenants/{tenant_id}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"plan_code": "standard", "status": "active", "seat_count": 1},
    )
    assert plan_response.status_code == 200, plan_response.text

    create_plan = client.post(
        "/api/v1/platform/plans",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"code": "solo-seat-block-co", "name": "Solo", "seat_limit": 1},
    )
    assert create_plan.status_code == 200, create_plan.text

    client.post(
        "/api/v1/users",
        json={
            "email": "second@seatblock.com",
            "name": "Second User",
            "role": "tester",
            "password": "SecondUser1!",
        },
    )

    switch_response = client.post(
        "/api/v1/settings/subscription/switch-plan", json={"plan_code": "solo-seat-block-co"}
    )
    assert switch_response.status_code == 409, switch_response.text


def test_subscription_usage_reflects_real_seat_and_storage_counts(client: TestClient) -> None:
    data = _signup(client, "Usage Co", "usage@example.com")
    _login_and_verify(client, data["tenant"]["id"], "usage@example.com", "FoundingAdmin1!")

    usage = client.get("/api/v1/settings/subscription/usage")
    assert usage.status_code == 200
    body = usage.json()["data"]
    assert body["seat_count"] == 1
    assert body["storage_used_mb"] == 0.0
    assert body["ai_requests_this_period"] == 0
