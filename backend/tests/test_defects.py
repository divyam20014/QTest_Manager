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

    missing_confirmation = client.patch(
        f"/api/v1/defects/{defect_id}/status", json={"status": "Closed"}
    )
    assert missing_confirmation.status_code == 422

    to_closed = client.patch(
        f"/api/v1/defects/{defect_id}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )
    assert to_closed.status_code == 200
    closed = to_closed.json()["data"]
    assert closed["status"] == "Closed"
    assert closed["closed_at"] is not None

    past_closed = client.patch(
        f"/api/v1/defects/{defect_id}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )
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


def test_filter_defects_by_test_run_id(client: TestClient, platform_admin: dict) -> None:
    """GAP-20: lets a client (the Execution Console) ask which steps in a
    specific run already have a defect reported."""
    _, project, ctx = _setup_failed_step(client, platform_admin)
    client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "Critical"}
    )
    client.post(
        "/api/v1/defects",
        json={
            "project_id": project["id"],
            "title": "Unrelated standalone issue",
            "severity": "Low",
        },
    )

    scoped = client.get("/api/v1/defects", params={"test_run_id": ctx["run"]["id"]}).json()["data"]
    assert len(scoped) == 1
    assert scoped[0]["test_case_version_step_id"] == ctx["step"]["test_case_version_step_id"]

    unscoped = client.get("/api/v1/defects").json()["data"]
    assert len(unscoped) == 2


def test_defect_evidence_fields_persist(client: TestClient, platform_admin: dict) -> None:
    _, _, ctx = _setup_failed_step(client, platform_admin)
    response = client.post(
        "/api/v1/defects",
        json={
            "execution_step_id": ctx["step"]["id"],
            "severity": "High",
            "actual_result": "Payout computed as $1000",
            "expected_result": "Payout computed as $500",
            "environment": "Staging, Chrome 130",
        },
    )
    assert response.status_code == 200, response.text
    defect = response.json()["data"]
    assert defect["actual_result"] == "Payout computed as $1000"
    assert defect["expected_result"] == "Payout computed as $500"
    assert defect["environment"] == "Staging, Chrome 130"


def test_expected_result_defaults_from_step_when_omitted(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, ctx = _setup_failed_step(client, platform_admin)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "Low"}
    ).json()["data"]
    assert defect["expected_result"] == "Payout = ACV - 500"


def test_in_run_defect_creation_without_specific_step(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, ctx = _setup_failed_step(client, platform_admin)
    response = client.post(
        "/api/v1/defects",
        json={
            "test_run_id": ctx["run"]["id"],
            "title": "Environment was misconfigured for this run",
            "severity": "Medium",
        },
    )
    assert response.status_code == 200, response.text
    defect = response.json()["data"]
    assert defect["project_id"] == project["id"]
    assert defect["test_run_id"] == ctx["run"]["id"]
    assert defect["test_case_id"] is None
    assert defect["step_number"] is None


def test_execution_evidence_reflects_originating_step(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, ctx = _setup_failed_step(client, platform_admin)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "High"}
    ).json()["data"]

    assert defect["execution_evidence"] is not None
    assert defect["execution_evidence"]["verdict"] == "fail"
    assert defect["execution_evidence"]["duration_ms"] is not None
    assert defect["test_case_version_number"] == 1
    assert defect["test_run_case_id"] is not None


def test_closing_requires_verification_confirmation(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, ctx = _setup_failed_step(client, platform_admin)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "High"}
    ).json()["data"]
    defect_id = defect["id"]
    for status in ("Open", "Fixed", "Verified"):
        client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": status})

    without_confirmation = client.patch(
        f"/api/v1/defects/{defect_id}/status", json={"status": "Closed"}
    )
    assert without_confirmation.status_code == 422

    with_confirmation = client.patch(
        f"/api/v1/defects/{defect_id}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )
    assert with_confirmation.status_code == 200
    assert with_confirmation.json()["data"]["status"] == "Closed"


def test_link_to_existing_defect_appears_in_run_scoped_list(
    client: TestClient, platform_admin: dict
) -> None:
    """Spec C.7/A.4: a new failure can be linked to an existing defect
    instead of creating a new one, and still shows up as 'reported' for
    that run's steps (not just defects originally created from them)."""
    _, project, ctx = _setup_failed_step(client, platform_admin)

    existing = client.post(
        "/api/v1/defects",
        json={
            "project_id": project["id"],
            "title": "Known settlement calculation bug",
            "severity": "Critical",
        },
    ).json()["data"]

    client.post(
        f"/api/v1/defects/{existing['id']}/links",
        json={"linkable_type": "execution_step", "linkable_id": ctx["step"]["id"]},
    )

    scoped = client.get("/api/v1/defects", params={"test_run_id": ctx["run"]["id"]}).json()["data"]
    assert any(d["id"] == existing["id"] for d in scoped)


def test_defect_history_tracks_creation_and_status_changes(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, ctx = _setup_failed_step(client, platform_admin)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "High"}
    ).json()["data"]
    client.patch(f"/api/v1/defects/{defect['id']}/status", json={"status": "Open"})

    history = client.get(f"/api/v1/defects/{defect['id']}/history").json()["data"]
    actions = [h["action"] for h in history]
    assert actions == ["defect.created", "defect.status_changed"]
    assert history[-1]["event_metadata"]["to"] == "Open"


def test_filter_defects_by_reporter_and_date_range(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, ctx = _setup_failed_step(client, platform_admin)
    admin_id = client.get("/api/v1/auth/me").json()["data"]["user_id"]
    client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "Critical"}
    )

    by_reporter = client.get("/api/v1/defects", params={"reported_by": admin_id}).json()["data"]
    assert len(by_reporter) == 1

    other_user_id = _create_user(
        client, "someoneelse@horizon.com", "Someone Else", "manager", "ManagerPassw0rd!"
    )
    by_other = client.get("/api/v1/defects", params={"reported_by": other_user_id}).json()["data"]
    assert len(by_other) == 0

    from datetime import UTC, datetime, timedelta

    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()

    future_only = client.get("/api/v1/defects", params={"created_from": future}).json()["data"]
    assert len(future_only) == 0

    in_range = client.get(
        "/api/v1/defects", params={"created_from": past, "created_to": future}
    ).json()["data"]
    assert len(in_range) == 1


def test_filter_defects_by_test_case_id(client: TestClient, platform_admin: dict) -> None:
    _, project, ctx = _setup_failed_step(client, platform_admin)
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": ctx["step"]["id"], "severity": "Low"}
    ).json()["data"]
    client.post(
        "/api/v1/defects",
        json={
            "project_id": project["id"],
            "title": "Unrelated standalone issue",
            "severity": "Low",
        },
    )

    scoped = client.get(
        "/api/v1/defects", params={"test_case_id": defect["test_case_id"]}
    ).json()["data"]
    assert len(scoped) == 1
    assert scoped[0]["id"] == defect["id"]
