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


def _create_user(client: TestClient, email: str, name: str, role: str, password: str) -> str:
    response = client.post(
        "/api/v1/users", json={"email": email, "name": name, "role": role, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


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


def _sample_steps() -> list[dict]:
    return [
        {"action": "Input Policy Number", "expected": "ACV displayed"},
        {"action": "Apply $500 deductible", "expected": "Payout = ACV - 500"},
    ]


def _create_approved_case(client: TestClient, project_id: str, title: str) -> dict:
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    return client.post(f"/api/v1/test-cases/{case['id']}/approve").json()["data"]


def _setup_failed_step(client: TestClient, platform_admin: dict) -> tuple[str, dict, dict]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    case = _create_approved_case(client, project["id"], "Verify Total Loss Settlement")

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={
            "name": "Sprint 42 Motor Regression",
            "run_type": "Regression",
            "test_case_ids": [case["id"]],
        },
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    client.post(f"/api/v1/execution-steps/{steps[1]['id']}/verdict", json={"verdict": "fail"})
    return tenant_id, project, {"run": run, "step": steps[1]}


def test_defect_from_failed_step_auto_derives_traceability(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, ctx = _setup_failed_step(client, platform_admin)

    response = client.post(
        "/api/v1/defects",
        json={
            "execution_step_id": ctx["step"]["id"],
            "severity": "Critical",
            "description": "Payout was wrong.",
        },
    )
    assert response.status_code == 200, response.text
    defect = response.json()["data"]
    assert defect["project_id"] == project["id"]
    assert defect["test_run_id"] == ctx["run"]["id"]
    assert defect["step_number"] == 2
    assert defect["title"] == "Step 2 Failed: Apply $500 deductible"
    assert defect["status"] == "New"
    assert defect["test_case_id"] is not None
    assert defect["test_case_version_id"] is not None


def test_standalone_defect_requires_project_and_title(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)

    missing_both = client.post("/api/v1/defects", json={"severity": "Low"})
    assert missing_both.status_code == 422

    missing_title = client.post(
        "/api/v1/defects", json={"project_id": project["id"], "severity": "Low"}
    )
    assert missing_title.status_code == 422

    ok_response = client.post(
        "/api/v1/defects",
        json={
            "project_id": project["id"],
            "title": "Standalone UI glitch found",
            "severity": "Low",
        },
    )
    assert ok_response.status_code == 200
    assert ok_response.json()["data"]["test_case_id"] is None


def test_status_transitions_are_strictly_sequential(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, ctx = _setup_failed_step(client, platform_admin)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "High"}
    ).json()["data"]
    defect_id = defect["id"]

    skip_response = client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": "Fixed"})
    assert skip_response.status_code == 409

    to_open = client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": "Open"})
    assert to_open.status_code == 200
    assert to_open.json()["data"]["status"] == "Open"

    to_fixed = client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": "Fixed"})
    assert to_fixed.status_code == 200

    to_verified = client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": "Verified"})
    assert to_verified.status_code == 200

    to_closed = client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": "Closed"})
    assert to_closed.status_code == 200
    closed = to_closed.json()["data"]
    assert closed["status"] == "Closed"
    assert closed["closed_at"] is not None

    past_closed = client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": "Closed"})
    assert past_closed.status_code == 409


def test_tester_cannot_close_but_can_advance_earlier_states(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, ctx = _setup_failed_step(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "High"}
    ).json()["data"]
    defect_id = defect["id"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    open_response = tester_client.patch(
        f"/api/v1/defects/{defect_id}/status", json={"status": "Open"}
    )
    assert open_response.status_code == 200
    fixed_response = tester_client.patch(
        f"/api/v1/defects/{defect_id}/status", json={"status": "Fixed"}
    )
    assert fixed_response.status_code == 200
    verified_response = tester_client.patch(
        f"/api/v1/defects/{defect_id}/status", json={"status": "Verified"}
    )
    assert verified_response.status_code == 200

    closed_response = tester_client.patch(
        f"/api/v1/defects/{defect_id}/status", json={"status": "Closed"}
    )
    assert closed_response.status_code == 403


def test_filter_defects_by_status_and_severity(client: TestClient, platform_admin: dict) -> None:
    _, project, ctx = _setup_failed_step(client, platform_admin)
    client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "Critical"}
    )
    client.post(
        "/api/v1/defects",
        json={"project_id": project["id"], "title": "Minor cosmetic issue", "severity": "Low"},
    )

    critical_only = client.get("/api/v1/defects", params={"severity": "Critical"}).json()["data"]
    assert len(critical_only) == 1
    assert critical_only[0]["severity"] == "Critical"

    new_status_only = client.get("/api/v1/defects", params={"status": "New"}).json()["data"]
    assert len(new_status_only) == 2

    by_project = client.get("/api/v1/defects", params={"project_id": project["id"]}).json()["data"]
    assert len(by_project) == 2


def test_tester_only_sees_defects_in_assigned_projects(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, visible_project, ctx = _setup_failed_step(client, platform_admin)
    hidden_project = _create_project(client, "Hidden Project")
    client.post(
        "/api/v1/defects",
        json={
            "project_id": hidden_project["id"],
            "title": "Issue in hidden project",
            "severity": "Low",
        },
    )
    client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "Critical"}
    )

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{visible_project['id']}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    visible = tester_client.get("/api/v1/defects").json()["data"]
    assert len(visible) == 1
    assert visible[0]["project_id"] == visible_project["id"]

    forbidden = tester_client.get("/api/v1/defects", params={"project_id": hidden_project["id"]})
    assert forbidden.status_code == 403


def test_add_link_appears_on_defect_detail(client: TestClient, platform_admin: dict) -> None:
    _, _, ctx = _setup_failed_step(client, platform_admin)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "High"}
    ).json()["data"]

    link_response = client.post(
        f"/api/v1/defects/{defect['id']}/links",
        json={
            "linkable_type": "execution_step",
            "linkable_id": ctx["step"]["id"],
            "link_type": "relates_to",
        },
    )
    assert link_response.status_code == 200
    detail = link_response.json()["data"]
    assert len(detail["links"]) == 1
    assert detail["links"][0]["linkable_id"] == ctx["step"]["id"]
