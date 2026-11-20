"""ADR-075: reopening a finished test run.

Blocking the last open case auto-finishes a run, and a finished run is locked,
so the blocked case could never be unblocked (and a run finished by mistake
could never be continued). `POST /test-runs/{id}/reopen` undoes the finish.
"""

from fastapi.testclient import TestClient

from tests.test_brd_phase2 import _audit_actions, _make_run, _pass_all_steps, _steps
from tests.test_execution import (
    _create_user,
    _login_and_verify,
    _setup_admin_project_and_case,
)


def _run(client: TestClient, run_id: str) -> dict:
    return client.get(f"/api/v1/test-runs/{run_id}").json()["data"]


def test_reopen_lets_a_blocked_case_be_unblocked_and_the_run_finish_again(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    run_case_id = run["cases"][0]["id"]
    client.post(f"/api/v1/test-run-cases/{run_case_id}/block", json={"reason": "No build"})
    finished = _run(client, run["id"])
    assert finished["finished_at"] is not None

    # The case cannot be touched while the run is finished.
    assert client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock").status_code == 409

    reopened = client.post(f"/api/v1/test-runs/{run['id']}/reopen")
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["data"]["finished_at"] is None

    # Nothing else changed: the case is still blocked, and reopening did not
    # re-finish the run by itself.
    after = _run(client, run["id"])
    assert after["finished_at"] is None
    assert after["cases"][0]["status"] == "blocked"

    assert client.post(f"/api/v1/test-run-cases/{run_case_id}/unblock").status_code == 200
    _pass_all_steps(client, run_case_id)
    assert _run(client, run["id"])["finished_at"] is not None


def test_reopen_keeps_results_and_leaves_both_audit_events(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    run_case_id = run["cases"][0]["id"]
    _pass_all_steps(client, run_case_id)
    before = _run(client, run["id"])
    assert before["finished_at"] is not None

    assert client.post(f"/api/v1/test-runs/{run['id']}/reopen").status_code == 200
    after = _run(client, run["id"])
    assert after["finished_at"] is None
    assert after["cases"][0]["status"] == before["cases"][0]["status"] == "passed"
    assert [s["verdict"] for s in _steps(client, run_case_id)] == ["pass"] * len(
        _steps(client, run_case_id)
    )

    reopened = _audit_actions(client, "testrun.reopened")
    assert len(reopened) == 1 and reopened[0]["entity_id"] == run["id"]
    assert reopened[0]["metadata"]["previous_finished_at"]
    assert len(_audit_actions(client, "testrun.finished")) == 1


def test_cannot_reopen_a_run_that_is_not_finished_or_reopen_twice(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    assert client.post(f"/api/v1/test-runs/{run['id']}/reopen").status_code == 409

    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 200
    assert client.post(f"/api/v1/test-runs/{run['id']}/reopen").status_code == 200
    assert client.post(f"/api/v1/test-runs/{run['id']}/reopen").status_code == 409
    assert len(_audit_actions(client, "testrun.reopened")) == 1


def test_tester_cannot_reopen_a_run(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    run = _make_run(client, project["id"], [case["id"]])
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 200

    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert tester.post(f"/api/v1/test-runs/{run['id']}/reopen").status_code == 403
    assert _run(client, run["id"])["finished_at"] is not None


def test_other_tenant_cannot_reopen_and_deleted_runs_cannot_be_reopened(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 200

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
    assert other_client.post(f"/api/v1/test-runs/{run['id']}/reopen").status_code == 404

    assert client.delete(f"/api/v1/test-runs/{run['id']}").status_code == 200
    assert client.post(f"/api/v1/test-runs/{run['id']}/reopen").status_code == 404
