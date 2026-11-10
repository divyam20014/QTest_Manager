"""Tier 5 / ADR-055: tenant-defined custom fields for test cases, defects,
and requirements -- values read inline on each entity's GET, written only
through the dedicated values endpoint."""

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


def _create_case(
    client: TestClient, project_id: str, title: str = "Verify Deductible Math"
) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "Do thing", "expected": "Thing happens"}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_create_text_field_definition_and_set_value(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    case = _create_case(client, project_id)

    definition = client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "test_case",
            "field_key": "jira_ticket",
            "label": "Jira Ticket",
            "field_type": "text",
        },
    )
    assert definition.status_code == 200, definition.text

    set_response = client.put(
        f"/api/v1/custom-fields/values/test_case/{case['id']}",
        json={"values": {"jira_ticket": "QTH-123"}},
    )
    assert set_response.status_code == 200, set_response.text
    assert set_response.json()["data"]["values"]["jira_ticket"] == "QTH-123"

    fetched = client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]
    assert fetched["custom_fields"]["jira_ticket"] == "QTH-123"


def test_select_field_rejects_value_outside_its_options(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    case = _create_case(client, project_id)
    client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "test_case",
            "field_key": "region",
            "label": "Region",
            "field_type": "select",
            "options": ["NA", "EU", "APAC"],
        },
    )
    bad = client.put(
        f"/api/v1/custom-fields/values/test_case/{case['id']}", json={"values": {"region": "MARS"}}
    )
    assert bad.status_code == 422, bad.text

    good = client.put(
        f"/api/v1/custom-fields/values/test_case/{case['id']}", json={"values": {"region": "EU"}}
    )
    assert good.status_code == 200, good.text


def test_select_type_requires_non_empty_options(client: TestClient, platform_admin: dict) -> None:
    _setup(client, platform_admin)
    response = client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "test_case",
            "field_key": "region",
            "label": "Region",
            "field_type": "select",
        },
    )
    assert response.status_code == 422, response.text


def test_required_field_enforced_only_when_values_submitted(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup(client, platform_admin)
    case = _create_case(client, project_id)
    client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "test_case",
            "field_key": "owner_team",
            "label": "Owner Team",
            "field_type": "text",
            "required": True,
        },
    )
    # Creation itself never blocked on the missing required field.
    fetched = client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]
    assert fetched["custom_fields"]["owner_team"] is None

    missing = client.put(
        f"/api/v1/custom-fields/values/test_case/{case['id']}",
        json={"values": {"owner_team": None}},
    )
    assert missing.status_code == 422, missing.text


def test_custom_fields_are_scoped_per_entity_type(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup(client, platform_admin)
    case = _create_case(client, project_id)
    client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "defect",
            "field_key": "root_system",
            "label": "Root System",
            "field_type": "text",
        },
    )
    response = client.put(
        f"/api/v1/custom-fields/values/test_case/{case['id']}",
        json={"values": {"root_system": "Billing"}},
    )
    assert response.status_code == 422, response.text


def test_deleting_a_definition_removes_its_values(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup(client, platform_admin)
    case = _create_case(client, project_id)
    definition = client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "test_case",
            "field_key": "jira_ticket",
            "label": "Jira Ticket",
            "field_type": "text",
        },
    ).json()["data"]
    client.put(
        f"/api/v1/custom-fields/values/test_case/{case['id']}",
        json={"values": {"jira_ticket": "QTH-1"}},
    )

    deleted = client.delete(f"/api/v1/custom-fields/definitions/{definition['id']}")
    assert deleted.status_code == 200, deleted.text

    fetched = client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]
    assert fetched["custom_fields"] == {}


def test_custom_field_definitions_are_tenant_isolated(
    client: TestClient, platform_admin: dict
) -> None:
    _setup(client, platform_admin)
    client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "test_case",
            "field_key": "jira_ticket",
            "label": "Jira Ticket",
            "field_type": "text",
        },
    )
    other = TestClient(client.app)
    _setup(other, platform_admin, name="Second Tenant")
    other_defs = other.get("/api/v1/custom-fields/definitions?entity_type=test_case").json()["data"]
    assert other_defs == []


def test_requirement_supports_custom_fields_too(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup(client, platform_admin)
    client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "requirement",
            "field_key": "source_doc",
            "label": "Source Document",
            "field_type": "text",
        },
    )
    requirement = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={
            "title": "Policy must support endorsements",
            "description": "Mid-term endorsement support.",
        },
    )
    assert requirement.status_code == 200, requirement.text
    req_id = requirement.json()["data"]["id"]

    set_response = client.put(
        f"/api/v1/custom-fields/values/requirement/{req_id}",
        json={"values": {"source_doc": "BRD-12"}},
    )
    assert set_response.status_code == 200, set_response.text
    fetched = client.get(f"/api/v1/requirements/{req_id}").json()["data"]
    assert fetched["custom_fields"]["source_doc"] == "BRD-12"
