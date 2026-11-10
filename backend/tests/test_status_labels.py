"""Tier 5 / ADR-055: additive status display-label overlay -- the fixed
status codes and their transition logic (reopen counter, review workflow)
are untouched; only what a status is *called* can be customized."""

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


def _create_project(client: TestClient, name: str = "Apex Motor Claims") -> dict:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "450000.00",
            "region": "North America",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup(
    client: TestClient, platform_admin: dict, name: str = "Horizon Mutual"
) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin, name=name)
    tenant_id = bootstrap["tenant"]["id"]
    admin_email = f"admin@{name.lower().replace(' ', '')}.com"
    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def test_unset_status_label_returns_the_built_in_label(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    labels = client.get("/api/v1/status-labels?entity_type=defect").json()["data"]
    assert {entry["status_code"]: entry["label"] for entry in labels}["Closed"] == "Closed"


def test_admin_can_override_and_reset_a_status_label(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    override = client.put(
        "/api/v1/status-labels",
        json={"entity_type": "defect", "status_code": "Closed", "label": "Resolved"},
    )
    assert override.status_code == 200, override.text
    assert override.json()["data"]["label"] == "Resolved"

    labels = client.get("/api/v1/status-labels?entity_type=defect").json()["data"]
    assert {entry["status_code"]: entry["label"] for entry in labels}["Closed"] == "Resolved"

    reset = client.put(
        "/api/v1/status-labels",
        json={"entity_type": "defect", "status_code": "Closed", "label": None},
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["data"]["label"] == "Closed"


def test_invalid_status_code_is_rejected(client: TestClient, platform_admin: dict) -> None:
    _setup(client, platform_admin)
    response = client.put(
        "/api/v1/status-labels",
        json={"entity_type": "defect", "status_code": "NotARealStatus", "label": "Whatever"},
    )
    assert response.status_code == 422, response.text


def test_label_customization_does_not_affect_reopen_counter_logic(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    client.put(
        "/api/v1/status-labels",
        json={"entity_type": "defect", "status_code": "Closed", "label": "Resolved"},
    )

    defect = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": "Renamed status defect", "severity": "High"},
    ).json()["data"]
    for status in ("Open", "Fixed", "Verified"):
        r = client.patch(f"/api/v1/defects/{defect['id']}/status", json={"status": status})
        assert r.status_code == 200, r.text
    close = client.patch(
        f"/api/v1/defects/{defect['id']}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )
    assert close.status_code == 200, close.text
    assert close.json()["data"]["status_label"] == "Resolved"

    reopened = client.post(f"/api/v1/defects/{defect['id']}/reopen")
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["data"]["status"] == "Open"
    assert reopened.json()["data"]["reopened_count"] == 1
