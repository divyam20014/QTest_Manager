"""Tier 5 / ADR-055: tenant-configurable severity/priority value sets."""

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


def test_new_tenant_is_seeded_with_the_four_default_options(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    severities = client.get("/api/v1/field-options?field_key=defect_severity").json()["data"]
    priorities = client.get("/api/v1/field-options?field_key=test_case_priority").json()["data"]
    assert {o["code"] for o in severities} == {"Low", "Medium", "High", "Critical"}
    assert {o["code"] for o in priorities} == {"Low", "Medium", "High", "Critical"}


def test_admin_can_add_a_custom_severity_and_use_it(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    created = client.post(
        "/api/v1/field-options",
        json={"field_key": "defect_severity", "code": "Blocker", "label": "Blocker"},
    )
    assert created.status_code == 200, created.text

    defect = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": "Crash on submit", "severity": "Blocker"},
    )
    assert defect.status_code == 200, defect.text
    assert defect.json()["data"]["severity"] == "Blocker"


def test_defect_creation_rejects_an_unconfigured_severity(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    defect = client.post(
        "/api/v1/defects",
        json={
            "project_id": project_id,
            "title": "Bogus severity defect",
            "severity": "Catastrophic",
        },
    )
    assert defect.status_code == 422, defect.text


def test_cannot_delete_an_option_still_in_use(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup(client, platform_admin)
    client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": "Uses Critical", "severity": "Critical"},
    )
    options = client.get("/api/v1/field-options?field_key=defect_severity").json()["data"]
    critical = next(o for o in options if o["code"] == "Critical")

    response = client.delete(f"/api/v1/field-options/{critical['id']}")
    assert response.status_code == 409, response.text


def test_cannot_delete_the_last_remaining_option(client: TestClient, platform_admin: dict) -> None:
    _setup(client, platform_admin)
    options = client.get("/api/v1/field-options?field_key=test_case_priority").json()["data"]
    for o in options[:-1]:
        resp = client.delete(f"/api/v1/field-options/{o['id']}")
        assert resp.status_code == 200, resp.text

    last = options[-1]
    response = client.delete(f"/api/v1/field-options/{last['id']}")
    assert response.status_code == 422, response.text


def test_field_options_are_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    _setup(client, platform_admin)
    client.post(
        "/api/v1/field-options",
        json={"field_key": "defect_severity", "code": "Blocker", "label": "Blocker"},
    )

    other = TestClient(client.app)
    _setup(other, platform_admin, name="Second Tenant")
    other_options = other.get("/api/v1/field-options?field_key=defect_severity").json()["data"]
    assert "Blocker" not in {o["code"] for o in other_options}


def test_setting_permission_required_to_manage_options(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, _ = _setup(client, platform_admin)
    tester_create = client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizonmutual.com",
            "name": "Tess Tester",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    assert tester_create.status_code == 200, tester_create.text

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizonmutual.com", "TesterPassw0rd!")
    response = tester_client.post(
        "/api/v1/field-options",
        json={"field_key": "defect_severity", "code": "Blocker", "label": "Blocker"},
    )
    assert response.status_code == 403, response.text
