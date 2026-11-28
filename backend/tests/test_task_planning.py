"""ADR-144 (Phase 2A): task types, estimates and one shared backlog order."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from tests.test_execution import (
    _bootstrap_tenant,
    _create_project,
    _create_user,
    _login_and_verify,
)

API = "/api/v1"
PASSWORD = "UserPassw0rd!!"


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return {"tenant_id": tenant_id, "project": _create_project(client)["id"]}


def _task(client: TestClient, project: str, title: str, **extra) -> dict:
    return _ok(client.post(f"{API}/projects/{project}/tasks", json={"title": title, **extra}))


def _backlog(client: TestClient, project: str, **params) -> list[str]:
    data = _ok(client.get(f"{API}/projects/{project}/backlog", params=params))
    return [t["title"] for t in data["items"]]


def _move(client: TestClient, task: dict, before: dict | None):
    body = {"before_task_id": before["id"] if before else None}
    return client.post(f"{API}/tasks/{task['id']}/rank", json=body)


def _sign_in(client: TestClient, world: dict, key: str, role: str) -> TestClient:
    user = _create_user(client, f"{key}@horizon.com", key.title(), "tester", PASSWORD)
    if role != "tester":
        roles = {r["code"]: r["id"] for r in _ok(client.get(f"{API}/roles")) if r["code"]}
        _ok(client.patch(f"{API}/users/{user}", json={"role_id": roles[role]}))
    _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": user}))
    them = TestClient(client.app)
    _login_and_verify(them, world["tenant_id"], f"{key}@horizon.com", PASSWORD)
    return them


# --- types ----------------------------------------------------------------------------------


def _options(client: TestClient, key: str = "task_type") -> list[dict]:
    return _ok(client.get(f"{API}/field-options", params={"field_key": key}))


def test_every_organization_starts_with_three_task_types(client: TestClient, world: dict) -> None:
    assert [o["code"] for o in _options(client)] == ["Task", "Story", "Chore"]
    assert _task(client, world["project"], "Plain one")["task_type"] == "Task"
    story = _task(client, world["project"], "A story", task_type="Story")
    assert story["task_type"] == "Story"
    changed = _ok(client.patch(f"{API}/tasks/{story['id']}", json={"task_type": "Chore"}))
    assert changed["task_type"] == "Chore"


def test_unknown_types_and_clearing_the_type_are_refused(client: TestClient, world: dict) -> None:
    task = _task(client, world["project"], "Typed")
    for response in (
        client.post(
            f"{API}/projects/{world['project']}/tasks",
            json={"title": "Wrong type", "task_type": "Epic"},
        ),
        client.patch(f"{API}/tasks/{task['id']}", json={"task_type": "Epic"}),
        client.patch(f"{API}/tasks/{task['id']}", json={"task_type": None}),
    ):
        assert response.status_code == 422, response.text
        assert "task_type" in response.json()["error"]["fields"]


def test_an_organization_edits_its_own_type_list(client: TestClient, world: dict) -> None:
    _ok(
        client.post(
            f"{API}/field-options",
            json={"field_key": "task_type", "code": "Spike", "label": "Spike"},
        )
    )
    assert _task(client, world["project"], "Look into it", task_type="Spike")
    by_code = {o["code"]: o["id"] for o in _options(client)}

    in_use = client.delete(f"{API}/field-options/{by_code['Spike']}")
    assert in_use.status_code == 409, in_use.text
    unused = client.delete(f"{API}/field-options/{by_code['Chore']}")
    assert unused.status_code == 200, unused.text
    # With "Task" gone, new tasks take the first type left.
    unused = client.delete(f"{API}/field-options/{by_code['Task']}")
    assert unused.status_code == 200, unused.text
    assert _task(client, world["project"], "Takes the first")["task_type"] == "Story"


def test_a_task_priority_can_be_deleted_when_unused_and_not_when_used(
    client: TestClient, world: dict
) -> None:
    """Deleting one answered 500: the in-use check did not know about task fields."""
    _task(client, world["project"], "Uses High", priority="High")
    by_code = {o["code"]: o["id"] for o in _options(client, "task_priority")}

    used = client.delete(f"{API}/field-options/{by_code['High']}")
    unused = client.delete(f"{API}/field-options/{by_code['Low']}")

    assert used.status_code == 409, used.text
    assert unused.status_code == 200, unused.text


# --- estimates ------------------------------------------------------------------------------


def test_estimates_are_optional_hours_that_can_be_cleared(client: TestClient, world: dict) -> None:
    task = _task(client, world["project"], "Estimated", estimate_hours="2.5")
    assert task["estimate_hours"] == "2.50"
    assert _task(client, world["project"], "Not estimated")["estimate_hours"] is None
    cleared = _ok(client.patch(f"{API}/tasks/{task['id']}", json={"estimate_hours": None}))
    assert cleared["estimate_hours"] is None
    zero = _ok(client.patch(f"{API}/tasks/{task['id']}", json={"estimate_hours": 0}))
    assert zero["estimate_hours"] == "0.00"
    events = _ok(client.get(f"{API}/tasks/{task['id']}/history"))
    assert any("estimate_hours" in e["event_metadata"].get("fields", []) for e in events)


@pytest.mark.parametrize("value", [-1, 10001, "1.234", "soon"])
def test_impossible_estimates_are_refused(client: TestClient, world: dict, value: object) -> None:
    response = client.post(
        f"{API}/projects/{world['project']}/tasks",
        json={"title": "Bad estimate", "estimate_hours": value},
    )
    assert response.status_code == 422, response.text


# --- the backlog order ----------------------------------------------------------------------


def test_new_tasks_join_the_end_and_can_be_moved(client: TestClient, world: dict) -> None:
    a, b, c = (_task(client, world["project"], f"Task {n}") for n in "ABC")
    assert _backlog(client, world["project"]) == ["Task A", "Task B", "Task C"]

    _ok(_move(client, c, a))
    assert _backlog(client, world["project"]) == ["Task C", "Task A", "Task B"]
    _ok(_move(client, c, None))  # to the end
    assert _backlog(client, world["project"]) == ["Task A", "Task B", "Task C"]
    _ok(_move(client, b, b))  # before itself changes nothing
    assert _backlog(client, world["project"]) == ["Task A", "Task B", "Task C"]


def test_moving_changes_only_the_moved_task(client: TestClient, world: dict) -> None:
    a, b, c = (_task(client, world["project"], f"Task {n}") for n in "ABC")
    before = {t["id"]: _ok(client.get(f"{API}/tasks/{t['id']}"))["updated_at"] for t in (a, b)}

    _ok(_move(client, c, a))

    for task_id, updated_at in before.items():
        assert _ok(client.get(f"{API}/tasks/{task_id}"))["updated_at"] == updated_at


def test_the_order_survives_many_moves_into_the_same_gap(client: TestClient, world: dict) -> None:
    first, second, third = (_task(client, world["project"], f"Task {n}") for n in "123")
    for _ in range(45):  # 90 moves, each halving the gap after Task 1
        _ok(_move(client, third, second))
        _ok(_move(client, second, third))

    assert _backlog(client, world["project"]) == ["Task 1", "Task 2", "Task 3"]
    assert first


def test_the_backlog_holds_open_tasks_only_and_pages(client: TestClient, world: dict) -> None:
    project = world["project"]
    done = _task(client, project, "Finished work")
    for n in "ABC":
        _task(client, project, f"Task {n}")
    status = next(s for s in _ok(client.get(f"{API}/task-statuses")) if s["category"] == "done")
    _ok(client.post(f"{API}/tasks/{done['id']}/status", json={"status_id": status["id"]}))
    task = _task(client, project, "Holds a requirement")
    _ok(client.delete(f"{API}/tasks/{task['id']}"))
    # The holder of unassigned requirements is not work to plan.
    _ok(
        client.post(
            f"{API}/projects/{project}/requirements",
            json={"title": "Loose requirement", "description": "x"},
        )
    )

    assert _backlog(client, project) == ["Task A", "Task B", "Task C"]
    page = _ok(client.get(f"{API}/projects/{project}/backlog", params={"limit": 2, "offset": 2}))
    assert ([t["title"] for t in page["items"]], page["total"]) == (["Task C"], 3)


def test_a_task_cannot_be_placed_in_another_projects_backlog(
    client: TestClient, world: dict
) -> None:
    mine = _task(client, world["project"], "Mine")
    other = _create_project(client, "Other project")["id"]
    theirs = _task(client, other, "Theirs")

    response = _move(client, mine, theirs)

    assert response.status_code in (403, 404, 422), response.text


@pytest.mark.parametrize("role,expected", [("manager", 200), ("qa_lead", 200), ("developer", 403)])
def test_reordering_needs_permission_to_manage_tasks(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    a = _task(client, world["project"], "Task A")
    b = _task(client, world["project"], "Task B")
    them = _sign_in(client, world, "who", role)

    assert _move(them, b, a).status_code == expected
    assert them.get(f"{API}/projects/{world['project']}/backlog").status_code == 200


def test_an_archived_projects_backlog_cannot_be_reordered(client: TestClient, world: dict) -> None:
    a = _task(client, world["project"], "Task A")
    b = _task(client, world["project"], "Task B")
    _ok(client.post(f"{API}/projects/{world['project']}/archive"))

    response = _move(client, b, a)

    assert response.status_code == 409, response.text
    assert _backlog(client, world["project"]) == ["Task A", "Task B"]


def test_simultaneous_moves_leave_every_task_in_one_order(client: TestClient, world: dict) -> None:
    tasks = [_task(client, world["project"], f"Task {n}") for n in range(6)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(pool.map(lambda t: _move(client, t, tasks[0]).status_code, tasks[1:]))
    assert codes == [200] * 5
    titles = _backlog(client, world["project"])
    assert sorted(titles) == sorted(t["title"] for t in tasks)
    assert titles[-1] == "Task 0"  # all five went in front of it
