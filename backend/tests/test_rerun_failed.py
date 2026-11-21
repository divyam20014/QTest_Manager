"""ADR-096: POST /test-runs/{id}/rerun-failed."""

from fastapi.testclient import TestClient

from tests.test_access_rules import _as, _freeze, _setup
from tests.test_brd_phase2 import _audit_actions, _make_run, _pass_all_steps, _steps
from tests.test_execution import (
    _create_approved_case,
    _create_user,
    _login_and_verify,
    _setup_admin_project_and_case,
)


def _fail_case(client: TestClient, run_case_id: str) -> None:
    step = _steps(client, run_case_id)[0]
    r = client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "fail"})
    assert r.status_code == 200, r.text


def _mixed_run(client: TestClient, project: dict, case: dict) -> tuple[dict, dict]:
    """Four cases: failed, blocked, passed, pending. Returns (run, by-title status map)."""
    extra = [
        _create_approved_case(client, project["id"], f"Rerun Extra Case {i}") for i in range(3)
    ]
    run = _make_run(client, project["id"], [case["id"], *(c["id"] for c in extra)], "Nightly")
    ids = [c["id"] for c in run["cases"]]
    _fail_case(client, ids[0])
    client.post(f"/api/v1/test-run-cases/{ids[1]}/block", json={"reason": "No build"})
    _pass_all_steps(client, ids[2])
    return run, {"failed": ids[0], "blocked": ids[1], "passed": ids[2], "pending": ids[3]}


def test_rerun_contains_only_failed_and_blocked_cases(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run, ids = _mixed_run(client, project, case)

    resp = client.post(f"/api/v1/test-runs/{run['id']}/rerun-failed")
    assert resp.status_code == 200, resp.text
    new = resp.json()["data"]
    assert new["id"] != run["id"]
    assert new["name"] == "Nightly (rerun)"
    assert new["original_run_id"] == run["id"]
    assert new["finished_at"] is None
    source_cases = {
        c["id"]: c for c in client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["cases"]
    }
    expected = {
        source_cases[ids["failed"]]["test_case_id"],
        source_cases[ids["blocked"]]["test_case_id"],
    }
    assert {c["test_case_id"] for c in new["cases"]} == expected
    assert all(c["status"] == "pending" for c in new["cases"])
    # Original run is untouched.
    assert len(source_cases) == 4

    events = _audit_actions(client, "testrun.rerun_created")
    assert len(events) == 1 and events[0]["entity_id"] == new["id"]
    assert events[0]["metadata"]["original_run_id"] == run["id"]


def test_rerun_copies_assignee(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    run = _make_run(client, project["id"], [case["id"]])
    rc = run["cases"][0]["id"]
    assert (
        client.patch(
            f"/api/v1/test-run-cases/{rc}/assign", json={"assigned_to": tester_id}
        ).status_code
        == 200
    )
    _fail_case(client, rc)
    new = client.post(f"/api/v1/test-runs/{run['id']}/rerun-failed").json()["data"]
    assert new["cases"][0]["assigned_to"] == tester_id


def test_rerun_works_on_a_finished_run_and_409s_when_nothing_to_rerun(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    # Pending only -> nothing to rerun.
    assert client.post(f"/api/v1/test-runs/{run['id']}/rerun-failed").status_code == 409
    _pass_all_steps(client, run["cases"][0]["id"])
    assert client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["finished_at"]
    assert client.post(f"/api/v1/test-runs/{run['id']}/rerun-failed").status_code == 409

    run2 = _make_run(client, project["id"], [case["id"]], "Second")
    _fail_case(client, run2["cases"][0]["id"])
    assert client.post(f"/api/v1/test-runs/{run2['id']}/finish").status_code == 200
    assert client.post(f"/api/v1/test-runs/{run2['id']}/rerun-failed").status_code == 200


def test_unassigned_tester_cannot_rerun_and_other_tenant_gets_404(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    _create_user(client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!")
    # Not a project member: project access is enforced like run creation.
    run = _make_run(client, project["id"], [case["id"]])
    _fail_case(client, run["cases"][0]["id"])

    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert tester.post(f"/api/v1/test-runs/{run['id']}/rerun-failed").status_code == 403

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
    assert other_client.post(f"/api/v1/test-runs/{run['id']}/rerun-failed").status_code == 404
    assert len(client.get(f"/api/v1/projects/{project['id']}/test-runs").json()["data"]) == 1


def test_access_rule_blocks_rerun_with_a_reason(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Rerun Freeze")
    pid = ctx["project"]["id"]
    _as(client, ctx, "admin")
    case = _create_approved_case(client, pid, "Freeze Rerun Case")
    run = _make_run(client, pid, [case["id"]])
    _fail_case(client, run["cases"][0]["id"])
    _freeze(client, blocked_actions=["testrun"], exempt_roles=[])
    _as(client, ctx, "manager")
    resp = client.post(f"/api/v1/test-runs/{run['id']}/rerun-failed")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "blocked_by_access_rule"
