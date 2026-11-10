"""Phase 2 (AI/SaaS vision roadmap): Requirements Management foundation
(GAP-71 / PV-1) -- Requirement CRUD + immutable versioning mirroring
TestCase's shape, requirement<->test-case linking, and the RTM/coverage
report."""

from fastapi.testclient import TestClient


def _bootstrap_tenant(client: TestClient, platform_admin: dict) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Horizon Mutual",
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


def _create_test_case(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "Do X", "expected": "Y happens"}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup_admin_and_project(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def test_create_requirement_starts_at_version_one(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)

    response = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall calculate ACV on total loss", "description": "Per BRD FR-7"},
    )
    assert response.status_code == 200, response.text
    req = response.json()["data"]
    assert req["version_number"] == 1
    assert req["title"] == "System shall calculate ACV on total loss"
    assert req["linked_test_case_count"] == 0


def test_title_minimum_length_enforced(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    response = client.post(
        f"/api/v1/projects/{project_id}/requirements", json={"title": "abc", "description": ""}
    )
    assert response.status_code == 422


def test_editing_a_requirement_forks_a_new_immutable_version(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    created = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall calculate ACV on total loss", "description": "v1 text"},
    ).json()["data"]

    updated = client.patch(
        f"/api/v1/requirements/{created['id']}", json={"description": "v2 text, clarified"}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["version_number"] == 2
    assert updated.json()["data"]["description"] == "v2 text, clarified"

    versions = client.get(f"/api/v1/requirements/{created['id']}/versions").json()["data"]
    assert len(versions) == 2
    assert versions[0]["version_number"] == 2  # newest first
    assert versions[1]["description"] == "v1 text"  # original snapshot untouched


def test_tester_without_project_membership_cannot_view_or_create_requirements(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
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

    list_response = tester_client.get(f"/api/v1/projects/{project_id}/requirements")
    assert list_response.status_code == 403

    create_response = tester_client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall validate theft claims within 48h", "description": ""},
    )
    assert create_response.status_code == 403


def test_linking_and_unlinking_a_test_case_updates_coverage(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    req = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall validate theft claims within 48h", "description": ""},
    ).json()["data"]
    case = _create_test_case(client, project_id, "Verify 48h Theft Window")

    coverage_before = client.get(f"/api/v1/projects/{project_id}/requirements/coverage").json()[
        "data"
    ]
    assert coverage_before["total_requirements"] == 1
    assert coverage_before["covered_requirements"] == 0
    assert coverage_before["coverage_percentage"] == 0.0

    link = client.post(
        f"/api/v1/requirements/{req['id']}/test-cases", json={"test_case_id": case["id"]}
    )
    assert link.status_code == 200, link.text
    assert link.json()["data"]["linked_test_case_count"] == 1
    assert len(link.json()["data"]["linked_test_cases"]) == 1
    assert link.json()["data"]["linked_test_cases"][0]["test_case_id"] == case["id"]

    coverage_after = client.get(f"/api/v1/projects/{project_id}/requirements/coverage").json()[
        "data"
    ]
    assert coverage_after["covered_requirements"] == 1
    assert coverage_after["coverage_percentage"] == 100.0

    unlink = client.delete(f"/api/v1/requirements/{req['id']}/test-cases/{case['id']}")
    assert unlink.status_code == 200, unlink.text
    assert unlink.json()["data"]["linked_test_case_count"] == 0

    coverage_final = client.get(f"/api/v1/projects/{project_id}/requirements/coverage").json()[
        "data"
    ]
    assert coverage_final["covered_requirements"] == 0


def test_linking_a_test_case_from_a_different_project_is_rejected(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    other_project = _create_project(client, name="Other Project")
    req = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall validate theft claims within 48h", "description": ""},
    ).json()["data"]
    other_case = _create_test_case(client, other_project["id"], "Unrelated Case")

    response = client.post(
        f"/api/v1/requirements/{req['id']}/test-cases", json={"test_case_id": other_case["id"]}
    )
    assert response.status_code == 409


def test_tester_role_cannot_edit_requirement_even_when_assigned_to_the_project(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    req = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall validate theft claims within 48h", "description": ""},
    ).json()["data"]

    tester_id = client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    ).json()["data"]["id"]
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    # The Tester IS assigned to the project (so viewing works), but
    # requirement.manage is Admin/Manager-only regardless of assignment.
    view_response = tester_client.get(f"/api/v1/requirements/{req['id']}")
    assert view_response.status_code == 200, view_response.text

    edit_response = tester_client.patch(
        f"/api/v1/requirements/{req['id']}", json={"description": "attempted edit"}
    )
    assert edit_response.status_code == 403


def test_requirement_deletion_removes_its_links(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    req = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall validate theft claims within 48h", "description": ""},
    ).json()["data"]
    case = _create_test_case(client, project_id, "Verify 48h Theft Window")
    client.post(f"/api/v1/requirements/{req['id']}/test-cases", json={"test_case_id": case["id"]})

    delete_response = client.delete(f"/api/v1/requirements/{req['id']}")
    assert delete_response.status_code == 200, delete_response.text

    get_response = client.get(f"/api/v1/requirements/{req['id']}")
    assert get_response.status_code == 404


def test_requirements_are_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    req = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "System shall validate theft claims within 48h", "description": ""},
    ).json()["data"]

    other_client = TestClient(client.app)
    other_bootstrap = other_client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Summit Casualty",
            "admin_name": "Admin B",
            "admin_email": "admin@horizon.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    _login_and_verify(
        other_client, other_bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!"
    )

    cross_tenant_get = other_client.get(f"/api/v1/requirements/{req['id']}")
    assert cross_tenant_get.status_code == 404
