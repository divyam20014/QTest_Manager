"""ADR-145 (Phase 2B): milestones."""

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


def _milestone(client: TestClient, project: str, name: str = "Beta", **extra) -> dict:
    body = {"name": name, **extra}
    return _ok(client.post(f"{API}/projects/{project}/milestones", json=body))


def _list(client: TestClient, project: str) -> list[dict]:
    return _ok(client.get(f"{API}/projects/{project}/milestones"))


def _finish(client: TestClient, task: dict) -> None:
    done = next(s for s in _ok(client.get(f"{API}/task-statuses")) if s["category"] == "done")
    _ok(client.post(f"{API}/tasks/{task['id']}/status", json={"status_id": done["id"]}))


def test_a_milestone_is_created_changed_completed_and_reopened(
    client: TestClient, world: dict
) -> None:
    made = _milestone(client, world["project"], "  Beta  ", due_date="2026-12-01")
    assert (made["name"], made["due_date"], made["completed_at"]) == ("Beta", "2026-12-01", None)

    url = f"{API}/milestones/{made['id']}"
    changed = _ok(client.patch(url, json={"name": "Beta 2", "due_date": None}))
    assert (changed["name"], changed["due_date"]) == ("Beta 2", None)
    assert _ok(client.patch(url, json={"completed": True}))["completed_at"]
    assert _ok(client.patch(url, json={"completed": False}))["completed_at"] is None


def test_names_are_unique_within_a_project_only(client: TestClient, world: dict) -> None:
    _milestone(client, world["project"], "Beta")
    same = client.post(f"{API}/projects/{world['project']}/milestones", json={"name": "BETA"})
    assert same.status_code == 409, same.text
    assert _milestone(client, world["other"], "Beta")


def test_milestones_are_listed_by_due_date_with_their_progress(
    client: TestClient, world: dict
) -> None:
    project = world["project"]
    later = _milestone(client, project, "Later", due_date="2026-12-31")
    _milestone(client, project, "No date")
    soon = _milestone(client, project, "Soon", due_date="2026-12-01")
    done = _task(client, project, "Finished", milestone_id=soon["id"], estimate_hours=3)
    _task(client, project, "Waiting", milestone_id=soon["id"], estimate_hours="1.5")
    _task(client, project, "Unestimated", milestone_id=later["id"])
    _finish(client, done)

    listed = _list(client, project)

    assert [m["name"] for m in listed] == ["Soon", "Later", "No date"]
    first = listed[0]
    assert (first["task_count"], first["done_count"]) == (2, 1)
    assert (first["estimate_hours"], first["done_estimate_hours"]) == ("4.50", "3.00")
    assert (listed[2]["task_count"], listed[2]["estimate_hours"]) == (0, "0.00")


def test_a_task_names_its_milestone_and_can_leave_it(client: TestClient, world: dict) -> None:
    milestone = _milestone(client, world["project"])
    task = _task(client, world["project"], "Planned", milestone_id=milestone["id"])
    assert (task["milestone_id"], task["milestone_name"]) == (milestone["id"], "Beta")
    _task(client, world["project"], "Not in it")
    filtered = _ok(
        client.get(
            f"{API}/projects/{world['project']}/tasks",
            params={"milestone_id": milestone["id"]},
        )
    )
    assert [t["id"] for t in filtered["items"]] == [task["id"]]

    left = _ok(client.patch(f"{API}/tasks/{task['id']}", json={"milestone_id": None}))
    assert (left["milestone_id"], left["milestone_name"]) == (None, None)


def test_another_projects_milestone_is_refused_by_the_service_and_the_database(
    client: TestClient, world: dict, owner_engine
) -> None:
    theirs = _milestone(client, world["other"])
    task = _task(client, world["project"], "Mine")
    for response in (
        client.patch(f"{API}/tasks/{task['id']}", json={"milestone_id": theirs["id"]}),
        client.post(
            f"{API}/projects/{world['project']}/tasks",
            json={"title": "New one", "milestone_id": theirs["id"]},
        ),
    ):
        assert response.status_code == 422, response.text
        assert "milestone_id" in response.json()["error"]["fields"]
    with pytest.raises(DBAPIError):
        with owner_engine.begin() as conn:
            conn.execute(
                text("update tasks set milestone_id = :m where id = :t"),
                {"m": theirs["id"], "t": task["id"]},
            )


def test_a_completed_milestone_takes_no_new_tasks_but_keeps_its_own(
    client: TestClient, world: dict
) -> None:
    milestone = _milestone(client, world["project"])
    member = _task(client, world["project"], "Already in", milestone_id=milestone["id"])
    _ok(client.patch(f"{API}/milestones/{milestone['id']}", json={"completed": True}))
    outsider = _task(client, world["project"], "Late arrival")

    refused = client.patch(f"{API}/tasks/{outsider['id']}", json={"milestone_id": milestone["id"]})
    assert refused.status_code == 422, refused.text
    # Saving a member again without changing its milestone is fine.
    kept = client.patch(
        f"{API}/tasks/{member['id']}",
        json={"title": "Still in", "milestone_id": milestone["id"]},
    )
    assert kept.status_code == 200, kept.text


def test_deleting_a_milestone_keeps_its_tasks(client: TestClient, world: dict) -> None:
    milestone = _milestone(client, world["project"])
    kept = _task(client, world["project"], "Survives", milestone_id=milestone["id"])
    gone = _task(client, world["project"], "Deleted earlier", milestone_id=milestone["id"])
    _ok(client.delete(f"{API}/tasks/{gone['id']}"))

    _ok(client.delete(f"{API}/milestones/{milestone['id']}"))

    assert _list(client, world["project"]) == []
    assert _ok(client.get(f"{API}/tasks/{kept['id']}"))["milestone_id"] is None


@pytest.mark.parametrize("role,expected", [("manager", 200), ("qa_lead", 200), ("developer", 403)])
def test_managing_milestones_needs_the_planning_permission(
    client: TestClient, world: dict, role: str, expected: int
) -> None:
    milestone = _milestone(client, world["project"])
    them = _sign_in(client, world, "who", role)
    base = f"{API}/projects/{world['project']}/milestones"

    assert them.post(base, json={"name": "Theirs"}).status_code == expected
    url = f"{API}/milestones/{milestone['id']}"
    assert them.patch(url, json={"name": "Renamed"}).status_code == expected
    assert them.delete(url).status_code == expected
    assert them.get(base).status_code == 200


def test_a_project_role_decides_who_manages_that_projects_milestones(
    client: TestClient, world: dict
) -> None:
    milestone = _milestone(client, world["project"])
    them = _sign_in(client, world, "mia", "manager")
    me = _ok(them.get(f"{API}/auth/me"))["user_id"]
    roles = {r["code"]: r["id"] for r in _ok(client.get(f"{API}/roles")) if r["code"]}
    _ok(
        client.patch(
            f"{API}/projects/{world['project']}/members/{me}/role",
            json={"role_id": roles["developer"]},
        )
    )

    refused = them.patch(f"{API}/milestones/{milestone['id']}", json={"name": "Renamed"})

    assert refused.status_code == 403, refused.text


def test_whoever_could_manage_tasks_can_now_manage_planning(
    client: TestClient, world: dict
) -> None:
    roles = {r["code"]: set(r["permission_codes"]) for r in _ok(client.get(f"{API}/roles"))}
    for code, permissions in roles.items():
        assert ("planning.manage" in permissions) == ("task.manage" in permissions), code


def test_an_archived_projects_milestones_are_read_only(client: TestClient, world: dict) -> None:
    milestone = _milestone(client, world["project"])
    _ok(client.post(f"{API}/projects/{world['project']}/archive"))
    url = f"{API}/milestones/{milestone['id']}"

    for response in (
        client.post(f"{API}/projects/{world['project']}/milestones", json={"name": "Late"}),
        client.patch(url, json={"name": "Renamed"}),
        client.delete(url),
    ):
        assert response.status_code == 409, response.text
    assert [m["name"] for m in _list(client, world["project"])] == ["Beta"]
