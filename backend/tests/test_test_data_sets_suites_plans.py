from fastapi.testclient import TestClient


def _bootstrap_tenant(client: TestClient, platform_admin: dict, name: str) -> dict:
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
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": email, "password": password},
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _create_project(client: TestClient, name: str = "TDS Project") -> dict:
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


def _create_approved_case(client: TestClient, project_id: str, title: str = "Login test") -> dict:
    create = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "enter creds", "expected": "logged in"}],
        },
    )
    assert create.status_code == 200, create.text
    case = create.json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    approve = client.post(f"/api/v1/test-cases/{case['id']}/approve")
    assert approve.status_code == 200, approve.text
    return case


def _setup_admin_project_case(
    client: TestClient, platform_admin: dict, name: str = "TDS Tenant"
) -> tuple[str, str, dict]:
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    email = f"admin@{name.lower().replace(' ', '')}.com"
    _login_and_verify(client, tenant_id, email, "AdminPassw0rd!")
    project = _create_project(client)
    case = _create_approved_case(client, project["id"])
    return tenant_id, project["id"], case


# --- Test Data Sets -------------------------------------------------------


def test_data_set_crud_and_rows(client: TestClient, platform_admin: dict) -> None:
    _, _project_id, case = _setup_admin_project_case(client, platform_admin, "DataSetCRUD")

    ds = client.post(
        f"/api/v1/test-cases/{case['id']}/data-sets", json={"name": "Login edge cases"}
    )
    assert ds.status_code == 200, ds.text
    data_set = ds.json()["data"]
    assert data_set["rows"] == []

    row = client.post(
        f"/api/v1/data-sets/{data_set['id']}/rows",
        json={"name": "Valid", "data": {"username": "admin", "password": "correct"}},
    )
    assert row.status_code == 200, row.text
    assert row.json()["data"]["rows"][0]["data"]["username"] == "admin"

    listed = client.get(f"/api/v1/test-cases/{case['id']}/data-sets").json()["data"]
    assert len(listed) == 1
    assert len(listed[0]["rows"]) == 1

    deleted = client.delete(f"/api/v1/data-sets/{data_set['id']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/test-cases/{case['id']}/data-sets").json()["data"] == []


def test_selecting_multiple_data_rows_creates_one_run_case_per_row(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id, case = _setup_admin_project_case(client, platform_admin, "DataSetRowsRun")

    ds = client.post(
        f"/api/v1/test-cases/{case['id']}/data-sets", json={"name": "Login edge cases"}
    ).json()["data"]
    row_ids = []
    for name, data in [
        ("Valid", {"username": "admin", "password": "correct"}),
        ("Invalid", {"username": "admin", "password": "wrong"}),
        ("Locked", {"username": "locked_user", "password": "x"}),
    ]:
        resp = client.post(f"/api/v1/data-sets/{ds['id']}/rows", json={"name": name, "data": data})
        ds = resp.json()["data"]
        row_ids.append(ds["rows"][-1]["id"])

    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Param Run", "run_type": "Regression", "test_case_ids": [case["id"]]},
    )
    assert run.status_code == 200, run.text
    run_id = run.json()["data"]["id"]
    assert len(run.json()["data"]["cases"]) == 1  # baseline, unparameterized

    added = client.post(
        f"/api/v1/test-runs/{run_id}/cases",
        json={"test_case_ids": [case["id"]], "data_row_ids": {case["id"]: row_ids}},
    )
    assert added.status_code == 200, added.text
    cases = added.json()["data"]["cases"]
    assert len(cases) == 4  # 1 baseline + 3 parameterized rows

    # Re-adding the exact same row again must be rejected as a duplicate.
    dup = client.post(
        f"/api/v1/test-runs/{run_id}/cases",
        json={"test_case_ids": [case["id"]], "data_row_ids": {case["id"]: [row_ids[0]]}},
    )
    assert dup.status_code == 409, dup.text

    # The context endpoint must surface the row's values for the executor.
    parameterized_case_id = next(c["id"] for c in cases if c["id"] != cases[0]["id"])
    ctx = client.get(f"/api/v1/test-run-cases/{parameterized_case_id}/context")
    assert ctx.status_code == 200, ctx.text
    assert ctx.json()["data"]["data_row_id"] in row_ids
    assert ctx.json()["data"]["data_row_values"] is not None


def test_data_sets_are_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    _, _project_a, case_a = _setup_admin_project_case(client, platform_admin, "TDSIsoA")
    ds_a = client.post(
        f"/api/v1/test-cases/{case_a['id']}/data-sets", json={"name": "A's set"}
    ).json()["data"]

    _, _project_b, _case_b = _setup_admin_project_case(client, platform_admin, "TDSIsoB")
    cross = client.post(
        f"/api/v1/data-sets/{ds_a['id']}/rows", json={"name": "x", "data": {}}
    )
    assert cross.status_code == 404


# --- Test Suites -----------------------------------------------------------


def test_suite_crud_and_create_run_from_suite(client: TestClient, platform_admin: dict) -> None:
    _, project_id, case = _setup_admin_project_case(client, platform_admin, "SuiteCRUD")
    case2 = _create_approved_case(client, project_id, "Second case")

    suite = client.post(
        f"/api/v1/projects/{project_id}/test-suites",
        json={
            "name": "Regression Suite",
            "description": "Critical path",
            "test_case_ids": [case["id"], case2["id"]],
        },
    )
    assert suite.status_code == 200, suite.text
    suite_data = suite.json()["data"]
    assert set(suite_data["test_case_ids"]) == {case["id"], case2["id"]}

    listed = client.get(f"/api/v1/projects/{project_id}/test-suites").json()["data"]
    assert len(listed) == 1

    run = client.post(
        f"/api/v1/test-suites/{suite_data['id']}/create-run",
        json={"name": "Run from suite", "run_type": "Smoke"},
    )
    assert run.status_code == 200, run.text
    run_case_ids = {c["test_case_id"] for c in run.json()["data"]["cases"]}
    assert run_case_ids == {case["id"], case2["id"]}

    deleted = client.delete(f"/api/v1/test-suites/{suite_data['id']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/projects/{project_id}/test-suites").json()["data"] == []


def test_suites_are_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    _, project_a, case_a = _setup_admin_project_case(client, platform_admin, "SuiteIsoA")
    suite_a = client.post(
        f"/api/v1/projects/{project_a}/test-suites",
        json={"name": "A's suite", "test_case_ids": [case_a["id"]]},
    ).json()["data"]

    _, _project_b, _case_b = _setup_admin_project_case(client, platform_admin, "SuiteIsoB")
    cross = client.patch(f"/api/v1/test-suites/{suite_a['id']}", json={"name": "hijacked"})
    assert cross.status_code == 404


# --- Test Plans -------------------------------------------------------------


def test_plan_crud_and_rollup(client: TestClient, platform_admin: dict) -> None:
    _, project_id, case = _setup_admin_project_case(client, platform_admin, "PlanRollup")

    run1 = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Run 1", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]

    case2 = _create_approved_case(client, project_id, "Second case")
    run2 = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Run 2", "run_type": "Smoke", "test_case_ids": [case2["id"]]},
    ).json()["data"]

    plan = client.post(
        f"/api/v1/projects/{project_id}/test-plans",
        json={
            "name": "Release 2.0 Test Plan",
            "description": "d",
            "test_run_ids": [run1["id"], run2["id"]],
        },
    )
    assert plan.status_code == 200, plan.text
    plan_id = plan.json()["data"]["id"]

    rollup = client.get(f"/api/v1/test-plans/{plan_id}/rollup")
    assert rollup.status_code == 200, rollup.text
    assert rollup.json()["data"]["total_test_cases"] == 2
    assert rollup.json()["data"]["execution_completion_percentage"] == 0.0

    # Record one pass verdict and confirm the rollup actually recomputes.
    run_case_id = run1["cases"][0]["id"]
    step = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"][0]
    client.post(f"/api/v1/execution-steps/{step['id']}/open")
    client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})

    rollup_after = client.get(f"/api/v1/test-plans/{plan_id}/rollup").json()["data"]
    assert rollup_after["execution_completion_percentage"] == 50.0
    assert rollup_after["pass_percentage"] == 100.0

    deleted = client.delete(f"/api/v1/test-plans/{plan_id}")
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/projects/{project_id}/test-plans").json()["data"] == []


def test_plans_are_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    _, project_a, case_a = _setup_admin_project_case(client, platform_admin, "PlanIsoA")
    run_a = client.post(
        f"/api/v1/projects/{project_a}/test-runs",
        json={"name": "Run A", "run_type": "Regression", "test_case_ids": [case_a["id"]]},
    ).json()["data"]
    plan_a = client.post(
        f"/api/v1/projects/{project_a}/test-plans",
        json={"name": "A's plan", "test_run_ids": [run_a["id"]]},
    ).json()["data"]

    _, _project_b, _case_b = _setup_admin_project_case(client, platform_admin, "PlanIsoB")
    cross = client.get(f"/api/v1/test-plans/{plan_a['id']}/rollup")
    assert cross.status_code == 404
