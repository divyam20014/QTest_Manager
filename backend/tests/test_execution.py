import time
from concurrent.futures import ThreadPoolExecutor

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
        {"action": "Confirm settlement letter", "expected": "Letter generated"},
    ]


def _create_approved_case(client: TestClient, project_id: str, title: str) -> dict:
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    approve_response = client.post(f"/api/v1/test-cases/{case['id']}/approve")
    return approve_response.json()["data"]


def _setup_admin_project_and_case(
    client: TestClient, platform_admin: dict
) -> tuple[str, dict, dict]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    case = _create_approved_case(client, project["id"], "Verify Total Loss Settlement")
    return tenant_id, project, case


def test_create_run_pins_version_and_pre_creates_steps(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)

    run_response = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={
            "name": "Sprint 42 Motor Regression",
            "run_type": "Regression",
            "test_case_ids": [case["id"]],
        },
    )
    assert run_response.status_code == 200, run_response.text
    run = run_response.json()["data"]
    assert len(run["cases"]) == 1
    run_case = run["cases"][0]
    assert run_case["test_case_version_id"] is not None
    assert run_case["status"] == "pending"
    assert run_case["step_count"] == 3

    steps = client.get(f"/api/v1/test-run-cases/{run_case['id']}/steps").json()["data"]
    assert len(steps) == 3
    assert all(s["verdict"] is None for s in steps)
    assert [s["step_number"] for s in steps] == [1, 2, 3]


def test_only_approved_cases_can_be_bundled(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    draft_case = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={"title": "Still A Draft Case", "priority": "Low", "steps": _sample_steps()},
    ).json()["data"]

    run_response = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Bad Run", "run_type": "Smoke", "test_case_ids": [draft_case["id"]]},
    )
    assert run_response.status_code == 409


def test_marking_any_step_fail_flags_case_failed(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
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

    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")
    pass_response = client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    assert pass_response.status_code == 200
    assert pass_response.json()["data"]["duration_ms"] is not None

    fail_response = client.post(
        f"/api/v1/execution-steps/{steps[1]['id']}/verdict", json={"verdict": "fail"}
    )
    assert fail_response.status_code == 200

    run_detail = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    updated_case = run_detail["cases"][0]
    assert updated_case["status"] == "failed"
    assert updated_case["passed_count"] == 1
    assert updated_case["failed_count"] == 1
    assert updated_case["started_at"] is not None


def test_verdict_without_explicit_open_still_works(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Quick Run", "run_type": "Sanity", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    response = client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["opened_at"] is not None
    assert data["duration_ms"] is not None


def test_re_verdict_after_fix_flips_case_back_to_passed(
    client: TestClient, platform_admin: dict
) -> None:
    """BRD Journey 4: tester re-executes a failed step after a fix and
    marks it Pass; the case status flips from Failed back to Passed."""
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
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

    for step in steps:
        client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    client.post(f"/api/v1/execution-steps/{steps[1]['id']}/verdict", json={"verdict": "fail"})

    failed_run = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert failed_run["cases"][0]["status"] == "failed"

    # Defect fixed; tester re-executes the step and marks it Pass.
    client.post(f"/api/v1/execution-steps/{steps[1]['id']}/verdict", json={"verdict": "pass"})

    fixed_run = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert fixed_run["cases"][0]["status"] == "passed"
    assert fixed_run["cases"][0]["completed_at"] is not None


def test_ignore_verdict_counts_as_resolved(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Ignore Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    for step in steps[:2]:
        client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    client.post(f"/api/v1/execution-steps/{steps[2]['id']}/verdict", json={"verdict": "ignore"})

    run_detail = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert run_detail["cases"][0]["status"] == "passed"
    assert run_detail["cases"][0]["ignored_count"] == 1


def test_finish_run_locks_further_step_edits(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Lockable Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    finish_response = client.post(f"/api/v1/test-runs/{run['id']}/finish")
    assert finish_response.status_code == 200
    assert finish_response.json()["data"]["finished_at"] is not None

    blocked_response = client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    assert blocked_response.status_code == 409

    double_finish = client.post(f"/api/v1/test-runs/{run['id']}/finish")
    assert double_finish.status_code == 409


def test_tester_cannot_finish_run(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Tester Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    finish_response = tester_client.post(f"/api/v1/test-runs/{run['id']}/finish")
    assert finish_response.status_code == 403


def test_tester_restricted_to_assigned_project_for_runs(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    _create_user(client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!")
    # Not added as a project member.

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Admin Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    create_response = tester_client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Tester Attempt", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    )
    assert create_response.status_code == 403

    get_response = tester_client.get(f"/api/v1/test-runs/{run['id']}")
    assert get_response.status_code == 403


def test_list_test_runs_for_project(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)

    empty_list = client.get(f"/api/v1/projects/{project['id']}/test-runs").json()["data"]
    assert empty_list == []

    run1 = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "First Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Second Run", "run_type": "Regression", "test_case_ids": [case["id"]]},
    )

    runs = client.get(f"/api/v1/projects/{project['id']}/test-runs").json()["data"]
    assert len(runs) == 2
    assert {r["name"] for r in runs} == {"First Run", "Second Run"}
    assert runs[0]["name"] == "Second Run"  # most recent first
    first = next(r for r in runs if r["id"] == run1["id"])
    assert first["case_count"] == 1


def test_edit_run_before_execution_starts(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Original Name", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]

    update_response = client.patch(
        f"/api/v1/test-runs/{run['id']}", json={"name": "Renamed Run", "run_type": "Sanity"}
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["data"]["name"] == "Renamed Run"
    assert update_response.json()["data"]["run_type"] == "Sanity"


def test_cannot_edit_run_after_execution_starts(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Original Name", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")

    update_response = client.patch(f"/api/v1/test-runs/{run['id']}", json={"name": "Too Late"})
    assert update_response.status_code == 409


def test_add_and_remove_test_cases_on_run(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    second_case = _create_approved_case(client, project["id"], "Verify Policy Endorsement")

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Incremental Run", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]
    assert len(run["cases"]) == 1

    add_response = client.post(
        f"/api/v1/test-runs/{run['id']}/cases", json={"test_case_ids": [second_case["id"]]}
    )
    assert add_response.status_code == 200, add_response.text
    assert len(add_response.json()["data"]["cases"]) == 2

    new_run_case = next(
        rc for rc in add_response.json()["data"]["cases"] if rc["test_case_id"] == second_case["id"]
    )
    remove_response = client.delete(f"/api/v1/test-runs/{run['id']}/cases/{new_run_case['id']}")
    assert remove_response.status_code == 200, remove_response.text
    assert len(remove_response.json()["data"]["cases"]) == 1


def test_cannot_remove_case_with_execution_in_progress(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "In Progress Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")

    remove_response = client.delete(f"/api/v1/test-runs/{run['id']}/cases/{run_case_id}")
    assert remove_response.status_code == 409


def test_assign_execution_responsibility(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Assignable Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]

    assign_response = client.patch(
        f"/api/v1/test-run-cases/{run_case_id}/assign", json={"assigned_to": tester_id}
    )
    assert assign_response.status_code == 200, assign_response.text
    assert assign_response.json()["data"]["assigned_to"] == tester_id

    context = client.get(f"/api/v1/test-run-cases/{run_case_id}/context").json()["data"]
    assert context["assignee_id"] == tester_id
    assert context["assignee_name"] == "Tester One"


def test_run_case_context_includes_display_fields(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Context Run", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]

    context = client.get(f"/api/v1/test-run-cases/{run_case_id}/context").json()["data"]
    assert context["run_name"] == "Context Run"
    assert context["project_name"] == project["name"]
    assert context["test_case_title"] == case["title"]
    assert context["priority"] == case["priority"]
    assert context["version_number"] == case["version_number"]
    assert context["run_finished"] is False
    assert context["run_paused"] is False


def test_pause_blocks_step_actions_until_resumed(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Pausable Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    pause_response = client.post(f"/api/v1/test-runs/{run['id']}/pause")
    assert pause_response.status_code == 200, pause_response.text
    assert pause_response.json()["data"]["paused_at"] is not None

    blocked_open = client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")
    assert blocked_open.status_code == 409
    blocked_verdict = client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    assert blocked_verdict.status_code == 409

    resume_response = client.post(f"/api/v1/test-runs/{run['id']}/resume")
    assert resume_response.status_code == 200
    assert resume_response.json()["data"]["paused_at"] is None

    allowed = client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")
    assert allowed.status_code == 200


def test_opening_a_step_twice_does_not_reset_the_timer(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Idempotent Open Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    first_open = client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open").json()["data"]
    time.sleep(0.2)
    second_open = client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open").json()["data"]

    assert first_open["opened_at"] == second_open["opened_at"]


def test_timing_accuracy_reflects_elapsed_time(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Timing Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")
    time.sleep(0.3)
    verdict_response = client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    duration_ms = verdict_response.json()["data"]["duration_ms"]
    # Generous bounds: server-measured elapsed time for a ~300ms sleep,
    # allowing for test-runner/HTTP overhead but catching gross errors
    # (e.g. a duration of 0, or one computed from the wrong timestamps).
    assert 250 <= duration_ms <= 3000


def test_concurrent_verdicts_on_different_steps_do_not_corrupt_rollup(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Concurrent Run", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    assert len(steps) == 3

    def _verdict(step_id: str, verdict: str) -> dict:
        thread_client = TestClient(client.app)
        thread_client.cookies.update(client.cookies)
        return thread_client.post(
            f"/api/v1/execution-steps/{step_id}/verdict", json={"verdict": verdict}
        ).json()

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [
            pool.submit(_verdict, steps[0]["id"], "pass"),
            pool.submit(_verdict, steps[1]["id"], "pass"),
            pool.submit(_verdict, steps[2]["id"], "pass"),
        ]
        for f in futures:
            f.result()

    run_detail = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    updated_case = run_detail["cases"][0]
    assert updated_case["passed_count"] == 3
    assert updated_case["status"] == "passed"


def test_tester_cannot_execute_unassigned_run_case(
    client: TestClient, platform_admin: dict
) -> None:
    """ADR-059: strict assignee-based execution -- a Tester (or any role
    without project.view.all) may only execute a run case explicitly
    assigned to them. No unassigned-run-case fallback."""
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester2@horizon.com", "Tester Two", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Strict Assign Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester2@horizon.com", "TesterPassw0rd!")

    # Not assigned -- blocked even though they're a project member.
    blocked = tester_client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")
    assert blocked.status_code == 403, blocked.text

    # Admin assigns the run case to this tester.
    assign = client.patch(
        f"/api/v1/test-run-cases/{run_case_id}/assign", json={"assigned_to": tester_id}
    )
    assert assign.status_code == 200, assign.text

    # Now the assigned tester can execute it.
    allowed = tester_client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")
    assert allowed.status_code == 200, allowed.text
    verdict = tester_client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    assert verdict.status_code == 200, verdict.text


def test_admin_and_manager_execute_without_assignment(
    client: TestClient, platform_admin: dict
) -> None:
    """Full-access roles (Admin/Manager, or a custom role with
    project.view.all) are unaffected by the strict assignee rule."""
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    manager_id = _create_user(
        client, "manager2@horizon.com", "Manager Two", "manager", "ManagerPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": manager_id})

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Manager Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager2@horizon.com", "ManagerPassw0rd!")

    # Unassigned run case -- Manager can still execute it directly.
    allowed = manager_client.post(f"/api/v1/execution-steps/{steps[0]['id']}/open")
    assert allowed.status_code == 200, allowed.text
