"""ADR-127 phase 7: the closing audit -- the places a new project-level entity can break.

Project and release deletion, the tenant data export, freeze windows, the role matrix, and
the tree endpoint saying when it is capped.
"""

from datetime import UTC, datetime, timedelta

from tests.test_tasks_api import _set_status, _task, _tester_client, env  # noqa: F401


def _window(start_hours: float, end_hours: float) -> dict:
    now = datetime.now(UTC)
    return {
        "starts_at": (now + timedelta(hours=start_hours)).isoformat(),
        "ends_at": (now + timedelta(hours=end_hours)).isoformat(),
    }


def _user(env: dict, email: str, role: str, password: str = "UserPassw0rd!") -> tuple:  # noqa: F811
    from fastapi.testclient import TestClient

    client = env["client"]
    created = client.post(
        "/api/v1/users",
        json={"email": email, "name": role.title(), "role": role, "password": password},
    )
    assert created.status_code == 200, created.text
    client.post(
        f"/api/v1/projects/{env['project']['id']}/members",
        json={"user_id": created.json()["data"]["id"]},
    )
    other = TestClient(client.app)
    login = other.post(
        "/api/v1/auth/login",
        json={"tenant_id": env["tenant_id"], "email": email, "password": password},
    )
    assert login.status_code == 200, login.text
    other.post("/api/v1/auth/mfa/verify", json={"code": login.json()["data"]["debug_code"]})
    return other, created.json()["data"]["id"]


# --- deletion ---


def test_a_project_with_tasks_or_requirements_cannot_be_deleted(env: dict) -> None:  # noqa: F811
    client = env["client"]
    empty = client.get(f"/api/v1/projects/{env['other']['id']}").json()["data"]
    with_task = env["project"]["id"]
    task = _task(env, "Blocks deletion")

    blocked = client.delete(f"/api/v1/projects/{with_task}")
    assert blocked.status_code == 409, blocked.text
    assert "tasks" in blocked.json()["error"]["message"]

    # Even a deleted task still references the project, so it keeps blocking (history is kept).
    client.delete(f"/api/v1/tasks/{task['id']}")
    assert client.delete(f"/api/v1/projects/{with_task}").status_code == 409

    requirement_project = client.post(
        "/api/v1/projects",
        json={
            "name": "Only a requirement",
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000.00",
            "region": "North America",
        },
    ).json()["data"]
    client.post(
        f"/api/v1/projects/{requirement_project['id']}/requirements",
        json={"title": "A lone requirement", "description": ""},
    )
    assert client.delete(f"/api/v1/projects/{requirement_project['id']}").status_code == 409

    # A project with nothing in it still deletes.
    assert client.delete(f"/api/v1/projects/{empty['id']}").status_code == 200


def test_deleting_a_release_keeps_its_tasks(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    release = client.post(
        f"/api/v1/projects/{project_id}/releases",
        json={"name": "Release 9", "release_date": "2026-09-01"},
    )
    assert release.status_code == 200, release.text
    task = _task(env, "Planned for release 9", release_id=release.json()["data"]["id"])
    assert task["release_id"] == release.json()["data"]["id"]

    deleted = client.delete(f"/api/v1/releases/{release.json()['data']['id']}")
    assert deleted.status_code == 200, deleted.text
    after = client.get(f"/api/v1/tasks/{task['id']}").json()["data"]
    assert after["release_id"] is None


# --- tenant export ---


def test_the_tenant_data_export_contains_tasks(env: dict, db_session) -> None:  # noqa: F811
    import io
    import json
    import uuid
    import zipfile

    from app.core.db import set_tenant_context
    from app.core.storage import get_storage_backend
    from app.services import export_service

    parent = _task(env, "Exported parent")
    _task(env, "Exported child", parent_task_id=parent["id"])
    deleted = _task(env, "Exported but deleted")
    env["client"].delete(f"/api/v1/tasks/{deleted['id']}")

    set_tenant_context(db_session, env["tenant_id"])
    result = export_service.run_export(db_session, uuid.UUID(env["tenant_id"]))
    assert result["manifest"]["tasks"] == 3  # the deleted one too: an export is complete
    assert result["manifest"]["task_statuses"] == 3

    archive = zipfile.ZipFile(io.BytesIO(get_storage_backend().read(result["storage_ref"])))
    tasks = json.loads(archive.read("tasks.json"))
    by_title = {t["title"]: t for t in tasks}
    assert by_title["Exported child"]["parent_task_id"] == parent["id"]
    assert by_title["Exported but deleted"]["deleted_at"] is not None
    assert "task_test_case_links.json" in archive.namelist()


# --- freeze windows ---


def test_a_freeze_window_can_block_task_changes(env: dict) -> None:  # noqa: F811
    client = env["client"]
    manager, _ = _user(env, "manager@taskco.com", "manager")
    task = _task(env, "Frozen task")
    rule = client.post(
        "/api/v1/access-rules",
        json={
            "name": "Task freeze",
            "rule_type": "freeze_window",
            "blocked_actions": ["task"],
            "exempt_roles": ["admin"],
            "reason": "Planning is frozen until Monday",
            **_window(-1, 1),
        },
    )
    assert rule.status_code == 200, rule.text

    project_id = env["project"]["id"]
    blocked = manager.post(
        f"/api/v1/projects/{project_id}/tasks", json={"title": "Not during a freeze"}
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "blocked_by_access_rule"
    assert manager.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Edited"}).status_code == 403
    assert manager.delete(f"/api/v1/tasks/{task['id']}").status_code == 403
    # The task status screen is a different action (`task_status`), and Admin is always exempt.
    assert (
        client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "Admin may"}).status_code
        == 200
    )
    # Reading stays open.
    assert manager.get(f"/api/v1/projects/{project_id}/tasks").status_code == 200


# --- who may do what ---


def test_role_matrix_for_tasks(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    manager, _ = _user(env, "matrix-manager@taskco.com", "manager")
    tester, tester_id = _user(env, "matrix-tester@taskco.com", "tester")
    task = _task(env, "Matrix task", assignee_id=tester_id)
    todo = env["statuses"]["todo"]["id"]
    in_progress = env["statuses"]["in_progress"]["id"]

    def codes(actor) -> dict[str, int]:
        return {
            "list": actor.get(f"/api/v1/projects/{project_id}/tasks").status_code,
            "summary": actor.get(f"/api/v1/projects/{project_id}/tasks/summary").status_code,
            "create": actor.post(
                f"/api/v1/projects/{project_id}/tasks", json={"title": "Matrix new"}
            ).status_code,
            "edit": actor.patch(
                f"/api/v1/tasks/{task['id']}", json={"priority": "High"}
            ).status_code,
            "status": actor.post(
                f"/api/v1/tasks/{task['id']}/status", json={"status_id": in_progress}
            ).status_code,
            "statuses_read": actor.get("/api/v1/task-statuses").status_code,
            "statuses_write": actor.post(
                "/api/v1/task-statuses",
                json={"code": "matrix", "label": "Matrix", "category": "todo"},
            ).status_code,
        }

    assert codes(client) == {
        "list": 200, "summary": 200, "create": 200, "edit": 200, "status": 200,
        "statuses_read": 200, "statuses_write": 200,
    }  # fmt: skip
    client.post(f"/api/v1/tasks/{task['id']}/status", json={"status_id": todo})
    assert codes(manager) == {
        "list": 200, "summary": 200, "create": 200, "edit": 200, "status": 200,
        "statuses_read": 200, "statuses_write": 403,
    }  # fmt: skip
    client.post(f"/api/v1/tasks/{task['id']}/status", json={"status_id": todo})
    # A Tester reads, and moves only the tasks assigned to them.
    assert codes(tester) == {
        "list": 200, "summary": 200, "create": 403, "edit": 403, "status": 200,
        "statuses_read": 200, "statuses_write": 403,
    }  # fmt: skip
    unassigned = _task(env, "Not the tester's")
    assert (
        tester.post(
            f"/api/v1/tasks/{unassigned['id']}/status", json={"status_id": in_progress}
        ).status_code
        == 403
    )


def test_a_custom_role_gets_exactly_the_task_permissions_it_is_given(env: dict) -> None:  # noqa: F811
    from fastapi.testclient import TestClient

    client = env["client"]
    project_id = env["project"]["id"]
    permissions = {p["code"] for p in client.get("/api/v1/roles/permissions").json()["data"]}
    assert {"task.manage", "task.transition", "task_status.manage"} <= permissions

    role = client.post(
        "/api/v1/roles", json={"name": "Planner", "permission_codes": ["task.manage"]}
    ).json()["data"]
    created = client.post(
        "/api/v1/users",
        json={
            "email": "planner@taskco.com",
            "name": "Planner",
            "role_id": role["id"],
            "password": "PlannerPassw0rd!",
        },
    )
    assert created.status_code == 200, created.text
    client.post(
        f"/api/v1/projects/{project_id}/members", json={"user_id": created.json()["data"]["id"]}
    )
    planner = TestClient(client.app)
    login = planner.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": env["tenant_id"],
            "email": "planner@taskco.com",
            "password": "PlannerPassw0rd!",
        },
    )
    planner.post("/api/v1/auth/mfa/verify", json={"code": login.json()["data"]["debug_code"]})

    made = planner.post(f"/api/v1/projects/{project_id}/tasks", json={"title": "Planner task"})
    assert made.status_code == 200, made.text
    # task.manage was given; task.transition and task_status.manage were not.
    task_id = made.json()["data"]["id"]
    done = env["statuses"]["done"]["id"]
    assert (
        planner.post(f"/api/v1/tasks/{task_id}/status", json={"status_id": done}).status_code == 403
    )
    assert (
        planner.post(
            "/api/v1/task-statuses", json={"code": "nope", "label": "Nope", "category": "todo"}
        ).status_code
        == 403
    )


# --- the tree says when it is capped ---


def test_the_task_tree_reports_the_real_total_when_it_is_capped(env: dict, monkeypatch) -> None:  # noqa: F811
    from app.services import task_service

    for n in range(5):
        _task(env, f"Capped task {n}")
    monkeypatch.setattr(task_service, "MAX_TREE_TASKS", 3)
    tree = env["client"].get(f"/api/v1/projects/{env['project']['id']}/tasks/tree").json()["data"]
    assert len(tree["items"]) == 3
    assert tree["total"] == 5
    _set_status(env, tree["items"][0]["id"], "done")  # still usable
