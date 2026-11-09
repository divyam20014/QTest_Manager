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
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": email, "password": password},
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _create_user(client: TestClient, email: str, name: str, role: str, password: str) -> str:
    response = client.post(
        "/api/v1/users", json={"email": email, "name": name, "role": role, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _sample_project_payload(name: str = "Apex Motor Claims Modernization") -> dict:
    return {
        "name": name,
        "domain": "Motor",
        "priority": "High",
        "manager_name": "Jane Manager",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "budget": "450000.00",
        "region": "North America",
    }


def test_admin_creates_project_and_sees_default_currency(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    response = client.post("/api/v1/projects", json=_sample_project_payload())
    assert response.status_code == 200, response.text
    project = response.json()["data"]
    assert project["currency_code"] == "USD"
    assert project["owner_id"] == bootstrap["admin_user_id"]
    assert bootstrap["admin_user_id"] in project["assigned_user_ids"]


def test_duplicate_project_name_case_insensitive_rejected(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    client.post("/api/v1/projects", json=_sample_project_payload("Apex Motor Claims"))
    dup_response = client.post(
        "/api/v1/projects", json=_sample_project_payload("apex motor claims")
    )
    assert dup_response.status_code == 409


def test_invalid_date_range_rejected(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    payload = _sample_project_payload()
    payload["start_date"] = "2026-12-31"
    payload["end_date"] = "2026-01-01"
    response = client.post("/api/v1/projects", json=payload)
    assert response.status_code == 422


def test_tester_only_sees_assigned_projects(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    visible = client.post(
        "/api/v1/projects", json=_sample_project_payload("Visible Project")
    ).json()["data"]
    client.post("/api/v1/projects", json=_sample_project_payload("Hidden Project"))

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{visible['id']}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    listing = tester_client.get("/api/v1/projects").json()["data"]
    assert {p["name"] for p in listing} == {"Visible Project"}

    hidden_detail = tester_client.get(f"/api/v1/projects/{visible['id']}")
    assert hidden_detail.status_code == 200


def test_tester_cannot_create_or_edit_projects(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = client.post("/api/v1/projects", json=_sample_project_payload()).json()["data"]

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    create_response = tester_client.post(
        "/api/v1/projects", json=_sample_project_payload("Tester Project")
    )
    assert create_response.status_code == 403

    edit_response = tester_client.patch(
        f"/api/v1/projects/{project['id']}", json={"status": "At Risk"}
    )
    assert edit_response.status_code == 403


def test_unassigned_manager_cannot_edit_or_delete_project(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = client.post("/api/v1/projects", json=_sample_project_payload()).json()["data"]

    _create_user(client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!")

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")

    # Not assigned to this project -> forbidden (ADR-018).
    edit_response = manager_client.patch(
        f"/api/v1/projects/{project['id']}", json={"status": "At Risk"}
    )
    assert edit_response.status_code == 403

    delete_response = manager_client.delete(f"/api/v1/projects/{project['id']}")
    assert delete_response.status_code == 403

    # But listing/viewing is tenant-wide for Manager (not restricted like Tester).
    listing = manager_client.get("/api/v1/projects").json()["data"]
    assert len(listing) == 1


def test_assigned_manager_can_edit_and_delete_project(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = client.post("/api/v1/projects", json=_sample_project_payload()).json()["data"]

    manager_id = _create_user(
        client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": manager_id})

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")

    edit_response = manager_client.patch(
        f"/api/v1/projects/{project['id']}", json={"status": "At Risk"}
    )
    assert edit_response.status_code == 200
    assert edit_response.json()["data"]["status"] == "At Risk"

    delete_response = manager_client.delete(f"/api/v1/projects/{project['id']}")
    assert delete_response.status_code == 200


def test_manager_who_creates_project_can_edit_it(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    _create_user(client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!")

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")

    create_response = manager_client.post(
        "/api/v1/projects", json=_sample_project_payload("Manager's Own")
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["data"]["id"]

    edit_response = manager_client.patch(
        f"/api/v1/projects/{project_id}", json={"priority": "Critical"}
    )
    assert edit_response.status_code == 200
