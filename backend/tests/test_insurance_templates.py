"""Tier 5 / ADR-055 / PV-10.1: Insurance QA Pack template library."""

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


def test_list_templates_returns_all_three_categories(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    templates = client.get("/api/v1/templates").json()["data"]
    assert {t["category"] for t in templates} == {"Claims", "Underwriting", "Policy Admin"}
    assert len(templates) >= 10


def test_import_creates_test_cases_and_modules(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup(client, platform_admin)
    templates = client.get("/api/v1/templates").json()["data"]
    claims_ids = [t["id"] for t in templates if t["category"] == "Claims"][:2]

    result = client.post(
        f"/api/v1/projects/{project_id}/templates/import", json={"template_ids": claims_ids}
    )
    assert result.status_code == 200, result.text
    body = result.json()["data"]
    assert len(body["imported_test_case_ids"]) == 2
    assert body["modules_created"] == ["Claims"]

    modules = client.get(f"/api/v1/projects/{project_id}/modules").json()["data"]
    claims_module = next(m for m in modules if m["name"] == "Claims")
    assert claims_module["test_case_count"] == 2


def test_reimporting_creates_a_second_copy_not_an_error(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    templates = client.get("/api/v1/templates").json()["data"]
    template_id = next(t["id"] for t in templates if t["category"] == "Underwriting")

    first = client.post(
        f"/api/v1/projects/{project_id}/templates/import", json={"template_ids": [template_id]}
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/v1/projects/{project_id}/templates/import", json={"template_ids": [template_id]}
    )
    assert second.status_code == 200, second.text
    assert second.json()["data"]["modules_created"] == []  # module already existed

    modules = client.get(f"/api/v1/projects/{project_id}/modules").json()["data"]
    underwriting_module = next(m for m in modules if m["name"] == "Underwriting")
    assert underwriting_module["test_case_count"] == 2


def test_unknown_template_id_is_rejected(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup(client, platform_admin)
    response = client.post(
        f"/api/v1/projects/{project_id}/templates/import",
        json={"template_ids": ["not-a-real-template"]},
    )
    assert response.status_code == 422, response.text


def test_imported_cases_land_only_in_the_importing_tenant(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    templates = client.get("/api/v1/templates").json()["data"]
    template_id = next(t["id"] for t in templates if t["category"] == "Policy Admin")
    client.post(
        f"/api/v1/projects/{project_id}/templates/import", json={"template_ids": [template_id]}
    )

    other = TestClient(client.app)
    _, other_project_id = _setup(other, platform_admin, name="Second Tenant")
    other_modules = other.get(f"/api/v1/projects/{other_project_id}/modules").json()["data"]
    assert other_modules == []
