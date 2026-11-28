"""ADR-146 (Phase 2C): sprints and what they remember."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from tests.test_task_planning import (
    API,
    _bootstrap_tenant,
    _create_project,
    _login_and_verify,
    _ok,
    _sign_in,
    _task,
)


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return {
        "tenant_id": tenant_id,
        "project": _create_project(client)["id"],
        "other": _create_project(client, "Other project")["id"],
    }


def _sprint(client: TestClient, project: str, name: str = "Sprint 1", **extra) -> dict:
    body = {"name": name, "start_date": "2026-12-01", "end_date": "2026-12-14", **extra}
    return _ok(client.post(f"{API}/projects/{project}/sprints", json=body))


def _plan(client: TestClient, task: dict, sprint: dict | None):
    body = {"sprint_id": sprint["id"] if sprint else None}
    return client.put(f"{API}/tasks/{task['id']}/sprint", json=body)


def _start(client: TestClient, sprint: dict):
    return client.post(f"{API}/sprints/{sprint['id']}/start")


def _close(client: TestClient, sprint: dict, to: dict | None = None):
    body = {"move_unfinished_to": to["id"] if to else None}
    return client.post(f"{API}/sprints/{sprint['id']}/close", json=body)


def _read(client: TestClient, sprint: dict) -> dict:
    return _ok(client.get(f"{API}/sprints/{sprint['id']}"))


def _set_category(client: TestClient, task: dict, category: str) -> None:
    status = next(s for s in _ok(client.get(f"{API}/task-statuses")) if s["category"] == category)
    _ok(client.post(f"{API}/tasks/{task['id']}/status", json={"status_id": status["id"]}))


def _titles(detail: dict) -> list[str]:
    return [t["title"] for t in detail["tasks"]]


def _totals(detail: dict) -> dict[str, tuple[int, str]]:
    return {name: (t["count"], t["hours"]) for name, t in detail["totals"].items()}


def _backlog(client: TestClient, project: str) -> list[str]:
    return [t["title"] for t in _ok(client.get(f"{API}/projects/{project}/backlog"))["items"]]


# --- the life of a sprint -------------------------------------------------------------------


def test_closing_keeps_what_was_planned_added_removed_and_finished(
    client: TestClient, world: dict
) -> None:
    project = world["project"]
    done, open_, dropped, late = (
        _task(client, project, title, estimate_hours=hours)
        for title, hours in (("Done one", 3), ("Left open", 5), ("Dropped", 2), ("Added late", 1))
    )
    sprint = _sprint(client, project, goal="Ship it")
    for task in (done, open_, dropped):
        _ok(_plan(client, task, sprint))
    assert _read(client, sprint)["totals"]["planned"] == {"count": 3, "hours": "10.00"}

    _ok(_start(client, sprint))
    _ok(_plan(client, late, sprint))
    _ok(_plan(client, dropped, None))
    _set_category(client, done, "done")
    # A new estimate counts for what is left, not for what was planned.
    _ok(client.patch(f"{API}/tasks/{open_['id']}", json={"estimate_hours": 8}))
    closed = _ok(_close(client, sprint))

    expected = {
        "planned": (3, "10.00"),
        "added": (1, "1.00"),
        "removed": (1, "2.00"),
        "completed": (1, "3.00"),
        "unfinished": (2, "9.00"),
    }
    assert closed["state"] == "closed" and closed["closed_at"]
    assert _totals(closed) == expected
    assert (closed["task_count"], closed["done_count"], closed["estimate_hours"]) == (3, 1, "12.00")
    # Unfinished tasks went to the backlog; the finished one stays with the sprint.
    assert _backlog(client, project) == ["Left open", "Dropped", "Added late"]
    assert _ok(client.get(f"{API}/tasks/{done['id']}"))["sprint_name"] == "Sprint 1"
    assert _ok(client.get(f"{API}/tasks/{open_['id']}"))["sprint_id"] is None

    # Nothing that happens afterwards rewrites it.
    _ok(client.patch(f"{API}/tasks/{open_['id']}", json={"estimate_hours": 100}))
    _set_category(client, open_, "done")
    _set_category(client, done, "todo")
    later = _sprint(client, project, "Sprint 2")
    _ok(_plan(client, done, later))
    _ok(client.delete(f"{API}/tasks/{late['id']}"))

    after = _read(client, sprint)
    assert _totals(after) == expected
    assert sorted(_titles(after)) == ["Added late", "Done one", "Dropped", "Left open"]
    rows = {t["title"]: t for t in after["tasks"]}
    assert rows["Done one"]["done"] is True
    assert rows["Left open"]["done"] is False
    assert rows["Added late"]["deleted"] is True
    assert rows["Dropped"]["removed_at"] is not None


def test_unfinished_tasks_can_move_to_a_planned_sprint(client: TestClient, world: dict) -> None:
    project = world["project"]
    task = _task(client, project, "Carried over", estimate_hours=4)
    first, second = _sprint(client, project), _sprint(client, project, "Sprint 2")
    _ok(_plan(client, task, first))
    _ok(_start(client, first))

    _ok(_close(client, first, second))

    assert _titles(_read(client, second)) == ["Carried over"]
    assert _backlog(client, project) == []
    _ok(_start(client, second))
    assert _totals(_read(client, second))["planned"] == (1, "4.00")
    assert _totals(_read(client, first))["unfinished"] == (1, "4.00")


def test_closing_needs_a_choice_that_makes_sense(client: TestClient, world: dict) -> None:
    project = world["project"]
    sprint = _sprint(client, project)
    elsewhere = _sprint(client, world["other"], "Elsewhere")
    old = _sprint(client, project, "Old")
    _ok(_start(client, old))
    _ok(_close(client, old))
    assert _close(client, sprint).status_code == 409  # it has not started
    _ok(_start(client, sprint))

    assert client.post(f"{API}/sprints/{sprint['id']}/close", json={}).status_code == 422
    for wrong in (sprint, old, elsewhere):
        response = _close(client, sprint, wrong)
        assert response.status_code == 422, response.text
        assert "move_unfinished_to" in response.json()["error"]["fields"]
    assert _read(client, sprint)["state"] == "active"
    _ok(_close(client, sprint))
    assert _close(client, sprint).status_code == 409
    assert _start(client, sprint).status_code == 409


def test_only_one_sprint_is_active_in_a_project(client: TestClient, world: dict) -> None:
    first, second = _sprint(client, world["project"]), _sprint(client, world["project"], "Two")
    _ok(_start(client, first))

    response = _start(client, second)

    assert response.status_code == 409, response.text
    assert "Sprint 1" in response.json()["error"]["message"]
    _ok(_start(client, _sprint(client, world["other"])))  # another project has its own


def test_simultaneous_starts_leave_one_active(client: TestClient, world: dict) -> None:
    sprints = [_sprint(client, world["project"], f"Sprint {n}") for n in range(5)]
    with ThreadPoolExecutor(max_workers=5) as pool:
        codes = list(pool.map(lambda s: _start(client, s).status_code, sprints))
    assert sorted(codes) == [200, 409, 409, 409, 409]
    states = [s["state"] for s in _ok(client.get(f"{API}/projects/{world['project']}/sprints"))]
    assert states.count("active") == 1 and states[0] == "active"


def test_tasks_joining_while_the_sprint_closes_are_never_lost(
    client: TestClient, world: dict
) -> None:
    project = world["project"]
    tasks = [_task(client, project, f"Task {n}") for n in range(6)]
    sprint = _sprint(client, project)
    _ok(_start(client, sprint))

    with ThreadPoolExecutor(max_workers=4) as pool:
        joins = [pool.submit(_plan, client, task, sprint) for task in tasks]
        closing = pool.submit(_close, client, sprint)
        results = [j.result() for j in joins]
        _ok(closing.result())

    # Each either joined before the close (and is in its history) or was told it had closed.
    assert {r.status_code for r in results} <= {200, 422}
    joined = [t["title"] for t, r in zip(tasks, results, strict=True) if r.status_code == 200]
    assert sorted(_titles(_read(client, sprint))) == sorted(joined)
    assert sorted(_backlog(client, project)) == sorted(t["title"] for t in tasks)


def test_a_task_that_comes_back_still_counts_as_planned(client: TestClient, world: dict) -> None:
    task = _task(client, world["project"], "Back again", estimate_hours=2)
    sprint = _sprint(client, world["project"])
    _ok(_plan(client, task, sprint))
    _ok(_start(client, sprint))
    _ok(_plan(client, task, None))
    _ok(_plan(client, task, sprint))

    totals = _totals(_read(client, sprint))

    assert totals["planned"] == (1, "2.00")
    assert totals["added"] == totals["removed"] == (0, "0.00")


# --- the backlog and membership -------------------------------------------------------------


def test_planned_tasks_leave_the_backlog_and_can_be_listed(client: TestClient, world: dict) -> None:
    project = world["project"]
    first, second = _task(client, project, "First"), _task(client, project, "Second")
    sprint = _sprint(client, project)

    assert _ok(_plan(client, second, sprint))["sprint_name"] == "Sprint 1"

    assert _backlog(client, project) == ["First"]
    listed = _ok(client.get(f"{API}/projects/{project}/tasks", params={"sprint_id": sprint["id"]}))
    assert [t["title"] for t in listed["items"]] == ["Second"]
    _ok(_plan(client, second, None))
    assert _backlog(client, project) == [first["title"], second["title"]]


def test_what_cannot_join_a_sprint(client: TestClient, world: dict) -> None:
    project = world["project"]
    task = _task(client, project, "Open one")
    finished = _task(client, project, "Finished")
    _set_category(client, finished, "done")
    sprint = _sprint(client, project)
    elsewhere = _sprint(client, world["other"])
    old = _sprint(client, project, "Old")
    _ok(_start(client, old))
    _ok(_close(client, old))

    for what, where in ((finished, sprint), (task, elsewhere), (task, old)):
        response = _plan(client, what, where)
        assert response.status_code == 422, response.text
        assert "sprint_id" in response.json()["error"]["fields"]
    # The sprint is chosen through its own endpoint only: editing a task cannot set it.
    _ok(client.patch(f"{API}/tasks/{task['id']}", json={"sprint_id": sprint["id"]}))
    assert _read(client, sprint)["tasks"] == []


def test_a_closed_sprint_keeps_its_finished_tasks(client: TestClient, world: dict) -> None:
    task = _task(client, world["project"], "Shipped")
    sprint = _sprint(client, world["project"])
    _ok(_plan(client, task, sprint))
    _ok(_start(client, sprint))
    _set_category(client, task, "done")
    _ok(_close(client, sprint))

    assert _plan(client, task, None).status_code == 409
    # Reopened, it is unplanned work again.
    _set_category(client, task, "todo")
    assert _backlog(client, world["project"]) == ["Shipped"]


def test_deleted_tasks_leave_a_running_sprint_but_stay_in_its_history(
    client: TestClient, world: dict
) -> None:
    project = world["project"]
    parent = _task(client, project, "Parent", estimate_hours=1)
    child = _task(client, project, "Child", parent_task_id=parent["id"], estimate_hours=2)
    sprint = _sprint(client, project)
    for task in (parent, child):
        _ok(_plan(client, task, sprint))
    before = _sprint(client, project, "Never started")
    gone_early = _task(client, project, "Deleted early")
    _ok(_plan(client, gone_early, before))
    _ok(client.delete(f"{API}/tasks/{gone_early['id']}"))
    assert _read(client, before)["tasks"] == []
    _ok(_start(client, sprint))

    _ok(client.delete(f"{API}/tasks/{parent['id']}", params={"cascade": True}))

    totals = _totals(_read(client, sprint))
    assert totals["planned"] == totals["removed"] == (2, "3.00")
    closed = _ok(_close(client, sprint))
    assert closed["task_count"] == 0


# --- editing and deleting sprints -----------------------------------------------------------


def test_sprint_details_are_checked(client: TestClient, world: dict) -> None:
    sprint = _sprint(client, world["project"])
    url = f"{API}/sprints/{sprint['id']}"
    backwards = client.post(
        f"{API}/projects/{world['project']}/sprints",
        json={"name": "Backwards", "start_date": "2026-12-10", "end_date": "2026-12-01"},
    )
    assert backwards.status_code == 422, backwards.text
    same_name = client.post(
        f"{API}/projects/{world['project']}/sprints",
        json={"name": "SPRINT 1", "start_date": "2026-12-01", "end_date": "2026-12-01"},
    )
    assert same_name.status_code == 409, same_name.text
    assert client.patch(url, json={"end_date": "2026-11-01"}).status_code == 422
    assert client.patch(url, json={"name": None}).status_code == 422
    changed = _ok(client.patch(url, json={"name": "Renamed", "goal": "A goal"}))
    assert (changed["name"], changed["goal"], changed["end_date"]) == (
        "Renamed",
        "A goal",
        "2026-12-14",
    )


def test_only_a_sprint_that_never_started_can_be_deleted(client: TestClient, world: dict) -> None:
    task = _task(client, world["project"], "Kept task")
    planned = _sprint(client, world["project"], "Planned")
    running = _sprint(client, world["project"], "Running")
    _ok(_plan(client, task, planned))
    _ok(_start(client, running))

    assert client.delete(f"{API}/sprints/{running['id']}").status_code == 409
    _ok(client.delete(f"{API}/sprints/{planned['id']}"))
    assert _ok(client.get(f"{API}/tasks/{task['id']}"))["sprint_id"] is None
    _ok(_close(client, running))
    assert client.delete(f"{API}/sprints/{running['id']}").status_code == 409
    renamed = client.patch(f"{API}/sprints/{running['id']}", json={"name": "History"})
    assert renamed.status_code == 409


# --- who may do what ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "role,expected", [("manager", 200), ("qa_lead", 200), ("developer", 403), ("tester", 403)]
)
def test_managing_sprints_needs_the_planning_permission(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    task = _task(client, world["project"], "A task")
    sprint = _sprint(client, world["project"])
    them = _sign_in(client, world, "who", role)

    created = them.post(
        f"{API}/projects/{world['project']}/sprints",
        json={"name": "Theirs", "start_date": "2026-12-01", "end_date": "2026-12-02"},
    )
    assert created.status_code == expected, created.text
    assert _plan(them, task, sprint).status_code == expected
    assert them.patch(f"{API}/sprints/{sprint['id']}", json={"goal": "x"}).status_code == expected
    assert _start(them, sprint).status_code == expected
    if expected == 403:
        assert them.delete(f"{API}/sprints/{sprint['id']}").status_code == 403
        assert _close(them, sprint).status_code == 403
    assert them.get(f"{API}/sprints/{sprint['id']}").status_code == 200


def test_outsiders_cannot_read_a_projects_sprints(client: TestClient, world: dict) -> None:
    hidden = _sprint(client, world["other"])
    them = _sign_in(client, world, "who", "tester")  # a member of `project` only

    assert them.get(f"{API}/sprints/{hidden['id']}").status_code == 403
    assert them.get(f"{API}/projects/{world['other']}/sprints").status_code == 403


def test_an_archived_projects_sprints_are_read_only(client: TestClient, world: dict) -> None:
    task = _task(client, world["project"], "A task")
    sprint = _sprint(client, world["project"])
    _ok(client.post(f"{API}/projects/{world['project']}/archive"))

    for response in (
        client.patch(f"{API}/sprints/{sprint['id']}", json={"goal": "Late"}),
        client.delete(f"{API}/sprints/{sprint['id']}"),
        _start(client, sprint),
        _plan(client, task, sprint),
    ):
        assert response.status_code == 409, response.text
    assert _read(client, sprint)["state"] == "planned"


def test_an_empty_project_with_planning_can_still_be_deleted(
    client: TestClient, world: dict
) -> None:
    project = world["other"]
    _sprint(client, project)
    _ok(client.post(f"{API}/projects/{project}/milestones", json={"name": "Beta"}))

    _ok(client.delete(f"{API}/projects/{project}"))
