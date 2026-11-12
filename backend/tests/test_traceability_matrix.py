"""Phase 3 (redesign plan): Requirements Traceability Matrix -- per-
requirement pass/fail/blocked/not-executed breakdown, not just the
linked-test-case COUNT that RequirementCoverageReport already gives."""

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


def _sample_steps() -> list[dict]:
    return [{"action": "Do the thing", "expected": "Thing happens"}]


def _create_approved_case(client: TestClient, project_id: str, title: str) -> dict:
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    return client.post(f"/api/v1/test-cases/{case['id']}/approve").json()["data"]


def _setup_admin_and_project(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def _create_requirement(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": title, "description": "Some requirement detail."},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _link(client: TestClient, requirement_id: str, test_case_id: str) -> None:
    response = client.post(
        f"/api/v1/requirements/{requirement_id}/test-cases",
        json={"test_case_id": test_case_id},
    )
    assert response.status_code == 200, response.text


def _run_case_to_verdict(client: TestClient, project_id: str, case_id: str, verdict: str) -> None:
    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Matrix Verify Run", "run_type": "Regression", "test_case_ids": [case_id]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    for step in steps:
        client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": verdict})


def test_uncovered_requirement_shows_all_zero(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    _create_requirement(client, project_id, "REQ with no linked cases")

    response = client.get(f"/api/v1/reports/traceability-matrix?project_id={project_id}")
    assert response.status_code == 200, response.text
    entries = response.json()["data"]["entries"]
    assert len(entries) == 1
    row = entries[0]
    assert row["linked_test_case_count"] == 0
    assert row["passed_count"] == 0
    assert row["failed_count"] == 0
    assert row["blocked_count"] == 0
    assert row["not_executed_count"] == 0
    assert row["coverage_percentage"] == 0.0


def test_mixed_verdicts_compute_correct_breakdown(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    req = _create_requirement(client, project_id, "REQ needing mixed verdicts")

    passed_case = _create_approved_case(client, project_id, "Case That Passes")
    failed_case = _create_approved_case(client, project_id, "Case That Fails")
    pending_case = _create_approved_case(client, project_id, "Case Never Executed")

    for case in (passed_case, failed_case, pending_case):
        _link(client, req["id"], case["id"])

    _run_case_to_verdict(client, project_id, passed_case["id"], "pass")
    _run_case_to_verdict(client, project_id, failed_case["id"], "fail")
    # pending_case deliberately never bundled into a run.

    response = client.get(f"/api/v1/reports/traceability-matrix?project_id={project_id}")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    row = next(e for e in data["entries"] if e["requirement_id"] == req["id"])
    assert row["linked_test_case_count"] == 3
    assert row["passed_count"] == 1
    assert row["failed_count"] == 1
    assert row["blocked_count"] == 0
    assert row["not_executed_count"] == 1
    # 2 of 3 linked cases have a terminal execution verdict.
    assert row["coverage_percentage"] == 66.7

    # CSV export mirrors the same numbers.
    export = client.get(f"/api/v1/reports/traceability-matrix/export?project_id={project_id}")
    assert export.status_code == 200
    assert "text/csv" in export.headers["content-type"]
    assert "Case That Passes" not in export.text  # export is per-requirement, not per-case
    assert req["title"] in export.text


def test_traceability_matrix_is_project_scoped(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    other_project = _create_project(client, name="Other Project")
    _create_requirement(client, project_id, "Belongs To First Project")
    _create_requirement(client, other_project["id"], "Belongs To Second Project")

    response = client.get(f"/api/v1/reports/traceability-matrix?project_id={project_id}")
    assert response.status_code == 200
    titles = [e["requirement_title"] for e in response.json()["data"]["entries"]]
    assert titles == ["Belongs To First Project"]


def test_traceability_matrix_rejects_inaccessible_project(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)

    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(other_client, platform_admin)
    other_tenant_id = other_bootstrap["tenant"]["id"]
    _login_and_verify(other_client, other_tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    cross_tenant = other_client.get(f"/api/v1/reports/traceability-matrix?project_id={project_id}")
    assert cross_tenant.status_code in (403, 404)
