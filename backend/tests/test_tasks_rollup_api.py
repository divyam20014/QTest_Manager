"""ADR-127 phase 4: roll-ups, effective test cases, runs, comments, attachments and history."""

from tests.test_tasks_api import _set_status, _task, _tester_client, env  # noqa: F401


def _approved_case(env: dict, title: str) -> dict:  # noqa: F811
    client = env["client"]
    case = client.post(
        f"/api/v1/projects/{env['project']['id']}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "Do it", "expected": "Works"}],
        },
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    return client.post(f"/api/v1/test-cases/{case['id']}/approve").json()["data"]


def _run_with(env: dict, case_ids: list[str], verdicts: dict[str, str]) -> dict:  # noqa: F811
    """A run of the cases where each case's single step gets the verdict given for it."""
    client = env["client"]
    run = client.post(
        f"/api/v1/projects/{env['project']['id']}/test-runs",
        json={"name": "Task run", "run_type": "Regression", "test_case_ids": case_ids},
    ).json()["data"]
    for run_case in run["cases"]:
        verdict = verdicts.get(run_case["test_case_id"])
        if verdict is None:
            continue
        step = client.get(f"/api/v1/test-run-cases/{run_case['id']}/steps").json()["data"][0]
        client.post(f"/api/v1/execution-steps/{step['id']}/open")
        body = {"verdict": verdict}
        if verdict == "fail":
            body["actual_result"] = "It broke"
        done = client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json=body)
        assert done.status_code == 200, done.text
    return run


def test_rollup_counts_the_task_and_its_sub_tasks(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    parent = _task(env, "Rollup parent")
    done_child = _task(env, "Rollup done child", parent_task_id=parent["id"])
    _task(env, "Rollup open child", parent_task_id=parent["id"], due_date="2020-01-01")
    _set_status(env, done_child["id"], "done")

    requirement = client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "Covered requirement", "description": "", "task_id": parent["id"]},
    ).json()["data"]
    client.post(
        f"/api/v1/projects/{project_id}/requirements",
        json={"title": "Uncovered requirement", "description": "", "task_id": done_child["id"]},
    )
    via_requirement = _approved_case(env, "Case via requirement")
    direct = _approved_case(env, "Case linked directly")
    untested = _approved_case(env, "Case never run")
    client.post(
        f"/api/v1/requirements/{requirement['id']}/test-cases",
        json={"test_case_id": via_requirement["id"]},
    )
    client.post(f"/api/v1/tasks/{done_child['id']}/test-cases", json={"test_case_id": direct["id"]})
    client.post(f"/api/v1/tasks/{parent['id']}/test-cases", json={"test_case_id": untested["id"]})
    run = _run_with(
        env,
        [via_requirement["id"], direct["id"]],
        {via_requirement["id"]: "pass", direct["id"]: "fail"},
    )

    for severity in ("Critical", "Low"):
        client.post(
            "/api/v1/defects",
            json={
                "project_id": project_id,
                "title": f"{severity} rollup defect",
                "severity": severity,
                "task_id": done_child["id"],
            },
        )

    rollup = client.get(f"/api/v1/tasks/{parent['id']}/rollup").json()["data"]
    assert (rollup["sub_tasks_total"], rollup["sub_tasks_done"], rollup["sub_tasks_todo"]) == (
        2,
        1,
        1,
    )
    assert rollup["sub_tasks_overdue"] == 1
    assert rollup["progress_percent"] == 50
    assert (rollup["requirements_total"], rollup["requirements_covered"]) == (2, 1)
    assert rollup["test_cases_total"] == 3
    assert (rollup["test_cases_passed"], rollup["test_cases_failed"]) == (1, 1)
    assert rollup["test_cases_not_run"] == 1
    assert rollup["pass_rate"] == 50
    assert rollup["test_runs_total"] == 1
    assert (
        rollup["defects_total"],
        rollup["defects_open"],
        rollup["defects_critical_open"],
    ) == (2, 2, 1)

    own = client.get(f"/api/v1/tasks/{parent['id']}/rollup?include_sub_tasks=false").json()["data"]
    assert own["sub_tasks_total"] == 0 and own["defects_total"] == 0
    assert (own["requirements_total"], own["test_cases_total"]) == (1, 2)

    cases = client.get(f"/api/v1/tasks/{parent['id']}/test-cases").json()["data"]
    by_title = {c["title"]: c for c in cases}
    assert by_title["Case via requirement"]["via_requirement"] is True
    assert by_title["Case via requirement"]["last_result"] == "passed"
    assert by_title["Case linked directly"]["linked_directly"] is True
    assert by_title["Case linked directly"]["last_result"] == "failed"
    assert by_title["Case never run"]["last_result"] is None
    only_own = client.get(f"/api/v1/tasks/{parent['id']}/test-cases?include_sub_tasks=false")
    assert len(only_own.json()["data"]) == 2

    runs = client.get(f"/api/v1/tasks/{parent['id']}/test-runs").json()["data"]
    assert [r["run_id"] for r in runs] == [run["id"]]
    assert (runs[0]["cases_total"], runs[0]["cases_passed"], runs[0]["cases_failed"]) == (2, 1, 1)


def test_rollup_of_a_leaf_task_follows_its_own_status(env: dict) -> None:  # noqa: F811
    leaf = _task(env, "Lonely leaf task")
    first = env["client"].get(f"/api/v1/tasks/{leaf['id']}/rollup").json()["data"]
    assert first["progress_percent"] == 0 and first["pass_rate"] is None
    assert first["test_cases_total"] == 0
    _set_status(env, leaf["id"], "done")
    second = env["client"].get(f"/api/v1/tasks/{leaf['id']}/rollup").json()["data"]
    assert second["progress_percent"] == 100
    assert env["client"].get(f"/api/v1/tasks/{leaf['id']}/test-runs").json()["data"] == []


def test_lists_can_include_sub_tasks(env: dict) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    parent = _task(env, "Include parent")
    child = _task(env, "Include child", parent_task_id=parent["id"])
    for title, task in (("Parent requirement", parent), ("Child requirement", child)):
        client.post(
            f"/api/v1/projects/{project_id}/requirements",
            json={"title": title, "description": "", "task_id": task["id"]},
        )
        client.post(
            "/api/v1/defects",
            json={
                "project_id": project_id,
                "title": title + " defect",
                "severity": "High",
                "task_id": task["id"],
            },
        )
    url = f"/api/v1/projects/{project_id}/requirements"
    assert client.get(url, params={"task_id": parent["id"]}).json()["data"]["total"] == 1
    both = client.get(url, params={"task_id": parent["id"], "include_sub_tasks": "true"})
    assert both.json()["data"]["total"] == 2
    defects = client.get(
        "/api/v1/defects", params={"task_id": parent["id"], "include_sub_tasks": "true"}
    ).json()["data"]
    assert len(defects["items"] if isinstance(defects, dict) else defects) == 2


def test_task_comments_attachments_and_history(env: dict) -> None:  # noqa: F811
    client = env["client"]
    task = _task(env, "Discussed task")
    posted = client.post(f"/api/v1/tasks/{task['id']}/comments", json={"body": "First thoughts"})
    assert posted.status_code == 200, posted.text
    comments = client.get(f"/api/v1/tasks/{task['id']}/comments").json()["data"]
    assert [c["body"] for c in comments] == ["First thoughts"]
    upload = client.post(
        f"/api/v1/tasks/{task['id']}/attachments",
        files={"file": ("notes.txt", b"some notes", "text/plain")},
    )
    assert upload.status_code == 200, upload.text
    listing = client.get(f"/api/v1/tasks/{task['id']}/attachments").json()["data"]
    assert [a["file_name"] for a in listing] == ["notes.txt"]
    assert client.get(f"/api/v1/attachments/{listing[0]['id']}/download").content == b"some notes"

    history = client.get(f"/api/v1/tasks/{task['id']}/history").json()["data"]
    actions = [h["action"] for h in history]
    assert actions[0] == "task.created" and "comment.created" in actions

    # Not visible to someone outside the project.
    tester, _ = _tester_client(env, member=False)
    for suffix in ("comments", "attachments", "history", "rollup", "test-cases", "test-runs"):
        assert tester.get(f"/api/v1/tasks/{task['id']}/{suffix}").status_code == 403
    assert (
        tester.post(f"/api/v1/tasks/{task['id']}/comments", json={"body": "hi"}).status_code == 403
    )
