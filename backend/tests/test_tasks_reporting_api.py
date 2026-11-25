"""ADR-127 phase 6: task summary widget, coverage and traceability by task, search, reports."""

from tests.test_tasks_api import _set_status, _task, env  # noqa: F401
from tests.test_tasks_rollup_api import _approved_case, _run_with  # noqa: F401

B = "/api/v1/report-builder"


def _requirement(client, project_id: str, title: str, task_id: str | None = None) -> dict:
    body = {"title": title, "description": ""}
    if task_id:
        body["task_id"] = task_id
    r = client.post(f"/api/v1/projects/{project_id}/requirements", json=body)
    assert r.status_code == 200, r.text
    return r.json()["data"]


# --- the Overview "Task progress" widget ---------------------------------------------------------


def test_project_task_summary(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    parent = _task(env, "Summary parent", due_date="2099-01-01")
    done = _task(env, "Summary done child", parent_task_id=parent["id"])
    _task(env, "Summary late child", parent_task_id=parent["id"], due_date="2020-01-01")
    _task(env, "Summary soon task", assignee_id=None)
    _set_status(env, done["id"], "done")
    started = _task(env, "Summary started task")
    _set_status(env, started["id"], "in_progress")

    summary = client.get(f"/api/v1/projects/{project_id}/tasks/summary").json()["data"]
    assert summary["total"] == 5
    assert (summary["top_level"], summary["sub_tasks"]) == (3, 2)
    assert (summary["todo"], summary["in_progress"], summary["done"]) == (3, 1, 1)
    assert summary["progress_percent"] == 20
    assert summary["overdue"] == 1
    assert summary["unassigned_open"] == 4
    assert summary["completed_last_7_days"] == 1
    by_code = {s["code"]: s["count"] for s in summary["by_status"]}
    assert by_code == {"todo": 3, "in_progress": 1, "done": 1}
    # Every status is listed, in the tenant's order, even with nothing in it.
    assert [s["code"] for s in summary["by_status"]] == ["todo", "in_progress", "done"]

    other = client.get(f"/api/v1/projects/{env['other']['id']}/tasks/summary").json()["data"]
    assert other["total"] == 0 and other["progress_percent"] == 0


def test_summary_is_for_project_members_only(env: dict) -> None:  # noqa: F811
    from tests.test_tasks_api import _tester_client

    tester, _ = _tester_client(env, member=False)
    assert tester.get(f"/api/v1/projects/{env['project']['id']}/tasks/summary").status_code == 403


def test_task_progress_is_in_the_project_widget_catalogue(env: dict) -> None:  # noqa: F811
    layout = env["client"].get(f"/api/v1/projects/{env['project']['id']}/dashboard").json()["data"]
    assert "task_progress" in [w["widget_type"] for w in layout["catalogue"]]


# --- coverage and traceability by task -----------------------------------------------------------


def test_coverage_and_traceability_can_be_scoped_to_a_task(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    parent = _task(env, "Trace parent")
    child = _task(env, "Trace child", parent_task_id=parent["id"])
    own = _requirement(client, project_id, "Parent requirement", parent["id"])
    sub = _requirement(client, project_id, "Child requirement", child["id"])
    _requirement(client, project_id, "Nobody requirement")
    case = _approved_case(env, "Trace case")
    client.post(f"/api/v1/requirements/{own['id']}/test-cases", json={"test_case_id": case["id"]})
    _run_with(env, [case["id"]], {case["id"]: "pass"})

    cov = f"/api/v1/projects/{project_id}/requirements/coverage"
    everything = client.get(cov).json()["data"]
    assert (everything["total_requirements"], everything["covered_requirements"]) == (3, 1)
    own_only = client.get(cov, params={"task_id": parent["id"]}).json()["data"]
    assert (own_only["total_requirements"], own_only["covered_requirements"]) == (1, 1)
    with_sub = client.get(cov, params={"task_id": parent["id"], "include_sub_tasks": "true"})
    assert (with_sub.json()["data"]["total_requirements"]) == 2
    summary = client.get(cov, params={"task_id": child["id"], "summary": "true"}).json()["data"]
    assert (summary["total_requirements"], summary["covered_requirements"]) == (1, 0)

    matrix = "/api/v1/reports/traceability-matrix"
    full = client.get(matrix, params={"project_id": project_id}).json()["data"]
    assert full["total_requirements"] == 3
    by_title = {e["requirement_title"]: e for e in full["entries"]}
    assert by_title["Parent requirement"]["task_display_id"] == parent["display_id"]
    # A requirement created without a task is filed under the project's default task (ADR-128).
    assert by_title["Nobody requirement"]["task_display_id"] not in (None, parent["display_id"])

    scoped = client.get(
        matrix,
        params={"project_id": project_id, "task_id": parent["id"], "include_sub_tasks": "true"},
    ).json()["data"]
    assert sorted(e["requirement_title"] for e in scoped["entries"]) == [
        "Child requirement",
        "Parent requirement",
    ]
    assert scoped["overall_requirement_coverage_percentage"] == 50.0
    just_child = client.get(matrix, params={"project_id": project_id, "task_id": sub["id"]})
    assert just_child.status_code == 200 and just_child.json()["data"]["entries"] == []

    exported = client.get(
        f"{matrix}/export", params={"project_id": project_id, "task_id": parent["id"]}
    )
    lines = exported.text.strip().splitlines()
    assert lines[0].split(",")[:2] == ["Requirement", "Task"]
    assert lines[1].startswith(f"Parent requirement,{parent['display_id']},")
    assert len(lines) == 2


# --- search -----------------------------------------------------------------------------------


def test_search_finds_tasks_by_title_and_by_id(env: dict) -> None:  # noqa: F811
    client = env["client"]
    task = _task(env, "Zebra crossing logic")
    by_title = client.get("/api/v1/search", params={"q": "zebra"}).json()["data"]["results"]
    hit = next(r for r in by_title if r["type"] == "task")
    assert hit["id"] == task["id"] and hit["title"] == f"{task['display_id']} · {task['title']}"
    assert hit["project_id"] == env["project"]["id"]
    by_id = client.get("/api/v1/search", params={"q": task["display_id"]}).json()["data"]["results"]
    assert [r["id"] for r in by_id if r["type"] == "task"] == [task["id"]]


def test_search_hides_tasks_of_projects_a_tester_is_not_in(env: dict) -> None:  # noqa: F811
    from tests.test_tasks_api import _tester_client

    _task(env, "Secret Zebra plan")
    tester, _ = _tester_client(env, member=False)
    results = tester.get("/api/v1/search", params={"q": "zebra"}).json()["data"]["results"]
    assert [r for r in results if r["type"] == "task"] == []


# --- report builder -----------------------------------------------------------------------------


def test_report_builder_has_a_tasks_source(env: dict) -> None:  # noqa: F811
    client = env["client"]
    parent = _task(env, "Builder parent", priority="High", due_date="2020-01-01")
    child = _task(env, "Builder child", parent_task_id=parent["id"])
    _requirement(client, env["project"]["id"], "Builder requirement", parent["id"])
    _set_status(env, child["id"], "done")

    sources = client.get(f"{B}/sources").json()["data"]
    tasks = next(s for s in sources if s["key"] == "tasks")
    assert {"display_id", "status", "category", "level", "overdue", "sub_tasks", "defects"} <= {
        f["key"] for f in tasks["fields"]
    }

    definition = {
        "source": "tasks",
        "fields": [
            "display_id",
            "title",
            "status",
            "category",
            "level",
            "parent",
            "overdue",
            "sub_tasks",
            "requirements",
        ],
        "sort": {"field": "display_id", "dir": "asc"},
    }
    preview = client.post(f"{B}/preview", json={"definition": definition})
    assert preview.status_code == 200, preview.text
    rows = preview.json()["data"]["rows"]
    by_title = {r["title"]: r for r in rows}
    assert by_title["Builder parent"]["level"] == 1 and by_title["Builder child"]["level"] == 2
    assert by_title["Builder child"]["parent"] == parent["display_id"]
    assert by_title["Builder parent"]["overdue"] is True
    assert (
        by_title["Builder child"]["category"] == "done"
        and by_title["Builder child"]["overdue"] is False
    )
    assert (
        by_title["Builder parent"]["sub_tasks"],
        by_title["Builder parent"]["requirements"],
    ) == (1, 1)

    filtered = {
        "source": "tasks",
        "fields": ["title"],
        "filters": [{"field": "category", "op": "eq", "value": "done"}],
    }
    done = client.post(f"{B}/preview", json={"definition": filtered}).json()["data"]["rows"]
    assert [r["title"] for r in done] == ["Builder child"]

    grouped = {"source": "tasks", "fields": [], "group_by": ["category"]}
    groups = client.post(f"{B}/preview", json={"definition": grouped})
    assert groups.status_code == 200, groups.text


def test_report_builder_defects_show_their_task(env: dict) -> None:  # noqa: F811
    client = env["client"]
    task = _task(env, "Builder defect task")
    defect = client.post(
        "/api/v1/defects",
        json={
            "project_id": env["project"]["id"],
            "title": "Builder task defect",
            "severity": "High",
            "task_id": task["id"],
        },
    )
    assert defect.status_code == 200, defect.text
    definition = {"source": "defects", "fields": ["title", "task"]}
    rows = client.post(f"{B}/preview", json={"definition": definition}).json()["data"]["rows"]
    assert rows == [{"title": "Builder task defect", "task": task["display_id"]}]


def test_report_builder_tasks_respect_project_access(env: dict) -> None:  # noqa: F811
    from tests.test_tasks_api import _tester_client

    _task(env, "Builder hidden task")
    tester, _ = _tester_client(env, member=False)
    resp = tester.post(
        f"{B}/preview", json={"definition": {"source": "tasks", "fields": ["title"]}}
    )
    assert resp.status_code == 200 and resp.json()["data"]["rows"] == []
