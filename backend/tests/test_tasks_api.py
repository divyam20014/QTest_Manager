"""ADR-127 phase 2: the task / sub-task / task-status API and its hierarchy rules."""

import pytest
from fastapi.testclient import TestClient

from app.core.field_standards import MAX_TASK_DEPTH
from tests.test_display_ids import _bootstrap, _login, _project

PASSWORD = "AdminPassw0rd!"
TESTER_PASSWORD = "TesterPassw0rd!"


@pytest.fixture
def env(client: TestClient, platform_admin: dict) -> dict:
    data = _bootstrap(client, platform_admin, "Taskco", "admin@taskco.com")
    tenant_id = data["tenant"]["id"]
    _login(client, tenant_id, "admin@taskco.com")
    project = _project(client, name="Task project")
    other = _project(client, name="Other task project")
    statuses = {s["code"]: s for s in client.get("/api/v1/task-statuses").json()["data"]}
    return {
        "client": client,
        "tenant_id": tenant_id,
        "project": project,
        "other": other,
        "statuses": statuses,
    }


def _task(env: dict, title: str = "Build the claims form", **extra) -> dict:
    response = env["client"].post(
        f"/api/v1/projects/{env['project']['id']}/tasks", json={"title": title, **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _set_status(env: dict, task_id: str, code: str):
    return env["client"].post(
        f"/api/v1/tasks/{task_id}/status", json={"status_id": env["statuses"][code]["id"]}
    )


def _tester_client(env: dict, *, member: bool = True) -> tuple[TestClient, str]:
    client = env["client"]
    user = client.post(
        "/api/v1/users",
        json={
            "email": "tester@taskco.com",
            "name": "Tess Tester",
            "role": "tester",
            "password": TESTER_PASSWORD,
        },
    ).json()["data"]
    if member:
        client.post(
            f"/api/v1/projects/{env['project']['id']}/members", json={"user_id": user["id"]}
        )
    tester = TestClient(client.app)
    login = tester.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": env["tenant_id"],
            "email": "tester@taskco.com",
            "password": TESTER_PASSWORD,
        },
    )
    assert login.status_code == 200, login.text
    tester.post("/api/v1/auth/mfa/verify", json={"code": login.json()["data"]["debug_code"]})
    return tester, user["id"]


# --- create / read ----------------------------------------------------------------------------


def test_create_task_gets_display_id_default_status_and_priority(env: dict) -> None:
    first = _task(env, "First task")
    second = _task(env, "Second task")
    assert (first["display_id"], second["display_id"]) == ("TASK_000001", "TASK_000002")
    assert first["status"]["code"] == "todo"
    assert first["priority"] == "Medium"
    assert first["depth"] == 0 and first["parent_task_id"] is None
    detail = env["client"].get(f"/api/v1/tasks/{first['id']}").json()["data"]
    assert detail["ancestors"] == [] and detail["sub_tasks"] == []


def test_sub_task_hierarchy_and_depth_cap(env: dict) -> None:
    client = env["client"]
    chain = [_task(env, "Level zero task")]
    for level in range(1, MAX_TASK_DEPTH + 1):
        child = _task(env, f"Level {level} task", parent_task_id=chain[-1]["id"])
        assert child["depth"] == level
        chain.append(child)
    too_deep = client.post(
        f"/api/v1/projects/{env['project']['id']}/tasks",
        json={"title": "One level too many", "parent_task_id": chain[-1]["id"]},
    )
    assert too_deep.status_code == 422
    assert "parent_task_id" in too_deep.json()["error"]["fields"]

    detail = client.get(f"/api/v1/tasks/{chain[2]['id']}").json()["data"]
    assert [a["id"] for a in detail["ancestors"]] == [chain[0]["id"], chain[1]["id"]]
    assert [s["id"] for s in detail["sub_tasks"]] == [chain[3]["id"]]
    assert detail["sub_task_count"] == 1


def test_parent_must_be_in_the_same_project(env: dict) -> None:
    parent = _task(env, "Parent in project one")
    response = env["client"].post(
        f"/api/v1/projects/{env['other']['id']}/tasks",
        json={"title": "Cross project child", "parent_task_id": parent["id"]},
    )
    assert response.status_code == 422
    assert "parent_task_id" in response.json()["error"]["fields"]


def test_priority_assignee_release_and_dates_are_validated(env: dict) -> None:
    client = env["client"]
    project_id = env["project"]["id"]

    def create(**extra):
        return client.post(
            f"/api/v1/projects/{project_id}/tasks", json={"title": "Validated task", **extra}
        )

    assert create(priority="Urgent!!").status_code == 422
    assert create(assignee_id="00000000-0000-0000-0000-000000000001").status_code == 422
    assert create(release_id="00000000-0000-0000-0000-000000000001").status_code == 422
    assert create(start_date="2026-05-10", due_date="2026-05-01").status_code == 422
    ok = create(priority="High", start_date="2026-05-01", due_date="2026-05-10")
    assert ok.status_code == 200, ok.text


def test_sub_task_due_date_cannot_exceed_parent(env: dict) -> None:
    parent = _task(env, "Dated parent", due_date="2026-06-30")
    late = env["client"].post(
        f"/api/v1/projects/{env['project']['id']}/tasks",
        json={"title": "Too late child", "parent_task_id": parent["id"], "due_date": "2026-07-01"},
    )
    assert late.status_code == 422 and "due_date" in late.json()["error"]["fields"]
    child = _task(env, "On time child", parent_task_id=parent["id"], due_date="2026-06-15")
    # Pulling the parent's date before the child's is refused too.
    early = env["client"].patch(f"/api/v1/tasks/{parent['id']}", json={"due_date": "2026-06-01"})
    assert early.status_code == 422
    assert child["due_date"] == "2026-06-15"


# --- status rules -------------------------------------------------------------------------------


def test_cannot_complete_a_task_with_open_sub_tasks(env: dict) -> None:
    parent = _task(env, "Completion parent")
    child = _task(env, "Completion child", parent_task_id=parent["id"])
    blocked = _set_status(env, parent["id"], "done")
    assert blocked.status_code == 409
    assert _set_status(env, child["id"], "done").status_code == 200
    done = _set_status(env, parent["id"], "done")
    assert done.status_code == 200
    assert done.json()["data"]["completed_at"] is not None
    assert done.json()["data"]["sub_tasks_done"] == 1


def test_done_parent_rejects_open_sub_tasks_and_reopening_a_child(env: dict) -> None:
    parent = _task(env, "Closed parent")
    child = _task(env, "Closed child", parent_task_id=parent["id"])
    _set_status(env, child["id"], "done")
    _set_status(env, parent["id"], "done")

    open_child = env["client"].post(
        f"/api/v1/projects/{env['project']['id']}/tasks",
        json={"title": "Late open child", "parent_task_id": parent["id"]},
    )
    assert open_child.status_code == 422
    assert _set_status(env, child["id"], "in_progress").status_code == 409

    assert _set_status(env, parent["id"], "in_progress").status_code == 200
    reopened = _set_status(env, child["id"], "in_progress")
    assert reopened.status_code == 200 and reopened.json()["data"]["completed_at"] is None


def test_tester_can_only_transition_tasks_assigned_to_them(env: dict) -> None:
    tester, tester_id = _tester_client(env)
    mine = _task(env, "Assigned to tester", assignee_id=tester_id)
    theirs = _task(env, "Not assigned to tester")
    status = {"status_id": env["statuses"]["in_progress"]["id"]}

    assert tester.post(f"/api/v1/tasks/{mine['id']}/status", json=status).status_code == 200
    assert tester.post(f"/api/v1/tasks/{theirs['id']}/status", json=status).status_code == 403
    # ... but a Tester can never manage tasks.
    assert tester.patch(f"/api/v1/tasks/{mine['id']}", json={"title": "Renamed"}).status_code == 403
    assert (
        tester.post(
            f"/api/v1/projects/{env['project']['id']}/tasks", json={"title": "Tester task"}
        ).status_code
        == 403
    )
    assert tester.delete(f"/api/v1/tasks/{mine['id']}").status_code == 403


def test_unassigned_tester_cannot_see_the_project_tasks(env: dict) -> None:
    task = _task(env, "Hidden from outsiders")
    tester, _ = _tester_client(env, member=False)
    assert tester.get(f"/api/v1/projects/{env['project']['id']}/tasks").status_code == 403
    assert tester.get(f"/api/v1/tasks/{task['id']}").status_code == 403


# --- move ---------------------------------------------------------------------------------------


def test_moving_a_task_moves_its_subtree_and_rewrites_depths(env: dict) -> None:
    client = env["client"]
    root_a = _task(env, "Root A task")
    root_b = _task(env, "Root B task")
    child = _task(env, "Child of A", parent_task_id=root_a["id"])
    grandchild = _task(env, "Grandchild of A", parent_task_id=child["id"])

    moved = client.patch(f"/api/v1/tasks/{child['id']}", json={"parent_task_id": root_b["id"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["data"]["parent_task_id"] == root_b["id"]
    assert client.get(f"/api/v1/tasks/{grandchild['id']}").json()["data"]["depth"] == 2

    # To the top level: the whole subtree shifts up.
    top = client.patch(f"/api/v1/tasks/{child['id']}", json={"parent_task_id": None})
    assert top.status_code == 200 and top.json()["data"]["depth"] == 0
    detail = client.get(f"/api/v1/tasks/{grandchild['id']}").json()["data"]
    assert detail["depth"] == 1
    assert [a["id"] for a in detail["ancestors"]] == [child["id"]]


def test_move_rejects_cycles_cross_project_and_excess_depth(env: dict) -> None:
    client = env["client"]
    root = _task(env, "Cycle root")
    child = _task(env, "Cycle child", parent_task_id=root["id"])
    assert (
        client.patch(
            f"/api/v1/tasks/{root['id']}", json={"parent_task_id": child["id"]}
        ).status_code
        == 409
    )
    assert (
        client.patch(f"/api/v1/tasks/{root['id']}", json={"parent_task_id": root["id"]}).status_code
        == 409
    )
    foreign = client.post(
        f"/api/v1/projects/{env['other']['id']}/tasks", json={"title": "Foreign parent"}
    ).json()["data"]
    assert (
        client.patch(
            f"/api/v1/tasks/{child['id']}", json={"parent_task_id": foreign["id"]}
        ).status_code
        == 422
    )

    # A subtree two levels tall cannot be hung under a task that is already at the cap.
    deep = [_task(env, "Deep zero task")]
    for level in range(1, MAX_TASK_DEPTH + 1):
        deep.append(_task(env, f"Deep {level} task", parent_task_id=deep[-1]["id"]))
    assert (
        client.patch(
            f"/api/v1/tasks/{root['id']}", json={"parent_task_id": deep[-1]["id"]}
        ).status_code
        == 409
    )


# --- delete -------------------------------------------------------------------------------------


def test_delete_needs_cascade_for_sub_tasks_and_detaches_requirements_and_defects(
    env: dict,
) -> None:
    client = env["client"]
    project_id = env["project"]["id"]
    parent = _task(env, "Doomed parent")
    child = _task(env, "Doomed child", parent_task_id=parent["id"])
    requirement = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "Linked requirement", "description": "", "task_id": child["id"]},
    )
    assert requirement.status_code == 200, requirement.text
    defect = client.post(
        "/api/v1/defects",
        json={
            "project_id": project_id,
            "title": "Linked defect",
            "severity": "High",
            "task_id": child["id"],
        },
    )
    assert defect.status_code == 200, defect.text

    assert client.delete(f"/api/v1/tasks/{parent['id']}").status_code == 409
    done = client.delete(f"/api/v1/tasks/{parent['id']}?cascade=true")
    assert done.status_code == 200 and done.json()["data"]["deleted"] == 2
    assert client.get(f"/api/v1/tasks/{child['id']}").status_code == 404

    req_after = client.get(f"/api/v1/requirements/{requirement.json()['data']['id']}").json()
    assert req_after["data"]["task_id"] is None
    defect_after = client.get(f"/api/v1/defects/{defect.json()['data']['id']}").json()
    assert defect_after["data"]["task_id"] is None


# --- requirement / defect / test case links -----------------------------------------------------


def test_requirement_and_defect_task_links_are_validated_and_reported(env: dict) -> None:
    client = env["client"]
    project_id = env["project"]["id"]
    task = _task(env, "Owning task")
    foreign = client.post(
        f"/api/v1/projects/{env['other']['id']}/tasks", json={"title": "Foreign task"}
    ).json()["data"]

    bad = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "Wrong project task", "description": "", "task_id": foreign["id"]},
    )
    assert bad.status_code == 422

    requirement = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "Right project task", "description": "", "task_id": task["id"]},
    ).json()["data"]
    assert requirement["task_id"] == task["id"]
    assert requirement["task_display_id"] == task["display_id"]

    # Re-pointing it, or detaching it, is not an edit of the wording: no new version.
    detached = client.patch(f"/api/v1/requirements/{requirement['id']}", json={"task_id": None})
    assert detached.status_code == 200
    assert detached.json()["data"]["task_id"] is None
    assert detached.json()["data"]["version_number"] == 1
    reattached = client.patch(
        f"/api/v1/requirements/{requirement['id']}", json={"task_id": task["id"]}
    )
    assert reattached.json()["data"]["version_number"] == 1
    assert (
        client.patch(
            f"/api/v1/requirements/{requirement['id']}", json={"task_id": foreign["id"]}
        ).status_code
        == 422
    )

    defect = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": "Task defect", "severity": "High"},
    ).json()["data"]
    patched = client.patch(f"/api/v1/defects/{defect['id']}", json={"task_id": task["id"]})
    assert patched.status_code == 200, patched.text
    assert patched.json()["data"]["task_display_id"] == task["display_id"]
    assert (
        client.patch(f"/api/v1/defects/{defect['id']}", json={"task_id": foreign["id"]}).status_code
        == 422
    )

    rolled = client.get(f"/api/v1/tasks/{task['id']}").json()["data"]
    assert (rolled["requirement_count"], rolled["defect_count"]) == (1, 1)


def test_test_cases_link_many_to_many_within_the_project(env: dict) -> None:
    client = env["client"]
    project_id = env["project"]["id"]
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Shared test case",
            "priority": "High",
            "steps": [{"action": "Do it", "expected": "It works"}],
        },
    ).json()["data"]
    foreign_case = client.post(
        f"/api/v1/projects/{env['other']['id']}/test-cases",
        json={
            "title": "Foreign test case",
            "priority": "High",
            "steps": [{"action": "Do it", "expected": "It works"}],
        },
    ).json()["data"]
    one, two = _task(env, "First verifier"), _task(env, "Second verifier")

    for task in (one, two):
        linked = client.post(
            f"/api/v1/tasks/{task['id']}/test-cases", json={"test_case_id": case["id"]}
        )
        assert linked.status_code == 200, linked.text
        assert linked.json()["data"]["test_case_count"] == 1
    # idempotent
    again = client.post(f"/api/v1/tasks/{one['id']}/test-cases", json={"test_case_id": case["id"]})
    assert again.json()["data"]["test_case_count"] == 1
    assert (
        client.post(
            f"/api/v1/tasks/{one['id']}/test-cases", json={"test_case_id": foreign_case["id"]}
        ).status_code
        == 409
    )
    detail = client.get(f"/api/v1/tasks/{one['id']}").json()["data"]
    assert detail["test_cases"][0]["display_id"] == case["display_id"]

    unlinked = client.delete(f"/api/v1/tasks/{one['id']}/test-cases/{case['id']}")
    assert unlinked.status_code == 200 and unlinked.json()["data"]["test_case_count"] == 0
    assert client.delete(f"/api/v1/tasks/{one['id']}/test-cases/{case['id']}").status_code == 404


# --- list / tree --------------------------------------------------------------------------------


def test_list_filters_and_tree(env: dict) -> None:
    client = env["client"]
    project_id = env["project"]["id"]
    root = _task(env, "Alpha root", priority="High")
    child = _task(env, "Alpha child", parent_task_id=root["id"])
    other = _task(env, "Beta root")
    _set_status(env, other["id"], "in_progress")

    def ids(query: str) -> list[str]:
        response = client.get(f"/api/v1/projects/{project_id}/tasks{query}")
        assert response.status_code == 200, response.text
        return [t["id"] for t in response.json()["data"]["items"]]

    assert set(ids("")) == {root["id"], child["id"], other["id"]}
    assert set(ids("?root_only=true")) == {root["id"], other["id"]}
    assert ids(f"?parent_task_id={root['id']}") == [child["id"]]
    assert ids("?category=in_progress") == [other["id"]]
    assert ids("?q=alpha%20child") == [child["id"]]
    assert ids(f"?q={root['display_id']}") == [root["id"]]

    tree = client.get(f"/api/v1/projects/{project_id}/tasks/tree").json()["data"]
    order = [t["id"] for t in tree["items"]]
    assert order.index(root["id"]) < order.index(child["id"])
    assert client.get(f"/api/v1/projects/{env['other']['id']}/tasks").json()["data"]["total"] == 0


# --- statuses -----------------------------------------------------------------------------------


def test_status_configuration_rules(env: dict) -> None:
    client = env["client"]
    created = client.post(
        "/api/v1/task-statuses",
        json={"code": "in_review", "label": "In Review", "category": "in_progress"},
    )
    assert created.status_code == 200, created.text
    review = created.json()["data"]
    assert (
        client.post(
            "/api/v1/task-statuses",
            json={"code": "in_review", "label": "Dup", "category": "todo"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/v1/task-statuses", json={"code": "Bad Code", "label": "x", "category": "todo"}
        ).status_code
        == 422
    )

    # A new status can be used right away; then it is locked in place.
    task = _task(env, "Reviewed task")
    env["statuses"]["in_review"] = review
    assert _set_status(env, task["id"], "in_review").status_code == 200
    assert client.delete(f"/api/v1/task-statuses/{review['id']}").status_code == 409
    assert (
        client.patch(f"/api/v1/task-statuses/{review['id']}", json={"category": "done"}).status_code
        == 409
    )
    renamed = client.patch(
        f"/api/v1/task-statuses/{review['id']}", json={"label": "Peer Review", "color": "#aa00ff"}
    )
    assert renamed.status_code == 200 and renamed.json()["data"]["label"] == "Peer Review"

    # Default handling and the "keep a todo and a done" rule.
    todo, done = env["statuses"]["todo"], env["statuses"]["done"]
    assert client.delete(f"/api/v1/task-statuses/{todo['id']}").status_code == 409  # default
    assert (
        client.patch(f"/api/v1/task-statuses/{done['id']}", json={"is_default": True}).status_code
        == 422
    )
    assert (
        client.patch(f"/api/v1/task-statuses/{todo['id']}", json={"is_default": False}).status_code
        == 409
    )
    backlog = client.post(
        "/api/v1/task-statuses",
        json={"code": "backlog", "label": "Backlog", "category": "todo", "is_default": True},
    ).json()["data"]
    assert backlog["is_default"] is True
    assert _task(env, "Lands in backlog")["status"]["code"] == "backlog"
    assert client.delete(f"/api/v1/task-statuses/{done['id']}").status_code == 409  # in use? no:
    # 'done' has no tasks but is the last done-category status.


def test_status_admin_requires_permission(env: dict) -> None:
    tester, _ = _tester_client(env)
    assert tester.get("/api/v1/task-statuses").status_code == 200
    assert (
        tester.post(
            "/api/v1/task-statuses", json={"code": "nope", "label": "Nope", "category": "todo"}
        ).status_code
        == 403
    )


def test_task_audit_trail(env: dict) -> None:
    client = env["client"]
    task = _task(env, "Audited task")
    client.patch(f"/api/v1/tasks/{task['id']}", json={"priority": "High"})
    _set_status(env, task["id"], "in_progress")
    client.delete(f"/api/v1/tasks/{task['id']}")
    logs = client.get("/api/v1/audit-logs", params={"entity_type": "task"})
    assert logs.status_code == 200, logs.text
    body = logs.json()["data"]
    items = body["items"] if isinstance(body, dict) else body
    actions = {entry["action"] for entry in items if entry["entity_id"] == task["id"]}
    assert {"task.created", "task.updated", "task.status_changed", "task.deleted"} <= actions


# --- phase 3: list filters and the Tasks project tab -----------------------------------------


def test_requirement_and_defect_lists_filter_by_task(env: dict) -> None:
    client = env["client"]
    project_id = env["project"]["id"]
    one, two = _task(env, "Filter task one"), _task(env, "Filter task two")
    for title, task in (("Req for one", one), ("Req for two", two), ("Req for nobody", None)):
        body = {"title": title + " here", "description": ""}
        if task:
            body["task_id"] = task["id"]
        assert (
            client.post(f"/api/v1/projects/{project_id}/requirements", json=body).status_code == 200
        )
    for title, task in (
        ("Defect for one", one),
        ("Defect for two", two),
        ("Defect for nobody", None),
    ):
        body = {"project_id": project_id, "title": title + " here", "severity": "High"}
        if task:
            body["task_id"] = task["id"]
        assert client.post("/api/v1/defects", json=body).status_code == 200

    reqs = client.get(f"/api/v1/projects/{project_id}/requirements", params={"task_id": one["id"]})
    assert [r["title"] for r in reqs.json()["data"]["items"]] == ["Req for one here"]
    assert reqs.json()["data"]["total"] == 1
    everything = client.get(f"/api/v1/projects/{project_id}/requirements").json()["data"]
    assert everything["total"] == 3

    defects = client.get("/api/v1/defects", params={"task_id": two["id"]}).json()["data"]
    items = defects["items"] if isinstance(defects, dict) else defects
    assert [d["title"] for d in items] == ["Defect for two here"]
    assert items[0]["task_display_id"] == two["display_id"]
    counts = client.get("/api/v1/defects/status-counts", params={"task_id": one["id"]})
    assert counts.status_code == 200 and counts.json()["data"]["total"] == 1


def test_tasks_is_a_hideable_project_tab(env: dict) -> None:
    client = env["client"]
    project = env["project"]
    saved = client.patch(
        f"/api/v1/projects/{project['id']}",
        json={
            "nav_config": {"order": ["overview", "tasks", "requirements"], "hidden": ["tasks"]},
            "expected_version": project["version"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["nav_config"]["hidden"] == ["tasks"]
    core = client.patch(
        f"/api/v1/projects/{project['id']}",
        json={
            "nav_config": {"order": [], "hidden": ["requirements"]},
            "expected_version": saved.json()["data"]["version"],
        },
    )
    assert core.status_code == 422
