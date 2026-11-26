"""My Work: read-only lists of the caller's own pending run cases and reviews."""

from fastapi.testclient import TestClient

from tests.test_execution import (
    _bootstrap_tenant,
    _create_approved_case,
    _create_project,
    _create_user,
    _login_and_verify,
    _sample_steps,
)

TESTER = ("tester@horizon.com", "TesterPassw0rd!")
MANAGER = ("manager@horizon.com", "ManagerPassw0rd!")


def _setup(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    tester_id = _create_user(client, TESTER[0], "Tester One", "tester", TESTER[1])
    manager_id = _create_user(client, MANAGER[0], "Manager One", "manager", MANAGER[1])
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    return {
        "tenant_id": tenant_id,
        "project": project,
        "tester_id": tester_id,
        "manager_id": manager_id,
    }


def _as(client: TestClient, tenant_id: str, creds: tuple[str, str]) -> TestClient:
    other = TestClient(client.app)
    _login_and_verify(other, tenant_id, creds[0], creds[1])
    return other


def _run_with_cases(client: TestClient, project_id: str, titles: list[str]) -> dict:
    cases = [_create_approved_case(client, project_id, t) for t in titles]
    response = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={
            "name": "My Work Run",
            "run_type": "Regression",
            "test_case_ids": [c["id"] for c in cases],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_requires_sign_in(client: TestClient) -> None:
    for path in ("summary", "run-cases", "reviews"):
        assert client.get(f"/api/v1/my-work/{path}").status_code == 401


def test_run_cases_are_only_the_callers_open_assignments(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    run = _run_with_cases(
        client, ctx["project"]["id"], ["Verify Total Loss Settlement", "Verify Salvage Transfer"]
    )
    first, second = run["cases"]
    for rc in (first, second):
        assigned = client.patch(
            f"/api/v1/test-run-cases/{rc['id']}/assign", json={"assigned_to": ctx["tester_id"]}
        )
        assert assigned.status_code == 200, assigned.text

    tester = _as(client, ctx["tenant_id"], TESTER)
    listing = tester.get("/api/v1/my-work/run-cases").json()["data"]
    assert listing["total"] == 2
    assert {i["id"] for i in listing["items"]} == {first["id"], second["id"]}
    assert {i["status"] for i in listing["items"]} == {"pending"}
    item = listing["items"][0]
    assert item["project_name"] == ctx["project"]["name"]
    assert item["run_name"] == "My Work Run"
    assert item["run_paused"] is False

    # Nothing assigned to the admin or the manager.
    assert client.get("/api/v1/my-work/run-cases").json()["data"]["total"] == 0
    manager = _as(client, ctx["tenant_id"], MANAGER)
    assert manager.get("/api/v1/my-work/summary").json()["data"]["run_cases_total"] == 0

    # Blocking moves one case to the blocked bucket; the summary matches the list.
    blocked = client.post(
        f"/api/v1/test-run-cases/{first['id']}/block", json={"reason": "Environment is down"}
    )
    assert blocked.status_code == 200, blocked.text
    summary = tester.get("/api/v1/my-work/summary").json()["data"]
    assert summary["run_cases_blocked"] == 1
    assert summary["run_cases_pending"] == 1
    assert (
        summary["run_cases_total"]
        == tester.get("/api/v1/my-work/run-cases").json()["data"]["total"]
        == 2
    )
    statuses = [
        i["status"] for i in tester.get("/api/v1/my-work/run-cases").json()["data"]["items"]
    ]
    assert statuses == ["blocked", "pending"]

    # A finished run no longer counts as pending work.
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 200
    assert tester.get("/api/v1/my-work/summary").json()["data"]["run_cases_total"] == 0
    assert tester.get("/api/v1/my-work/run-cases").json()["data"]["items"] == []


def test_assignment_outside_visible_projects_is_hidden(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    other = _create_project(client, "Beacon Marine")
    run = _run_with_cases(client, other["id"], ["Verify Hull Coverage Limit"])
    rc = run["cases"][0]
    # The tester is not a member of this project, so its work is not theirs to see.
    client.patch(
        f"/api/v1/test-run-cases/{rc['id']}/assign", json={"assigned_to": ctx["tester_id"]}
    )
    tester = _as(client, ctx["tenant_id"], TESTER)
    assert tester.get("/api/v1/my-work/run-cases").json()["data"]["total"] == 0
    assert tester.get("/api/v1/my-work/summary").json()["data"]["run_cases_total"] == 0


def test_reviews_are_cases_waiting_on_the_caller(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin)
    project_id = ctx["project"]["id"]
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": "Verify Subrogation Notice", "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    submitted = client.post(
        f"/api/v1/test-cases/{case['id']}/submit-review", json={"reviewer_id": ctx["manager_id"]}
    )
    assert submitted.status_code == 200, submitted.text

    manager = _as(client, ctx["tenant_id"], MANAGER)
    reviews = manager.get("/api/v1/my-work/reviews").json()["data"]
    assert reviews["total"] == 1
    assert reviews["items"][0]["id"] == case["id"]
    assert reviews["items"][0]["project_name"] == ctx["project"]["name"]
    assert manager.get("/api/v1/my-work/summary").json()["data"]["reviews_total"] == 1

    # Named reviewer only: the admin who submitted it has nothing to review.
    assert client.get("/api/v1/my-work/reviews").json()["data"]["total"] == 0

    # Once approved it is no longer waiting.
    assert manager.post(f"/api/v1/test-cases/{case['id']}/approve").status_code == 200
    assert manager.get("/api/v1/my-work/reviews").json()["data"]["total"] == 0
    assert manager.get("/api/v1/my-work/summary").json()["data"]["reviews_total"] == 0


def test_tasks_are_the_callers_unfinished_ones_in_projects_they_can_open(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    project = ctx["project"]
    statuses = {s["code"]: s["id"] for s in client.get("/api/v1/task-statuses").json()["data"]}

    def make(title: str, **extra) -> dict:
        response = client.post(
            f"/api/v1/projects/{project['id']}/tasks",
            json={"title": title, "assignee_id": ctx["tester_id"], **extra},
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    undated = make("No due date")
    later = make("Due later", due_date="2999-01-01")
    late = make("Already late", due_date="2000-01-01")
    finished = make("Finished work", due_date="2000-01-01")
    removed = make("Deleted work", due_date="2000-01-01")
    client.post(f"/api/v1/projects/{project['id']}/tasks", json={"title": "Nobody has this"})
    done = client.post(
        f"/api/v1/tasks/{finished['id']}/status", json={"status_id": statuses["done"]}
    )
    assert done.status_code == 200, done.text
    assert client.delete(f"/api/v1/tasks/{removed['id']}").status_code == 200

    tester = _as(client, ctx["tenant_id"], TESTER)
    listing = tester.get("/api/v1/my-work/tasks").json()["data"]
    assert [i["id"] for i in listing["items"]] == [late["id"], later["id"], undated["id"]]
    assert listing["total"] == 3
    assert [i["overdue"] for i in listing["items"]] == [True, False, False]
    assert listing["items"][0]["project_name"] == project["name"]
    summary = tester.get("/api/v1/my-work/summary").json()["data"]
    assert (summary["tasks_total"], summary["tasks_overdue"]) == (3, 1)

    # Only the assignee's own tasks.
    assert client.get("/api/v1/my-work/tasks").json()["data"]["total"] == 0
    assert TestClient(client.app).get("/api/v1/my-work/tasks").status_code == 401

    # Once the tester leaves the project they cannot open its tasks, so none are listed.
    left = client.delete(f"/api/v1/projects/{project['id']}/members/{ctx['tester_id']}")
    assert left.status_code == 200, left.text
    assert tester.get(f"/api/v1/tasks/{late['id']}").status_code == 403
    assert tester.get("/api/v1/my-work/tasks").json()["data"]["total"] == 0
    assert tester.get("/api/v1/my-work/summary").json()["data"]["tasks_total"] == 0
