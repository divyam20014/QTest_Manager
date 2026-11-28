"""ADR-147 (Phase 2D): tasks that should finish before others start."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

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


def _wait(client: TestClient, task: dict, other: dict):
    url = f"{API}/tasks/{task['id']}/dependencies"
    return client.post(url, json={"depends_on_task_id": other["id"]})


def _unwait(client: TestClient, task: dict, other: dict):
    return client.delete(f"{API}/tasks/{task['id']}/dependencies/{other['id']}")


def _read(client: TestClient, task: dict) -> dict:
    return _ok(client.get(f"{API}/tasks/{task['id']}"))


def _set_category(client: TestClient, task: dict, category: str) -> None:
    status = next(s for s in _ok(client.get(f"{API}/task-statuses")) if s["category"] == category)
    _ok(client.post(f"{API}/tasks/{task['id']}/status", json={"status_id": status["id"]}))


def test_a_dependency_shows_at_both_ends_until_the_earlier_task_is_done(
    client: TestClient, world: dict
) -> None:
    design = _task(client, world["project"], "Design")
    build = _task(client, world["project"], "Build")

    detail = _ok(_wait(client, build, design))

    assert [d["title"] for d in detail["depends_on"]] == ["Design"]
    assert detail["open_dependency_count"] == 1
    assert [d["title"] for d in _read(client, design)["blocks"]] == ["Build"]
    _ok(_wait(client, build, design))  # again: nothing changes
    assert len(_read(client, build)["depends_on"]) == 1
    _set_category(client, design, "done")
    after = _read(client, build)
    assert after["open_dependency_count"] == 0 and len(after["depends_on"]) == 1
    _ok(_unwait(client, build, design))
    assert _read(client, build)["depends_on"] == []
    assert _unwait(client, build, design).status_code == 404


def test_an_unfinished_earlier_task_warns_but_does_not_block(
    client: TestClient, world: dict
) -> None:
    design = _task(client, world["project"], "Design")
    build = _task(client, world["project"], "Build")
    _ok(_wait(client, build, design))

    _set_category(client, build, "in_progress")
    _set_category(client, build, "done")

    assert _read(client, build)["status"]["category"] == "done"
    assert _read(client, build)["open_dependency_count"] == 1


def test_circles_are_refused_however_long(client: TestClient, world: dict) -> None:
    a, b, c = (_task(client, world["project"], f"Task {n}") for n in "ABC")
    _ok(_wait(client, b, a))
    _ok(_wait(client, c, b))

    for task, other in ((a, b), (a, c)):
        response = _wait(client, task, other)
        assert response.status_code == 409, response.text
        assert "circle" in response.json()["error"]["message"]
    assert _wait(client, a, a).status_code == 422
    assert _read(client, a)["depends_on"] == []
    # A shortcut is not a circle.
    _ok(_wait(client, c, a))


def test_simultaneous_requests_cannot_make_a_circle(client: TestClient, world: dict) -> None:
    tasks = [_task(client, world["project"], f"Task {n}") for n in range(5)]
    # Each waits for the next: all five together would be a circle.
    links = [(tasks[n], tasks[(n + 1) % 5]) for n in range(5)]

    with ThreadPoolExecutor(max_workers=5) as pool:
        codes = list(pool.map(lambda pair: _wait(client, *pair).status_code, links))

    assert sorted(codes) == [200, 200, 200, 200, 409]


def test_the_database_itself_refuses_circles_and_other_projects(
    client: TestClient, world: dict, owner_engine
) -> None:
    a, b = (_task(client, world["project"], f"Task {n}") for n in "AB")
    far = _task(client, world["other"], "Elsewhere")
    _ok(_wait(client, b, a))
    insert = text(
        "insert into task_dependencies "
        "(id, tenant_id, project_id, task_id, depends_on_task_id, created_by) "
        "select gen_random_uuid(), tenant_id, project_id, id, :other, created_by "
        "from tasks where id = :task"
    )

    for task, other, expected in ((a, b, "circle"), (a, far, "same_project")):
        with pytest.raises(DBAPIError) as refused, owner_engine.begin() as conn:
            conn.execute(insert, {"task": task["id"], "other": other["id"]})
        assert expected in str(refused.value)


def test_links_stay_inside_one_project_and_family_lines_are_refused(
    client: TestClient, world: dict
) -> None:
    parent = _task(client, world["project"], "Parent")
    child = _task(client, world["project"], "Child", parent_task_id=parent["id"])
    grandchild = _task(client, world["project"], "Grandchild", parent_task_id=child["id"])
    far = _task(client, world["other"], "Elsewhere")

    response = _wait(client, parent, far)
    assert response.status_code == 422, response.text
    assert "depends_on_task_id" in response.json()["error"]["fields"]
    for task, other in ((grandchild, parent), (parent, grandchild), (child, parent)):
        assert _wait(client, task, other).status_code == 409


def test_deleting_a_task_removes_its_links(client: TestClient, world: dict) -> None:
    first, middle, last = (_task(client, world["project"], f"Task {n}") for n in "123")
    _ok(_wait(client, middle, first))
    _ok(_wait(client, last, middle))

    _ok(client.delete(f"{API}/tasks/{middle['id']}"))

    assert _read(client, first)["blocks"] == []
    assert _read(client, last)["depends_on"] == []
    _ok(_wait(client, first, last))  # the chain through the deleted task is gone


@pytest.mark.parametrize(
    "role,expected", [("manager", 200), ("qa_lead", 200), ("developer", 403), ("tester", 403)]
)
def test_linking_needs_permission_to_manage_tasks(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    a, b = (_task(client, world["project"], f"Task {n}") for n in "AB")
    them = _sign_in(client, world, "who", role)

    assert _wait(them, b, a).status_code == expected
    if expected == 403:
        _ok(_wait(client, b, a))
        assert _unwait(them, b, a).status_code == 403
    assert them.get(f"{API}/tasks/{b['id']}").status_code == 200


def test_an_archived_projects_dependencies_are_read_only(client: TestClient, world: dict) -> None:
    a, b, c = (_task(client, world["project"], f"Task {n}") for n in "ABC")
    _ok(_wait(client, b, a))
    _ok(client.post(f"{API}/projects/{world['project']}/archive"))

    assert _wait(client, c, a).status_code == 409
    assert _unwait(client, b, a).status_code == 409
    assert len(_read(client, b)["depends_on"]) == 1
