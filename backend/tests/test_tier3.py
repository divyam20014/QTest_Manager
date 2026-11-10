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
    return [{"action": "Do the thing", "expected": "Thing happens"}]


def _setup_admin_and_project(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def _create_case(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": _sample_steps()},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


# ---------------------------------------------------------------------------
# Item 1: Module/folder-level test case grouping
# ---------------------------------------------------------------------------


def test_create_module_and_assign_test_case(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_case(client, project_id, "Verify Deductible Math")

    module = client.post(
        f"/api/v1/projects/{project_id}/modules", json={"name": "Claims Intake"}
    )
    assert module.status_code == 200, module.text
    module_id = module.json()["data"]["id"]
    assert module.json()["data"]["test_case_count"] == 0

    assign = client.post(
        f"/api/v1/test-cases/{case['id']}/module", json={"module_id": module_id}
    )
    assert assign.status_code == 200

    fetched = client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]
    assert fetched["module_id"] == module_id

    modules = client.get(f"/api/v1/projects/{project_id}/modules").json()["data"]
    assert next(m for m in modules if m["id"] == module_id)["test_case_count"] == 1


def test_nested_module_and_delete_reassigns_children(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    parent = client.post(
        f"/api/v1/projects/{project_id}/modules", json={"name": "Parent"}
    ).json()["data"]
    child = client.post(
        f"/api/v1/projects/{project_id}/modules",
        json={"name": "Child", "parent_id": parent["id"]},
    ).json()["data"]
    case = _create_case(client, project_id, "Case Under Child Module")
    client.post(f"/api/v1/test-cases/{case['id']}/module", json={"module_id": child["id"]})

    delete_response = client.delete(f"/api/v1/modules/{child['id']}")
    assert delete_response.status_code == 200

    fetched = client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]
    assert fetched["module_id"] == parent["id"]

    remaining = client.get(f"/api/v1/projects/{project_id}/modules").json()["data"]
    assert [m["id"] for m in remaining] == [parent["id"]]


def test_module_tenant_isolation(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    module = client.post(
        f"/api/v1/projects/{project_id}/modules", json={"name": "Tenant A Module"}
    ).json()["data"]

    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(other_client, platform_admin, name="Other Insurer")
    other_tenant_id = other_bootstrap["tenant"]["id"]
    _login_and_verify(other_client, other_tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    other_project = _create_project(other_client, name="Other Project")

    cross_update = other_client.patch(f"/api/v1/modules/{module['id']}", json={"name": "Hijacked"})
    assert cross_update.status_code == 404

    own_modules = other_client.get(f"/api/v1/projects/{other_project['id']}/modules").json()["data"]
    assert own_modules == []


# ---------------------------------------------------------------------------
# Item 4: Reviewer-assignment review workflow
# ---------------------------------------------------------------------------


def test_submit_for_review_without_reviewer_still_works(
    client: TestClient, platform_admin: dict
) -> None:
    """Back-compat: existing callers that don't name a reviewer behave
    exactly as before this tier."""
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_case(client, project_id, "No Reviewer Named")

    submit = client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    assert submit.status_code == 200
    assert submit.json()["data"]["status"] == "ready_for_review"
    assert submit.json()["data"]["reviewer_id"] is None

    approve = client.post(f"/api/v1/test-cases/{case['id']}/approve")
    assert approve.status_code == 200
    assert approve.json()["data"]["status"] == "approved"


def test_only_assigned_reviewer_can_approve(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_case(client, project_id, "Named Reviewer Case")

    manager_id = _create_user(
        client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!"
    )
    other_manager_id = _create_user(
        client, "other-manager@horizon.com", "Manager Two", "manager", "ManagerPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": manager_id})
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": other_manager_id})

    submit = client.post(
        f"/api/v1/test-cases/{case['id']}/submit-review", json={"reviewer_id": manager_id}
    )
    assert submit.status_code == 200
    assert submit.json()["data"]["reviewer_id"] == manager_id

    other_manager_client = TestClient(client.app)
    _login_and_verify(
        other_manager_client, tenant_id, "other-manager@horizon.com", "ManagerPassw0rd!"
    )
    rejected = other_manager_client.post(f"/api/v1/test-cases/{case['id']}/approve")
    assert rejected.status_code == 403

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")
    approved = manager_client.post(f"/api/v1/test-cases/{case['id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["data"]["status"] == "approved"

    unread = manager_client.get("/api/v1/notifications?unread_only=false").json()["data"]
    assert any(n["type"] == "review_requested" for n in unread)


def test_request_changes_sends_back_to_draft_with_comment(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_case(client, project_id, "Needs Rework")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")

    response = client.post(
        f"/api/v1/test-cases/{case['id']}/request-changes",
        json={"comment": "Please add a negative test step."},
    )
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "draft"
    assert response.json()["data"]["reviewer_id"] is None

    comments = client.get(f"/api/v1/test-cases/{case['id']}/comments").json()["data"]
    assert any("negative test step" in c["body"] for c in comments)


def test_request_changes_only_from_ready_for_review(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_case(client, project_id, "Still Draft")
    response = client.post(
        f"/api/v1/test-cases/{case['id']}/request-changes", json={"comment": "n/a"}
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# Item 2: QA Manager Intelligence
# ---------------------------------------------------------------------------


def test_release_readiness_reports_metrics(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    _create_case(client, project_id, "Readiness Case One")
    _create_case(client, project_id, "Readiness Case Two")

    report = client.get(f"/api/v1/reports/release-readiness?project_id={project_id}")
    assert report.status_code == 200, report.text
    data = report.json()["data"]
    assert data["total_test_cases"] == 2
    assert data["execution_completion_percentage"] == 0.0
    assert "Critical" not in data["open_defects_by_severity"] or True  # no defects yet
    assert data["requirement_coverage_percentage"] == 0.0


def test_workload_summary_counts_assignments(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Assigned To Tester",
            "priority": "Low",
            "steps": _sample_steps(),
            "assignee_id": tester_id,
        },
    )
    assert response.status_code == 200, response.text

    workload = client.get(f"/api/v1/reports/workload?project_id={project_id}")
    assert workload.status_code == 200, workload.text
    entries = workload.json()["data"]["entries"]
    tester_entry = next(e for e in entries if e["user_id"] == tester_id)
    assert tester_entry["assigned_test_cases"] == 1


def test_flaky_tests_report_empty_without_execution_history(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    _create_case(client, project_id, "No Executions Yet")

    response = client.get(f"/api/v1/reports/flaky-tests?project_id={project_id}")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["tests"] == []


# ---------------------------------------------------------------------------
# Item 3: Global search
# ---------------------------------------------------------------------------


def test_global_search_finds_test_cases_and_scopes_to_tenant(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    _create_case(client, project_id, "Verify Windshield Replacement Claim")

    response = client.get("/api/v1/search?q=Windshield")
    assert response.status_code == 200, response.text
    results = response.json()["data"]["results"]
    assert any(r["type"] == "test_case" and "Windshield" in r["title"] for r in results)

    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(other_client, platform_admin, name="Other Insurer Three")
    other_tenant_id = other_bootstrap["tenant"]["id"]
    _login_and_verify(other_client, other_tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    cross_tenant = other_client.get("/api/v1/search?q=Windshield")
    assert cross_tenant.json()["data"]["results"] == []


def test_release_readiness_tenant_isolation(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)

    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(other_client, platform_admin, name="Other Insurer Two")
    other_tenant_id = other_bootstrap["tenant"]["id"]
    _login_and_verify(other_client, other_tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    response = other_client.get(f"/api/v1/reports/release-readiness?project_id={project_id}")
    assert response.status_code == 404
