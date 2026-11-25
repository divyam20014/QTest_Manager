"""ADR-128: every requirement belongs to a task; the project's "Unassigned requirements" task.

The project-level Requirements section is folded into the tasks. A requirement created without a
task, or whose task is deleted, is filed under one default task per project.
"""

from tests.test_tasks_api import _task, env  # noqa: F401


def _requirement(client, project_id: str, title: str, **extra) -> dict:
    r = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": title, "description": "", **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _tasks(client, project_id: str) -> list[dict]:
    return client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]["items"]


def test_a_requirement_without_a_task_lands_in_the_default_task(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    assert _tasks(client, project_id) == []  # nothing is created until it is needed

    first = _requirement(client, project_id, "First loose requirement")
    second = _requirement(client, project_id, "Second loose requirement")
    assert first["task_id"] == second["task_id"]
    assert first["task_title"] == "Unassigned requirements"

    tasks = _tasks(client, project_id)
    assert len(tasks) == 1
    home = tasks[0]
    assert home["id"] == first["task_id"]
    assert home["is_requirements_home"] is True
    assert home["requirement_count"] == 2
    assert home["display_id"].startswith("TASK_")
    assert home["depth"] == 0 and home["parent_task_id"] is None

    # Another project gets its own.
    other = _requirement(client, env["other"]["id"], "Loose in another project")
    assert other["task_id"] != home["id"]


def test_a_requirement_in_a_task_does_not_create_the_default_task(env: dict) -> None:  # noqa: F811
    client = env["client"]
    task = _task(env, "A real task")
    requirement = _requirement(
        client, env["project"]["id"], "Belongs somewhere", task_id=task["id"]
    )
    assert requirement["task_id"] == task["id"]
    assert [t["id"] for t in _tasks(client, env["project"]["id"])] == [task["id"]]


def test_detaching_and_moving_a_requirement(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    task = _task(env, "Owner task")
    requirement = _requirement(client, project_id, "Moves around", task_id=task["id"])

    detached = client.patch(
        f"/api/v1/requirements/{requirement['id']}", json={"task_id": None}
    ).json()["data"]
    assert detached["task_title"] == "Unassigned requirements"
    # Detaching again is a no-op, not a second default task.
    again = client.patch(
        f"/api/v1/requirements/{requirement['id']}", json={"task_id": None}
    ).json()["data"]
    assert again["task_id"] == detached["task_id"]
    assert len([t for t in _tasks(client, project_id) if t["is_requirements_home"]]) == 1

    back = client.patch(f"/api/v1/requirements/{requirement['id']}", json={"task_id": task["id"]})
    assert back.status_code == 200 and back.json()["data"]["task_id"] == task["id"]
    # Moving a requirement is not an edit of its wording.
    assert back.json()["data"]["version_number"] == 1


def test_the_default_task_is_protected(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    home_id = _requirement(client, project_id, "Holds the default task")["task_id"]
    other = _task(env, "Some other task")

    assert client.delete(f"/api/v1/tasks/{home_id}").status_code == 409
    moved = client.patch(f"/api/v1/tasks/{home_id}", json={"parent_task_id": other["id"]})
    assert moved.status_code == 409
    child = client.post(
        f"/api/v1/projects/{project_id}/tasks",
        json={"title": "Under the default", "parent_task_id": home_id},
    )
    assert child.status_code == 422 and "parent_task_id" in child.json()["error"]["fields"]
    # It is still a task: it can be renamed and given a due date.
    edited = client.patch(f"/api/v1/tasks/{home_id}", json={"due_date": "2030-01-01"})
    assert edited.status_code == 200 and edited.json()["data"]["is_requirements_home"] is True


def test_deleting_a_task_moves_its_requirements_to_the_default_task(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    parent = _task(env, "Doomed parent")
    child = _task(env, "Doomed child", parent_task_id=parent["id"])
    kept = _requirement(client, project_id, "Was in the child", task_id=child["id"])
    also = _requirement(client, project_id, "Was in the parent", task_id=parent["id"])

    assert client.delete(f"/api/v1/tasks/{parent['id']}?cascade=true").status_code == 200
    for requirement in (kept, also):
        after = client.get(f"/api/v1/requirements/{requirement['id']}").json()["data"]
        assert after["task_title"] == "Unassigned requirements"
    home = [t for t in _tasks(client, project_id) if t["is_requirements_home"]]
    assert len(home) == 1 and home[0]["requirement_count"] == 2


def test_default_task_counts_in_rollups_and_search(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    home_id = _requirement(client, project_id, "Counted requirement")["task_id"]
    rollup = client.get(f"/api/v1/tasks/{home_id}/rollup").json()["data"]
    assert rollup["requirements_total"] == 1
    hit = client.get("/api/v1/search", params={"q": "Unassigned"}).json()["data"]["results"]
    assert [r["id"] for r in hit if r["type"] == "task"] == [home_id]


def test_a_saved_tab_layout_that_names_requirements_still_loads(env: dict) -> None:  # noqa: F811
    """The tab is gone (ADR-128); old saved layouts and tenant defaults that mention it are accepted
    and the key is dropped, so nobody has to re-save anything."""
    client = env["client"]
    project = env["project"]
    saved = client.patch(
        f"/api/v1/projects/{project['id']}",
        json={
            "nav_config": {"order": ["overview", "requirements", "test-cases"], "hidden": []},
            "expected_version": project["version"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["nav_config"]["order"] == ["overview", "test-cases"]
