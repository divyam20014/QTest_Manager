"""Public marketing-site lead capture (POST /public/leads) and its
platform-admin-only review API (/platform/leads)."""

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.rate_limit import limiter
from tests.test_auth_flow import _bootstrap_tenant, _login_and_verify

_DEMO = {
    "kind": "demo",
    "full_name": "Morgan Hale",
    "business_email": "Morgan.Hale@example.com",
    "company": "Northwind Mutual",
    "job_role": "QA Manager",
    "team_size": "11-50",
    "primary_requirement": "Test management",
    "message": "We would like a walkthrough of execution reporting.",
    "source_page": "/request-demo",
}


def _lead_rows(owner_engine) -> list:
    with owner_engine.begin() as conn:
        return conn.execute(text("SELECT kind, business_email, status FROM marketing_leads")).all()


def test_valid_demo_request_is_stored(client: TestClient, owner_engine) -> None:
    response = client.post("/api/v1/public/leads", json=_DEMO)
    assert response.status_code == 201, response.text
    assert response.json()["data"] == {"received": True}
    rows = _lead_rows(owner_engine)
    assert len(rows) == 1
    assert rows[0].kind == "demo"
    assert rows[0].business_email == "morgan.hale@example.com"
    assert rows[0].status == "new"


def test_invalid_input_is_rejected(client: TestClient, owner_engine) -> None:
    bad_payloads = [
        {**_DEMO, "business_email": "not-an-email"},
        {**_DEMO, "full_name": "x"},
        {**_DEMO, "kind": "newsletter"},
        {**_DEMO, "message": "a" * 2001},
        {**_DEMO, "unexpected_field": "value"},
        {k: v for k, v in _DEMO.items() if k != "company"},
    ]
    for payload in bad_payloads:
        response = client.post("/api/v1/public/leads", json=payload)
        assert response.status_code == 422, (payload, response.text)
    assert _lead_rows(owner_engine) == []


def test_honeypot_submission_is_silently_dropped(client: TestClient, owner_engine) -> None:
    response = client.post("/api/v1/public/leads", json={**_DEMO, "website": "http://spam.example"})
    assert response.status_code == 201
    assert response.json()["data"] == {"received": True}
    assert _lead_rows(owner_engine) == []


def test_lead_submission_is_rate_limited(client: TestClient) -> None:
    limiter.enabled = True
    limiter.reset()
    try:
        statuses = [client.post("/api/v1/public/leads", json=_DEMO).status_code for _ in range(6)]
    finally:
        limiter.enabled = False
        limiter.reset()
    assert statuses[:5] == [201] * 5
    assert statuses[5] == 429


def test_platform_admin_can_list_filter_and_update(
    client: TestClient, platform_admin: dict
) -> None:
    auth = (platform_admin["email"], platform_admin["password"])
    client.post("/api/v1/public/leads", json=_DEMO)
    client.post(
        "/api/v1/public/leads",
        json={
            "kind": "contact",
            "full_name": "Riley Park",
            "business_email": "riley@example.com",
            "company": "Contoso QA",
        },
    )

    listing = client.get("/api/v1/platform/leads", auth=auth)
    assert listing.status_code == 200, listing.text
    data = listing.json()["data"]
    assert data["total"] == 2
    assert data["items"][0]["kind"] == "contact"  # newest first

    demos = client.get("/api/v1/platform/leads", params={"kind": "demo"}, auth=auth).json()["data"]
    assert [item["full_name"] for item in demos["items"]] == ["Morgan Hale"]

    lead_id = demos["items"][0]["id"]
    updated = client.patch(
        f"/api/v1/platform/leads/{lead_id}", json={"status": "contacted"}, auth=auth
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["status"] == "contacted"

    contacted = client.get(
        "/api/v1/platform/leads", params={"status": "contacted"}, auth=auth
    ).json()["data"]
    assert contacted["total"] == 1


def test_anonymous_and_tenant_users_cannot_read_leads(
    client: TestClient, platform_admin: dict
) -> None:
    client.post("/api/v1/public/leads", json=_DEMO)

    anon = TestClient(client.app)
    assert anon.get("/api/v1/platform/leads").status_code == 401

    bootstrap = _bootstrap_tenant(client, platform_admin, "Lead Probe Co")
    _login_and_verify(client, bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!")
    assert client.get("/api/v1/platform/leads").status_code == 401
    assert (
        client.patch(
            "/api/v1/platform/leads/00000000-0000-0000-0000-000000000000", json={"status": "closed"}
        ).status_code
        == 401
    )
