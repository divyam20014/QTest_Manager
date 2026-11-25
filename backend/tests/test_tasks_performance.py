"""ADR-127 phase 7: task endpoints at volume.

One project of 13,100 tasks (100 top-level tasks, each with 10 sub-tasks, 4 below each and 2 below
those: four levels), 3,000 requirements, 2,000 defects and 2,000 linked test cases, seeded with SQL.
Every number is printed (run with -s) for the ADR; the limits are deliberately loose because the
suite runs on shared, slow machines -- they catch an accidental N+1 or a missing index, not a few
milliseconds. Same in-process methodology as tests/test_performance.py: no network, no browser.
"""

import time
import uuid

from sqlalchemy import text

from tests.test_tasks_api import env  # noqa: F401

ROOTS, CHILDREN, GRANDCHILDREN, LEAVES = 100, 10, 4, 2
TASKS = ROOTS * (1 + CHILDREN * (1 + GRANDCHILDREN * (1 + LEAVES)))


def _seed(conn, tenant_id: str, project_id: str) -> dict:
    user = conn.execute(
        text("select id from users where tenant_id = :t limit 1"), {"t": tenant_id}
    ).scalar_one()
    params = {"t": tenant_id, "p": project_id, "u": user}
    statuses = """(select id from task_statuses where tenant_id = :t
                   and code = (array['todo','in_progress','done'])[1 + (g.n % 3)])"""
    insert = f"""
        insert into tasks (tenant_id, project_id, parent_task_id, depth, title, status_id,
                           created_by)
        select :t, :p, {{parent}}, {{depth}}, 'Task ' || {{label}}, {statuses}, :u
        from {{source}}
    """
    conn.execute(
        text(
            insert.format(
                parent="null",
                depth=0,
                label="g.n",
                source=f"generate_series(1, {ROOTS}) as g(n)",
            )
        ),
        params,
    )
    for depth, per_parent in ((1, CHILDREN), (2, GRANDCHILDREN), (3, LEAVES)):
        conn.execute(
            text(
                f"""
                insert into tasks (tenant_id, project_id, parent_task_id, depth, title, status_id,
                                   created_by)
                select :t, :p, parent.id, {depth}, 'Task L{depth}-' || g.n || '-' || parent.title,
                       {statuses}, :u
                from tasks parent, generate_series(1, {per_parent}) as g(n)
                where parent.tenant_id = :t and parent.depth = {depth - 1}
                """
            ),
            params,
        )
    conn.execute(
        text(
            """
            update tasks x set display_seq = s.n, display_id = 'TASK_' || lpad(s.n::text, 6, '0')
            from (select id, row_number() over (order by depth, title, id) n
                  from tasks where tenant_id = :t) s
            where x.id = s.id
            """
        ),
        params,
    )
    leaf_ids = "(select id from tasks where tenant_id = :t order by display_seq limit %d)"
    conn.execute(
        text(
            """
            insert into requirements (tenant_id, project_id, task_id, title, created_by)
            select :t, :p, id, 'Requirement for ' || title, :u
            from tasks where tenant_id = :t and display_seq <= 3000
            """
        ),
        params,
    )
    conn.execute(
        text(
            """
            with v as (
                insert into requirement_versions (tenant_id, requirement_id, version_number, title,
                                                  created_by)
                select tenant_id, id, 1, title, created_by from requirements where tenant_id = :t
                returning id, requirement_id
            )
            update requirements r set current_version_id = v.id from v where r.id = v.requirement_id
            """
        ),
        params,
    )
    conn.execute(
        text(
            """
            insert into defects (tenant_id, project_id, task_id, title, severity, status,
                                 reported_by)
            select :t, :p, id, 'Defect for ' || title, 'High', 'Open', :u
            from tasks where tenant_id = :t and display_seq <= 2000
            """
        ),
        params,
    )
    conn.execute(
        text(
            """
            insert into test_cases (tenant_id, project_id, title, priority, created_by)
            select :t, :p, 'Case ' || g.n, 'High', :u from generate_series(1, 2000) as g(n)
            """
        ),
        params,
    )
    conn.execute(
        text(
            """
            insert into task_test_case_links (tenant_id, task_id, test_case_id, linked_by)
            select :t, t.id, c.id, :u
            from (select id, row_number() over (order by display_seq) n from tasks
                  where tenant_id = :t) t
            join (select id, row_number() over (order by title, id) n from test_cases
                  where tenant_id = :t) c on c.n = t.n
            where t.n <= 2000
            """
        ),
        params,
    )
    conn.execute(text("analyze tasks, requirements, defects, test_cases, task_test_case_links"))
    del leaf_ids
    return {"first_root": None}


def _timed(label: str, call, limit: float, runs: int = 3):
    best = None
    for _ in range(runs):
        started = time.perf_counter()
        response = call()
        elapsed = time.perf_counter() - started
        assert response.status_code == 200, (label, response.text)
        best = elapsed if best is None else min(best, elapsed)
    print(f"[tasks perf] {label}: best of {runs} = {best * 1000:.0f} ms")
    assert best < limit, f"{label} took {best:.2f}s (limit {limit}s)"
    return response


def test_task_endpoints_at_thirteen_thousand_tasks(env: dict, owner_engine) -> None:  # noqa: F811
    client = env["client"]
    project_id = env["project"]["id"]
    with owner_engine.begin() as conn:
        _seed(conn, env["tenant_id"], project_id)
        assert (
            conn.execute(
                text("select count(*) from tasks where tenant_id = :t"), {"t": env["tenant_id"]}
            ).scalar_one()
            == TASKS
        )

    base = f"/api/v1/projects/{project_id}/tasks"
    tree = _timed("tree (capped at 2,000)", lambda: client.get(f"{base}/tree"), 5.0).json()["data"]
    assert len(tree["items"]) == 2000 and tree["total"] == TASKS
    _timed("list page of 25", lambda: client.get(base, params={"page_size": 25}), 2.0)
    _timed("list, search 'Task 7'", lambda: client.get(base, params={"q": "Task 7"}), 2.0)
    _timed("list, category done", lambda: client.get(base, params={"category": "done"}), 2.0)
    _timed("list, overdue", lambda: client.get(base, params={"overdue": "true"}), 2.0)
    summary = _timed("summary", lambda: client.get(f"{base}/summary"), 2.0).json()["data"]
    assert summary["total"] == TASKS

    root = client.get(base, params={"root_only": "true", "page_size": 1}).json()["data"]["items"][0]
    rollup = _timed(
        "rollup of a 131-task subtree",
        lambda: client.get(f"/api/v1/tasks/{root['id']}/rollup"),
        3.0,
    )
    assert rollup.json()["data"]["sub_tasks_total"] == 130
    _timed(
        "effective test cases of the subtree",
        lambda: client.get(f"/api/v1/tasks/{root['id']}/test-cases"),
        3.0,
    )
    _timed("detail", lambda: client.get(f"/api/v1/tasks/{root['id']}"), 2.0)
    _timed(
        "requirements of a task and its sub-tasks",
        lambda: client.get(
            f"/api/v1/projects/{project_id}/requirements",
            params={"task_id": root["id"], "include_sub_tasks": "true", "page_size": 100},
        ),
        3.0,
    )
    _timed(
        "coverage of a task and its sub-tasks",
        lambda: client.get(
            f"/api/v1/projects/{project_id}/requirements/coverage",
            params={"task_id": root["id"], "include_sub_tasks": "true"},
        ),
        3.0,
    )
    _timed(
        "defects of a task and its sub-tasks",
        lambda: client.get(
            "/api/v1/defects", params={"task_id": root["id"], "include_sub_tasks": "true"}
        ),
        3.0,
    )
    _timed(
        "project traceability matrix for a task",
        lambda: client.get(
            "/api/v1/reports/traceability-matrix",
            params={"project_id": project_id, "task_id": root["id"], "include_sub_tasks": "true"},
        ),
        4.0,
    )
    _timed(
        "report builder over all tasks",
        lambda: client.post(
            "/api/v1/report-builder/preview",
            json={
                "definition": {
                    "source": "tasks",
                    "fields": [
                        "display_id",
                        "title",
                        "status",
                        "level",
                        "sub_tasks",
                        "requirements",
                        "defects",
                    ],
                    "sort": {"field": "display_id", "dir": "asc"},
                }
            },
        ),
        5.0,
    )

    # Moving a subtree rewrites every descendant's depth, level by level.
    roots = client.get(base, params={"root_only": "true", "page_size": 100}).json()["data"]["items"]
    # A done task cannot take an open sub-task (a hierarchy rule), so the new parent must be open.
    target = next(r for r in roots if r["status"]["category"] != "done")
    mover = next(r for r in roots if r["id"] != target["id"])
    started = time.perf_counter()
    moved = client.patch(f"/api/v1/tasks/{mover['id']}", json={"parent_task_id": target["id"]})
    elapsed = time.perf_counter() - started
    print(f"[tasks perf] move a 131-task subtree under another task: {elapsed * 1000:.0f} ms")
    assert moved.status_code == 200, moved.text
    assert moved.json()["data"]["depth"] == 1
    assert elapsed < 5.0
    # ...and the database agrees afterwards: every task is exactly one level below its parent.
    with owner_engine.connect() as conn:
        bad = conn.execute(
            text(
                "select count(*) from tasks c join tasks p on p.id = c.parent_task_id "
                "where c.tenant_id = :t and c.depth <> p.depth + 1"
            ),
            {"t": env["tenant_id"]},
        ).scalar_one()
    assert bad == 0
    assert uuid.UUID(root["id"])
