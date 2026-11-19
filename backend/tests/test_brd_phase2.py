"""BRD gap Phase 2 (ADR-070): Block Case, run auto-finish, soft-deleted runs and
defects, metadata-only test case edits and the bulk priority/assignee update."""

from fastapi.testclient import TestClient

from tests.test_execution import (
    _bootstrap_tenant,
    _create_approved_case,
    _create_project,
    _create_user,
    _login_and_verify,
    _setup_admin_project_and_case,
)


def _make_run(client: TestClient, project_id: str, case_ids: list[str], name: str = "Phase2 Run"):
    response = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": name, "run_type": "Regression", "test_case_ids": case_ids},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _steps(client: TestClient, run_case_id: str) -> list[dict]:
    return client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]


def _pass_all_steps(client: TestClient, run_case_id: str) -> None:
    for step in _steps(client, run_case_id):
        response = client.post(
            f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"}
        )
        assert response.status_code == 200, response.text


def _audit_actions(client: TestClient, action: str) -> list[dict]:
    response = client.get("/api/v1/audit-logs", params={"action": action, "limit": 50})
    assert response.status_code == 200, response.text
    return response.json()["data"]


# -- Block Case --------------------------------------------------------------


def test_block_requires_reason_and_blocks_verdicts_until_unblocked(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    run = _make_run(client, project["id"], [case["id"], case2["id"]])
    run_case_id = run["cases"][0]["id"]

    assert client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={}).status_code == 422
    short = client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "x"})
    assert short.status_code == 422

    blocked = client.post(
        f"/api/v1/test-run-cases/{run_case_id}/block",
        json={"reason": "Test environment is down"},
    )
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["data"]["status"] == "blocked"

    detail = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    case_out = next(c for c in detail["cases"] if c["id"] == run_case_id)
    assert case_out["status"] == "blocked"
    assert case_out["blocked_reason"] == "Test environment is down"
    context = client.get(f"/api/v1/test-run-cases/{run_case_id}/context").json()["data"]
    assert context["status"] == "blocked"
    assert context["blocked_reason"] == "Test environment is down"

    # Verdicts and step opens are refused while blocked; blocking twice conflicts.
    step = _steps(client, run_case_id)[0]
    assert client.post(f"/api/v1/execution-steps/{step['id']}/open").status_code == 409
    verdict = client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    assert verdict.status_code == 409
    again = client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "again"})
    assert again.status_code == 409

    # The run is NOT finished (case 2 is still open); blocked is a reported state.
    assert detail["finished_at"] is None

    unblocked = client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock")
    assert unblocked.status_code == 200, unblocked.text
    assert unblocked.json()["data"]["status"] == "pending"
    assert unblocked.json()["data"]["blocked_reason"] is None
    assert client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock").status_code == 409
    ok = client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    assert ok.status_code == 200, ok.text

    assert len(_audit_actions(client, "testrun.case_blocked")) == 1
    assert len(_audit_actions(client, "testrun.case_unblocked")) == 1


def test_unblock_restores_in_progress_status_from_step_verdicts(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    run = _make_run(client, project["id"], [case["id"], case2["id"]])
    run_case_id = run["cases"][0]["id"]
    first_step = _steps(client, run_case_id)[0]
    client.post(f"/api/v1/execution-steps/{first_step['id']}/verdict", json={"verdict": "pass"})

    client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "Waiting on data"})
    unblocked = client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock").json()["data"]
    assert unblocked["status"] == "in_progress"


def test_tester_blocks_only_assigned_run_case(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    run = _make_run(client, project["id"], [case["id"], case2["id"]])
    mine, theirs = run["cases"][0]["id"], run["cases"][1]["id"]
    client.patch(f"/api/v1/test-run-cases/{mine}/assign", json={"assigned_to": tester_id})

    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    denied = tester.post(f"/api/v1/test-run-cases/{theirs}/block", json={"reason": "not mine"})
    assert denied.status_code == 403, denied.text
    allowed = tester.post(f"/api/v1/test-run-cases/{mine}/block", json={"reason": "Env down"})
    assert allowed.status_code == 200, allowed.text


def test_cannot_block_on_finished_run(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    run_case_id = run["cases"][0]["id"]
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 200
    blocked = client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "late"})
    assert blocked.status_code == 409


# -- Auto-finish -------------------------------------------------------------


def test_run_auto_finishes_when_every_case_has_a_final_verdict(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    run = _make_run(client, project["id"], [case["id"], case2["id"]])
    first, second = run["cases"][0]["id"], run["cases"][1]["id"]

    _pass_all_steps(client, first)
    mid = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert mid["finished_at"] is None  # case 2 still pending

    _pass_all_steps(client, second)
    done = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert done["finished_at"] is not None

    # Idempotent: no second finish, manual finish now conflicts, exactly one event.
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 409
    events = [e for e in _audit_actions(client, "testrun.finished") if e["entity_id"] == run["id"]]
    assert len(events) == 1
    assert events[0]["metadata"].get("auto") is True


def test_blocked_counts_as_final_for_auto_finish(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    run = _make_run(client, project["id"], [case["id"], case2["id"]])
    first, second = run["cases"][0]["id"], run["cases"][1]["id"]

    client.post(f"/api/v1/test-run-cases/{first}/block", json={"reason": "Env down"})
    assert client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["finished_at"] is None
    _pass_all_steps(client, second)
    done = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert done["finished_at"] is not None
    # Can no longer be unblocked once the run is finished.
    assert client.post(f"/api/v1/test-run-cases/{first}/unblock").status_code == 409


def test_blocking_the_last_open_case_finishes_the_run(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    client.post(
        f"/api/v1/test-run-cases/{run['cases'][0]['id']}/block", json={"reason": "No build"}
    )
    assert client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["finished_at"] is not None


def test_failed_case_keeps_the_run_open_so_it_can_be_re_run_after_the_fix(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    run_case_id = run["cases"][0]["id"]
    steps = _steps(client, run_case_id)
    # One failed step makes the case 'failed' (ADR-024) but its remaining steps
    # are still to be executed, so the run must NOT lock underneath the tester.
    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "fail"})
    detail = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert detail["cases"][0]["status"] == "failed"
    assert detail["finished_at"] is None
    # Every step recorded, still failed: the run stays open for the re-run (BRD Journey 4).
    for step in steps[1:]:
        client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    detail = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert detail["cases"][0]["status"] == "failed"
    assert detail["finished_at"] is None
    # After the fix the step is re-verdicted to Pass: the case passes and the run finishes.
    redo = client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"}
    )
    assert redo.status_code == 200
    detail = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert detail["cases"][0]["status"] == "passed"
    assert detail["finished_at"] is not None


def test_run_with_a_failed_case_can_still_be_finished_by_hand(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    for step in _steps(client, run["cases"][0]["id"]):
        client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "fail"})
    assert client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["finished_at"] is None
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 200


def test_paused_run_does_not_auto_finish(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]], name="Paused Run")
    assert client.post(f"/api/v1/test-runs/{run['id']}/pause").status_code == 200
    step = _steps(client, run["cases"][0]["id"])[0]
    # A paused run refuses verdicts, so it can never auto-finish while paused.
    paused = client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    assert paused.status_code == 409
    assert client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["finished_at"] is None


# -- Soft delete: runs ---------------------------------------------------------


def test_delete_run_is_soft_and_excluded_everywhere(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]], name="Doomed Run")
    keep = _make_run(client, project["id"], [case["id"]], name="Surviving Run")

    summary_before = client.get("/api/v1/dashboard/summary").json()["data"]
    assert summary_before["test_runs"]["active"] == 2

    deleted = client.delete(f"/api/v1/test-runs/{run['id']}")
    assert deleted.status_code == 200, deleted.text

    listing = client.get(f"/api/v1/projects/{project['id']}/test-runs").json()["data"]
    assert [r["id"] for r in listing] == [keep["id"]]
    assert client.get(f"/api/v1/test-runs/{run['id']}").status_code == 404
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 404
    assert client.delete(f"/api/v1/test-runs/{run['id']}").status_code == 404

    summary_after = client.get("/api/v1/dashboard/summary").json()["data"]
    assert summary_after["test_runs"]["active"] == 1

    events = _audit_actions(client, "testrun.deleted")
    assert len(events) == 1 and events[0]["entity_id"] == run["id"]


def test_tester_cannot_delete_run_and_other_tenant_cannot_see_it(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    run = _make_run(client, project["id"], [case["id"]])

    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert tester.delete(f"/api/v1/test-runs/{run['id']}").status_code == 403

    other = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Other Mutual",
            "admin_name": "Other Admin",
            "admin_email": "admin@other.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    other_client = TestClient(client.app)
    _login_and_verify(other_client, other["tenant"]["id"], "admin@other.com", "AdminPassw0rd!")
    assert other_client.delete(f"/api/v1/test-runs/{run['id']}").status_code == 404
    # Still there for its own tenant.
    assert client.get(f"/api/v1/test-runs/{run['id']}").status_code == 200


# -- Soft delete: defects ------------------------------------------------------


def _create_defect(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": title, "severity": "High"},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_delete_defect_is_soft_and_excluded_from_lists_and_counts(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    _login_and_verify(client, bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    doomed = _create_defect(client, project["id"], "Duplicate premium rounding")
    keeper = _create_defect(client, project["id"], "Wrong deductible shown")

    before = client.get("/api/v1/dashboard/summary").json()["data"]
    assert before["defects"]["open_by_severity"]["High"] == 2

    deleted = client.delete(f"/api/v1/defects/{doomed['id']}")
    assert deleted.status_code == 200, deleted.text

    listed = client.get("/api/v1/defects", params={"project_id": project["id"]}).json()["data"]
    assert [d["id"] for d in listed] == [keeper["id"]]
    assert client.get(f"/api/v1/defects/{doomed['id']}").status_code == 404
    after = client.get("/api/v1/dashboard/summary").json()["data"]
    assert after["defects"]["open_by_severity"]["High"] == 1
    assert client.delete(f"/api/v1/defects/{doomed['id']}").status_code == 404

    events = _audit_actions(client, "defect.deleted")
    assert len(events) == 1 and events[0]["entity_id"] == doomed["id"]


def test_tester_cannot_delete_defect_manager_can(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    manager_id = _create_user(
        client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!"
    )
    for user_id in (tester_id, manager_id):
        client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": user_id})
    defect = _create_defect(client, project["id"], "Premium shown as zero")

    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert tester.delete(f"/api/v1/defects/{defect['id']}").status_code == 403

    manager = TestClient(client.app)
    _login_and_verify(manager, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")
    assert manager.delete(f"/api/v1/defects/{defect['id']}").status_code == 200


def test_other_tenant_cannot_delete_defect(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    _login_and_verify(client, bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    defect = _create_defect(client, project["id"], "Cross tenant probe")
    other = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Other Mutual",
            "admin_name": "Other Admin",
            "admin_email": "admin@other.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    other_client = TestClient(client.app)
    _login_and_verify(other_client, other["tenant"]["id"], "admin@other.com", "AdminPassw0rd!")
    assert other_client.delete(f"/api/v1/defects/{defect['id']}").status_code == 404
    assert client.get(f"/api/v1/defects/{defect['id']}").status_code == 200


# -- Metadata-only test case edits (rule A) ------------------------------------


def test_priority_and_assignee_edits_do_not_fork_or_unapprove(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    me = client.get("/api/v1/auth/me").json()["data"]
    assert case["status"] == "approved"
    version_before = case["version_number"]

    response = client.patch(
        f"/api/v1/test-cases/{case['id']}", json={"priority": "Low", "assignee_id": me["user_id"]}
    )
    assert response.status_code == 200, response.text
    updated = response.json()["data"]
    assert updated["status"] == "approved"
    assert updated["version_number"] == version_before
    assert updated["priority"] == "Low"
    assert updated["assignee_id"] == me["user_id"]

    # Re-submitting the unchanged content next to a new priority is still metadata-only.
    steps = [{"action": s["action"], "expected": s["expected"]} for s in updated["steps"]]
    again = client.patch(
        f"/api/v1/test-cases/{case['id']}",
        json={"title": updated["title"], "steps": steps, "priority": "Critical"},
    ).json()["data"]
    assert again["status"] == "approved" and again["version_number"] == version_before

    # A real content change still forks and reverts to draft (ADR-020 unchanged).
    forked = client.patch(
        f"/api/v1/test-cases/{case['id']}", json={"title": "Verify Total Loss Settlement v2"}
    ).json()["data"]
    assert forked["status"] == "draft"
    assert forked["version_number"] == version_before + 1


# -- Bulk update ---------------------------------------------------------------


def test_bulk_update_priority_and_assignee_with_per_item_results(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    me = client.get("/api/v1/auth/me").json()["data"]
    ghost = "00000000-0000-0000-0000-000000000000"

    nothing = client.post("/api/v1/test-cases/bulk-update", json={"test_case_ids": [case["id"]]})
    assert nothing.status_code == 422

    response = client.post(
        "/api/v1/test-cases/bulk-update",
        json={
            "test_case_ids": [case["id"], case2["id"], ghost],
            "priority": "Low",
            "assignee_id": me["user_id"],
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["updated"] == 2 and data["failed"] == 1, data
    failed = next(r for r in data["results"] if not r["ok"])
    assert failed["test_case_id"] == ghost and failed["error"]

    for case_id in (case["id"], case2["id"]):
        got = client.get(f"/api/v1/test-cases/{case_id}").json()["data"]
        assert got["priority"] == "Low"
        assert got["assignee_id"] == me["user_id"]
        assert got["status"] == "approved"
        assert got["version_number"] == 1

    # Explicit null unassigns; omitting assignee_id leaves it alone.
    client.post(
        "/api/v1/test-cases/bulk-update",
        json={"test_case_ids": [case["id"]], "assignee_id": None},
    )
    assert client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]["assignee_id"] is None
    client.post(
        "/api/v1/test-cases/bulk-update",
        json={"test_case_ids": [case2["id"]], "priority": "High"},
    )
    kept = client.get(f"/api/v1/test-cases/{case2['id']}").json()["data"]
    assert kept["priority"] == "High" and kept["assignee_id"] == me["user_id"]


def test_bulk_update_respects_project_access(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    _create_user(client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!")
    # Tester is NOT a member of the project.
    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    response = tester.post(
        "/api/v1/test-cases/bulk-update",
        json={"test_case_ids": [case["id"]], "priority": "Low"},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["updated"] == 0 and data["failed"] == 1
    assert client.get(f"/api/v1/test-cases/{case['id']}").json()["data"]["priority"] == "High"
