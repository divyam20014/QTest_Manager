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

    listing = tester_client.get("/api/v1/projects").json()["data"]["items"]
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
    assert listing["total"] == 1
    assert len(listing["items"]) == 1


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


def _sample_steps() -> list[dict]:
    return [{"action": "Do thing", "expected": "Thing happens"}]


def _create_approved_case(client: TestClient, project_id: str, title: str) -> dict:
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    return client.post(f"/api/v1/test-cases/{case['id']}/approve").json()["data"]


def test_cannot_delete_project_with_active_test_run(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = client.post("/api/v1/projects", json=_sample_project_payload()).json()["data"]
    case = _create_approved_case(client, project["id"], "Verify Total Loss Settlement")

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={
            "name": "Sprint 1 Regression",
            "run_type": "Regression",
            "test_case_ids": [case["id"]],
        },
    ).json()["data"]

    blocked = client.delete(f"/api/v1/projects/{project['id']}")
    assert blocked.status_code == 409
    assert "active test runs" in blocked.json()["error"]["message"].lower()

    finish = client.post(f"/api/v1/test-runs/{run['id']}/finish")
    assert finish.status_code == 200, finish.text

    # Finishing the run clears the "active run" guard, but the project still
    # has test cases/runs on record -- deletion stays blocked rather than
    # hitting a raw FK violation, and with a clearer error than before.
    still_blocked = client.delete(f"/api/v1/projects/{project['id']}")
    assert still_blocked.status_code == 409
    assert "test cases" in still_blocked.json()["error"]["message"].lower()


def test_project_with_no_dependent_data_can_be_deleted(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = client.post("/api/v1/projects", json=_sample_project_payload()).json()["data"]

    response = client.delete(f"/api/v1/projects/{project['id']}")
    assert response.status_code == 200


def test_negative_budget_rejected(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    payload = _sample_project_payload()
    payload["budget"] = "-1.00"
    response = client.post("/api/v1/projects", json=payload)
    assert response.status_code == 422


def test_add_and_remove_project_member(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = client.post("/api/v1/projects", json=_sample_project_payload()).json()["data"]
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )

    add_response = client.post(
        f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id}
    )
    assert add_response.status_code == 200
    assert tester_id in add_response.json()["data"]["assigned_user_ids"]

    remove_response = client.delete(f"/api/v1/projects/{project['id']}/members/{tester_id}")
    assert remove_response.status_code == 200
    assert tester_id not in remove_response.json()["data"]["assigned_user_ids"]


def test_project_list_search_filter_sort_and_pagination(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    for name, domain, priority in [
        ("Alpha Motor Rollout", "Motor", "Low"),
        ("Beta Health Overhaul", "Health", "High"),
        ("Gamma Motor Expansion", "Motor", "Critical"),
    ]:
        payload = _sample_project_payload(name)
        payload["domain"] = domain
        payload["priority"] = priority
        assert client.post("/api/v1/projects", json=payload).status_code == 200

    search = client.get("/api/v1/projects", params={"search": "motor"}).json()["data"]
    assert search["total"] == 2
    assert {p["name"] for p in search["items"]} == {"Alpha Motor Rollout", "Gamma Motor Expansion"}

    by_domain = client.get("/api/v1/projects", params={"domain": "Health"}).json()["data"]
    assert by_domain["total"] == 1
    assert by_domain["items"][0]["name"] == "Beta Health Overhaul"

    sorted_desc = client.get("/api/v1/projects", params={"sort": "-name"}).json()["data"]
    names = [p["name"] for p in sorted_desc["items"]]
    assert names == sorted(names, reverse=True)

    page1 = client.get("/api/v1/projects", params={"page": 1, "page_size": 2}).json()["data"]
    assert page1["total"] == 3
    assert len(page1["items"]) == 2
    page2 = client.get("/api/v1/projects", params={"page": 2, "page_size": 2}).json()["data"]
    assert len(page2["items"]) == 1


def test_project_list_includes_metrics(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = client.post("/api/v1/projects", json=_sample_project_payload()).json()["data"]
    assert project["test_case_count"] == 0

    _create_approved_case(client, project["id"], "Verify Total Loss Settlement")

    listing = client.get("/api/v1/projects").json()["data"]["items"]
    found = next(p for p in listing if p["id"] == project["id"])
    assert found["test_case_count"] == 1
    assert found["approved_test_case_count"] == 1

    detail = client.get(f"/api/v1/projects/{project['id']}").json()["data"]
    assert detail["test_case_count"] == 1
    assert detail["approved_test_case_count"] == 1


def test_manager_user_id_must_belong_to_tenant(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    admin_id = bootstrap["admin_user_id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    payload = _sample_project_payload()
    payload["manager_user_id"] = "00000000-0000-0000-0000-000000000000"
    rejected = client.post("/api/v1/projects", json=payload)
    assert rejected.status_code == 404

    payload["manager_user_id"] = admin_id
    accepted = client.post("/api/v1/projects", json=payload)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["data"]["manager_user_id"] == admin_id
