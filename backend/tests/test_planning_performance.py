"""Phase 2 at volume: backlog, board and sprint with more tasks than the 2,000-task tree cap.

6,000 open tasks in one project, seeded with SQL, 1,500 of them planned into a sprint. As in
tests/test_tasks_performance.py the limits are loose (shared, slow machines): they catch an
accidental N+1 or a missing index, not a few milliseconds, and the correctness checks matter more.
"""

import time

from sqlalchemy import text

from tests.test_tasks_api import env  # noqa: F401

TASKS = 6000
IN_SPRINT = 1500


def _seed(conn, tenant_id: str, project_id: str) -> str:
    user = conn.execute(
        text("select id from users where tenant_id = :t limit 1"), {"t": tenant_id}
    ).scalar_one()
    params = {"t": tenant_id, "p": project_id, "u": user}
    conn.execute(
        text(
            """
            insert into tasks (tenant_id, project_id, depth, title, status_id, created_by,
                               backlog_rank, estimate_hours, display_seq, display_id)
            select :t, :p, 0, 'Planned task ' || g.n,
                   (select id from task_statuses where tenant_id = :t
                    and code = (array['todo','in_progress'])[1 + (g.n % 2)]),
                   :u, g.n * 1000, 1, g.n, 'TASK_' || lpad(g.n::text, 6, '0')
            from generate_series(1, :n) as g(n)
            """
        ),
        {**params, "n": TASKS},
    )
    sprint = conn.execute(
        text(
            "insert into sprints (tenant_id, project_id, name, start_date, end_date) "
            "values (:t, :p, 'Big sprint', '2026-12-01', '2026-12-14') returning id"
        ),
        params,
    ).scalar_one()
    conn.execute(
        text(
            "update tasks set sprint_id = :s where tenant_id = :t and project_id = :p "
            "and display_seq <= :k"
        ),
        {**params, "s": sprint, "k": IN_SPRINT},
    )
    conn.execute(text("analyze tasks, sprints"))
    return str(sprint)


def _timed(label: str, call, limit: float):
    started = time.perf_counter()
    response = call()
    elapsed = time.perf_counter() - started
    print(f"[planning perf] {label}: {elapsed * 1000:.0f} ms")
    assert response.status_code == 200, (label, response.text)
    assert elapsed < limit, f"{label} took {elapsed:.2f}s (limit {limit}s)"
    return response.json()["data"]


def test_backlog_board_and_sprint_with_thousands_of_tasks(env: dict, owner_engine) -> None:  # noqa: F811
    client = env["client"]
    project = env["project"]["id"]
    with owner_engine.begin() as conn:
        sprint = _seed(conn, env["tenant_id"], project)
    unplanned = TASKS - IN_SPRINT

    # --- backlog: only what is not in the sprint, in rank order, paged -------------------------
    backlog = f"/api/v1/projects/{project}/backlog"
    first = _timed("backlog, first 500", lambda: client.get(backlog, params={"limit": 500}), 3.0)
    assert first["total"] == unplanned and len(first["items"]) == 500
    assert first["items"][0]["title"] == f"Planned task {IN_SPRINT + 1}"
    deep = _timed(
        "backlog, page deep in the list",
        lambda: client.get(backlog, params={"limit": 500, "offset": 4000}),
        3.0,
    )
    assert len(deep["items"]) == unplanned - 4000 and deep["items"][0]["estimate_hours"] == "1.00"

    # --- one move among thousands rewrites one row ---------------------------------------------
    last, front = first["items"][-1], first["items"][0]
    moved = _timed(
        "move a task to the front",
        lambda: client.post(
            f"/api/v1/tasks/{last['id']}/rank", json={"before_task_id": front["id"]}
        ),
        3.0,
    )
    assert moved["id"] == last["id"]
    after = client.get(backlog, params={"limit": 2}).json()["data"]["items"]
    assert [t["id"] for t in after] == [last["id"], front["id"]]
    with owner_engine.connect() as conn:
        changed = conn.execute(
            text("select count(*) from tasks where tenant_id = :t and backlog_rank is null"),
            {"t": env["tenant_id"]},
        ).scalar_one()
    assert changed == 0

    # --- the board loads one status at a time --------------------------------------------------
    statuses = {s["code"]: s["id"] for s in client.get("/api/v1/task-statuses").json()["data"]}
    column = _timed(
        "board column of 20",
        lambda: client.get(
            f"/api/v1/projects/{project}/tasks",
            params={"status_id": statuses["todo"], "page": 1, "page_size": 20},
        ),
        3.0,
    )
    assert len(column["items"]) == 20 and column["total"] == TASKS // 2
    in_sprint = _timed(
        "board filtered to the sprint",
        lambda: client.get(
            f"/api/v1/projects/{project}/tasks",
            params={"sprint_id": sprint, "page": 1, "page_size": 20},
        ),
        3.0,
    )
    assert in_sprint["total"] == IN_SPRINT

    # --- a sprint of 1,500 tasks: start, read, close -------------------------------------------
    started = _timed(
        "start the sprint", lambda: client.post(f"/api/v1/sprints/{sprint}/start"), 10.0
    )
    assert started["totals"]["planned"]["count"] == IN_SPRINT
    detail = _timed("read the sprint", lambda: client.get(f"/api/v1/sprints/{sprint}"), 5.0)
    assert len(detail["tasks"]) == IN_SPRINT
    closed = _timed(
        "close the sprint",
        lambda: client.post(f"/api/v1/sprints/{sprint}/close", json={"move_unfinished_to": None}),
        10.0,
    )
    assert closed["totals"]["unfinished"]["count"] == IN_SPRINT
    # Everything unfinished is back in the backlog.
    total = client.get(backlog, params={"limit": 1}).json()["data"]["total"]
    assert total == TASKS
