from fastapi.testclient import TestClient


def _bootstrap_tenant(
    client: TestClient, platform_admin: dict, name: str = "Horizon Mutual Shared Steps"
) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
            "admin_name": "Admin A",
            "admin_email": "admin@sharedsteps.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": email, "password": password},
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _create_project(client: TestClient, name: str = "Shared Steps Project") -> dict:
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


def _setup_admin_and_project(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@sharedsteps.com", "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def test_create_list_update_delete_shared_step(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)

    create = client.post(
        f"/api/v1/projects/{project_id}/shared-steps",
        json={
            "name": "Log in as admin",
            "action": "Navigate to login and enter admin credentials",
            "expected": "Dashboard loads",
            "category": "Auth",
        },
    )
    assert create.status_code == 200, create.text
    step = create.json()["data"]
    assert step["name"] == "Log in as admin"

    listed = client.get(f"/api/v1/projects/{project_id}/shared-steps").json()["data"]
    assert len(listed) == 1
    assert listed[0]["id"] == step["id"]

    updated = client.patch(
        f"/api/v1/shared-steps/{step['id']}", json={"action": "Updated action text"}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["data"]["action"] == "Updated action text"
    assert updated.json()["data"]["expected"] == "Dashboard loads"

    deleted = client.delete(f"/api/v1/shared-steps/{step['id']}")
    assert deleted.status_code == 200

    listed_after = client.get(f"/api/v1/projects/{project_id}/shared-steps").json()["data"]
    assert listed_after == []


def test_editing_library_entry_does_not_retroactively_change_an_already_inserted_copy(
    client: TestClient, platform_admin: dict
) -> None:
    """The core design invariant of this feature: inserting copies text at
    that moment; the library entry and the test case step are independent
    afterward. Simulated here at the API level the same way the frontend
    does it -- create a shared step, read its current text, then use that
    text (a copy) when creating the test case. Editing the library entry
    afterward must never change the already-created test case's step."""
    _, project_id = _setup_admin_and_project(client, platform_admin)

    shared = client.post(
        f"/api/v1/projects/{project_id}/shared-steps",
        json={
            "name": "Open settings",
            "action": "Click Settings",
            "expected": "Settings page shown",
        },
    ).json()["data"]

    # "Insert from library" == copy the current text into a new test case's step.
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Uses a shared step",
            "priority": "High",
            "steps": [{"action": shared["action"], "expected": shared["expected"]}],
        },
    )
    assert case.status_code == 200, case.text
    case_id = case.json()["data"]["id"]

    # Now edit the library entry.
    client.patch(
        f"/api/v1/shared-steps/{shared['id']}",
        json={"action": "Click Settings (EDITED)", "expected": "Settings page shown (EDITED)"},
    )

    fetched_case = client.get(f"/api/v1/test-cases/{case_id}").json()["data"]
    assert fetched_case["steps"][0]["action"] == "Click Settings"
    assert fetched_case["steps"][0]["expected"] == "Settings page shown"

    fetched_shared = client.get(f"/api/v1/projects/{project_id}/shared-steps").json()["data"][0]
    assert fetched_shared["action"] == "Click Settings (EDITED)"


def test_shared_step_tenant_isolation(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    client.post(
        f"/api/v1/projects/{project_id}/shared-steps",
        json={"name": "Tenant A Step", "action": "a", "expected": "b"},
    )

    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(
        other_client, platform_admin, name="Other Insurer Shared Steps"
    )
    other_tenant_id = other_bootstrap["tenant"]["id"]
    _login_and_verify(other_client, other_tenant_id, "admin@sharedsteps.com", "AdminPassw0rd!")
    other_project = _create_project(other_client, name="Other Project")

    own_steps = other_client.get(
        f"/api/v1/projects/{other_project['id']}/shared-steps"
    ).json()["data"]
    assert own_steps == []
