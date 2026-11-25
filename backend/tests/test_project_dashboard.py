"""ADR-123: project dashboard aggregates, run-case due dates and project dashboard layouts.

Every aggregate is compared with what the underlying list endpoints (or raw SQL) return for the
same seeded project, including a case-scoped Tester and a soft-deleted case.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_execution import _create_approved_case
from tests.test_project_role_scoping import _create_project
from tests.test_tester_visibility import _as, _set, _setup

API = "/api/v1"
TODAY = datetime.now(UTC).date()


def _d(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def _module(client: TestClient, project_id: str, name: str) -> str:
    r = client.post(f"{API}/projects/{project_id}/modules", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


def _case(client: TestClient, project_id: str, title: str, module_id: str | None = None) -> str:
    body = {"title": title, "priority": "High"}
    if module_id:
        body["module_id"] = module_id
    created = client.post(
        f"{API}/projects/{project_id}/test-cases",
        json={**body, "steps": [{"action": "do it", "expected": "it works"}] * 2},
    )
    assert created.status_code == 200, created.text
    case_id = created.json()["data"]["id"]
    assert client.post(f"{API}/test-cases/{case_id}/submit-review").status_code == 200
    assert client.post(f"{API}/test-cases/{case_id}/approve").status_code == 200
    return case_id


def _run(client: TestClient, project_id: str, name: str, case_ids: list[str], **extra) -> dict:
    r = client.post(
        f"{API}/projects/{project_id}/test-runs",
        json={"name": name, "run_type": "Regression", "test_case_ids": case_ids, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _rc(run: dict, case_id: str) -> str:
    return next(c["id"] for c in run["cases"] if c["test_case_id"] == case_id)


def _verdict_all(client: TestClient, run_case_id: str, verdict: str) -> None:
    steps = client.get(f"{API}/test-run-cases/{run_case_id}/steps").json()["data"]
    for step in steps:
        body = {"verdict": verdict}
        if verdict == "fail":
            body["actual_result"] = "It broke"
        r = client.post(f"{API}/execution-steps/{step['id']}/verdict", json=body)
        assert r.status_code == 200, r.text


def _count(client: TestClient, path: str, **params) -> int:
    r = client.get(f"{API}{path}", params={"page_size": 1, **params})
    assert r.status_code == 200, r.text
    return r.json()["data"]["total"]


@pytest.fixture
def seeded(client: TestClient, platform_admin: dict, owner_engine) -> dict:
    """Admin session active. Project P (the _setup project: 3 cases, a tester member) gets two
    modules, executions in several runs, a soft-deleted executed case, defects, releases and
    due dates. Project Q has its own executed case that must never leak into P."""
    s = _setup(client, platform_admin, "Dash Four")
    p = s["project_id"]
    with owner_engine.begin() as conn:
        for who in ("tester", "manager"):
            s[f"{who}_id"] = str(
                conn.execute(
                    text("SELECT id FROM users WHERE email = :e"), {"e": s[f"{who}_email"]}
                ).scalar_one()
            )
    alpha = _module(client, p, "Alpha")
    beta = _module(client, p, "Beta")
    a1, a2, a3 = (_case(client, p, f"Alpha case {i}", alpha) for i in (1, 2, 3))
    b1, b2, f1 = (_case(client, p, t, beta) for t in ("Beta blocked", "Beta idle", "Beta failing"))
    g1 = _case(client, p, "General idle")
    d1 = _case(client, p, "Doomed executed", alpha)

    r1 = _run(client, p, "Run one", [a1, a2, b1, g1, f1], due_date=_d(-3))
    _verdict_all(client, _rc(r1, a1), "pass")
    _verdict_all(client, _rc(r1, a2), "fail")
    _verdict_all(client, _rc(r1, f1), "fail")
    blocked = client.post(
        f"{API}/test-run-cases/{_rc(r1, b1)}/block", json={"reason": "environment down"}
    )
    assert blocked.status_code == 200, blocked.text
    # a2's newer result wins over its earlier failure (latest executed run case).
    r3 = _run(client, p, "Run three", [a2])
    _verdict_all(client, _rc(r3, a2), "pass")
    r2 = _run(client, p, "Run two", [a3, b2])
    _verdict_all(client, _rc(r2, a3), "pass")
    r4 = _run(client, p, "Run four", [d1])
    _verdict_all(client, _rc(r4, d1), "pass")
    assert client.delete(f"{API}/test-cases/{d1}").status_code == 200

    # Due dates: g1 (open, past) is overdue; a1's was passed so it is not; b2 is upcoming.
    ok = client.patch(
        f"{API}/test-run-cases/{_rc(r2, b2)}/assign",
        json={"assigned_to": s["tester_id"], "due_date": _d(5)},
    )
    assert ok.status_code == 200, ok.text

    other = _create_project(client, "Dash Four Other")
    q_case = _create_approved_case(client, other["id"], "Other project case")
    q_run = _run(client, other["id"], "Q run", [q_case["id"], _case(client, other["id"], "Q idle")])
    _verdict_all(client, q_run["cases"][0]["id"], "pass")

    for title, severity in (("First defect here", "Critical"), ("Second defect here", "Low")):
        r = client.post(
            f"{API}/defects", json={"project_id": p, "title": title, "severity": severity}
        )
        assert r.status_code == 200, r.text
    client.post(
        f"{API}/defects",
        json={"project_id": other["id"], "title": "Other project defect", "severity": "High"},
    )

    for name, offset, status in (
        ("Upcoming planned", 10, "Planned"),
        ("Upcoming unset", 20, None),
        ("Past release", -10, "Planned"),
        ("Shipped", 15, "Released"),
    ):
        r = client.post(
            f"{API}/projects/{p}/releases",
            json={"name": name, "release_date": _d(offset), "status": status},
        )
        assert r.status_code == 200, r.text

    s.update(
        {
            "other_project_id": other["id"],
            "alpha": alpha,
            "beta": beta,
            "r1": r1,
            "r2": r2,
            "g1_rc": _rc(r1, g1),
            "a1_rc": _rc(r1, a1),
            "b2_rc": _rc(r2, b2),
        }
    )
    return s


# --- project-test-status ------------------------------------------------------------------


def test_project_test_status_matches_the_test_case_list(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    r = client.get(f"{API}/reports/project-test-status", params={"project_id": p})
    assert r.status_code == 200, r.text
    got = r.json()["data"]
    # 3 cases from _setup + 7 created here; the deleted executed case is excluded.
    listed = {
        label: _count(client, f"/projects/{p}/test-cases", execution_status=label)
        for label in ("Pass", "Fail", "Blocked", "Skipped", "Not Run")
    }
    assert got["total"] == _count(client, f"/projects/{p}/test-cases") == 10
    assert got["passed"] == listed["Pass"] == 3  # a1, a2 (latest), a3
    assert got["failed"] == listed["Fail"] == 1  # f1
    assert got["blocked"] == listed["Blocked"] == 1  # b1
    assert got["skipped"] == listed["Skipped"] == 0
    assert got["not_run"] == listed["Not Run"] == 5
    assert got["executed"] == 5 and got["executed"] + got["not_run"] == got["total"]
    # The "Executed" KPI links to a list that really applies the same filter.
    assert _count(client, f"/projects/{p}/test-cases", execution_status="Executed") == 5
    assert got["execution_percentage"] == 50.0 and got["pass_rate"] == 60.0


def test_project_test_status_matches_raw_sql(
    client: TestClient, seeded: dict, owner_engine
) -> None:
    p = seeded["project_id"]
    got = client.get(f"{API}/reports/project-test-status", params={"project_id": p}).json()["data"]
    with owner_engine.begin() as conn:
        rows = dict(
            conn.execute(
                text(
                    "SELECT coalesce(l.status, 'none'), count(*) FROM test_cases tc "
                    "LEFT JOIN LATERAL (SELECT rc.status FROM test_run_cases rc "
                    "  JOIN test_runs r ON r.id = rc.test_run_id "
                    "  WHERE rc.test_case_id = tc.id AND r.deleted_at IS NULL "
                    "    AND rc.status IN ('passed','failed','blocked','ignored') "
                    "  ORDER BY coalesce(rc.executed_at, rc.completed_at, rc.started_at) "
                    "    DESC NULLS LAST, rc.id DESC LIMIT 1) l ON true "
                    "WHERE tc.project_id = :p AND tc.deleted_at IS NULL GROUP BY 1"
                ),
                {"p": p},
            ).all()
        )
    assert rows.get("passed", 0) == got["passed"]
    assert rows.get("failed", 0) == got["failed"]
    assert rows.get("blocked", 0) == got["blocked"]
    assert rows.get("none", 0) == got["not_run"]
    assert sum(rows.values()) == got["total"]


def test_project_scope_is_enforced(client: TestClient, seeded: dict) -> None:
    other = seeded["other_project_id"]
    q = client.get(f"{API}/reports/project-test-status", params={"project_id": other}).json()
    assert q["data"]["total"] == 2 and q["data"]["passed"] == 1  # only Q's own numbers
    p = client.get(
        f"{API}/reports/project-test-status", params={"project_id": seeded["project_id"]}
    ).json()
    assert p["data"]["total"] == 10
    unknown = client.get(
        f"{API}/reports/project-test-status", params={"project_id": str(uuid.uuid4())}
    )
    assert unknown.status_code == 404
    for path in (
        "project-test-status",
        "module-coverage",
        "tester-performance",
        "overdue-run-cases",
        "upcoming-milestones",
    ):
        assert client.get(f"{API}/reports/{path}").status_code == 422  # project_id is required
    # A tester who is not a member of Q is refused on every aggregate.
    _as(client, seeded, "tester")
    for path in (
        "project-test-status",
        "module-coverage",
        "tester-performance",
        "overdue-run-cases",
        "upcoming-milestones",
    ):
        r = client.get(f"{API}/reports/{path}", params={"project_id": other})
        assert r.status_code == 403, path


# --- module-coverage ----------------------------------------------------------------------


def test_module_coverage_matches_module_filtered_lists(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    data = client.get(f"{API}/reports/module-coverage", params={"project_id": p}).json()["data"]
    rows = {r["module_id"]: r for r in data["rows"]}
    assert data["project_id"] == p
    assert sum(r["total"] for r in rows.values()) == 10
    for module_id, row in rows.items():
        assert module_id is not None  # every seeded case has a module (default "General")
        assert row["total"] == _count(client, f"/projects/{p}/test-cases", module_id=module_id)
        for label, key in (("Pass", "passed"), ("Fail", "failed"), ("Blocked", "blocked")):
            assert row[key] == _count(
                client, f"/projects/{p}/test-cases", module_id=module_id, execution_status=label
            )
        assert row["not_run"] == _count(
            client, f"/projects/{p}/test-cases", module_id=module_id, execution_status="Not Run"
        )
        assert row["executed"] == row["total"] - row["not_run"]
    alpha, beta = rows[seeded["alpha"]], rows[seeded["beta"]]
    assert (alpha["total"], alpha["passed"], alpha["failed"]) == (3, 3, 0)  # d1 deleted
    assert (beta["total"], beta["blocked"], beta["failed"], beta["not_run"]) == (3, 1, 1, 1)
    assert alpha["coverage_percentage"] == 100.0
    assert beta["coverage_percentage"] == pytest.approx(66.7)
    assert [r["total"] for r in data["rows"]] == sorted(
        (r["total"] for r in data["rows"]), reverse=True
    )


# --- tester-performance -------------------------------------------------------------------


def test_tester_performance_matches_executed_by_and_defect_counts(
    client: TestClient, seeded: dict, owner_engine
) -> None:
    p = seeded["project_id"]
    admin_id = client.get(f"{API}/auth/me").json()["data"]["user_id"]
    data = client.get(f"{API}/reports/tester-performance", params={"project_id": p}).json()["data"]
    row = next(r for r in data["rows"] if r["user_id"] == admin_id)
    assert row["executed"] == _count(client, f"/projects/{p}/test-cases", executed_by=admin_id) == 5
    assert (row["passed"], row["failed"], row["blocked"]) == (3, 1, 1)
    assert row["pass_rate"] == 60.0
    with owner_engine.begin() as conn:
        raw = conn.execute(
            text(
                "SELECT count(*) FROM defects WHERE project_id = :p AND reported_by = :u "
                "AND deleted_at IS NULL"
            ),
            {"p": p, "u": admin_id},
        ).scalar_one()
    assert (
        row["defects_raised"]
        == raw
        == _count(client, "/defects", project_id=p, reported_by=admin_id)
        == 2
    )
    assert sum(r["defects_raised"] for r in data["rows"]) == _count(
        client, "/defects", project_id=p
    )


# --- overdue and upcoming -----------------------------------------------------------------


def test_overdue_run_cases_only_open_past_due(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    data = client.get(f"{API}/reports/overdue-run-cases", params={"project_id": p}).json()["data"]
    ids = {i["run_case_id"] for i in data["items"]}
    # Run one was created with a due date 3 days ago: b1 (blocked) and a1/a2/f1 (executed) are
    # not overdue; only g1 is still pending.
    assert ids == {seeded["g1_rc"]}
    assert data["total"] == 1 and data["items"][0]["days_overdue"] == 3
    # The future due date on b2 is not overdue.
    assert seeded["b2_rc"] not in ids
    with_raw = client.get(f"{API}/test-runs/{seeded['r1']['id']}").json()["data"]["cases"]
    assert sum(1 for c in with_raw if c["due_date"] == _d(-3)) == 5


def test_upcoming_milestones_releases_and_run_due_dates(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    data = client.get(f"{API}/reports/upcoming-milestones", params={"project_id": p}).json()["data"]
    got = [(m["kind"], m["name"], m["milestone_date"]) for m in data["items"]]
    assert got == [
        ("run_due", "Run two", _d(5)),
        ("release", "Upcoming planned", _d(10)),
        ("release", "Upcoming unset", _d(20)),
    ]  # past and Released releases are not upcoming
    run_due = data["items"][0]
    assert run_due["open_cases"] == 1 and run_due["days_until"] == 5


# --- tester scope -------------------------------------------------------------------------


def test_aggregates_follow_the_tester_case_scope(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    assert _set(client, testers_see_assigned_cases_only=True).status_code == 200
    # Assign two executed/open run cases to the tester so they can see those cases.
    for rc in (seeded["a1_rc"], seeded["g1_rc"]):
        client.patch(f"{API}/test-run-cases/{rc}/assign", json={"assigned_to": seeded["tester_id"]})
    admin_total = client.get(f"{API}/reports/project-test-status", params={"project_id": p}).json()[
        "data"
    ]["total"]
    _as(client, seeded, "tester")
    got = client.get(f"{API}/reports/project-test-status", params={"project_id": p}).json()["data"]
    assert got["total"] == _count(client, f"/projects/{p}/test-cases") < admin_total
    for label, key in (("Pass", "passed"), ("Fail", "failed"), ("Blocked", "blocked")):
        assert got[key] == _count(client, f"/projects/{p}/test-cases", execution_status=label)
    assert got["not_run"] == _count(client, f"/projects/{p}/test-cases", execution_status="Not Run")
    modules = client.get(f"{API}/reports/module-coverage", params={"project_id": p}).json()["data"]
    assert sum(r["total"] for r in modules["rows"]) == got["total"]
    overdue = client.get(f"{API}/reports/overdue-run-cases", params={"project_id": p}).json()
    assert {i["run_case_id"] for i in overdue["data"]["items"]} == {seeded["g1_rc"]}
    # The tester's overdue list hides run cases of cases outside their scope: b2 (assigned to
    # them, upcoming) shows, so upcoming has the run due date but not the other cases.
    up = client.get(f"{API}/reports/upcoming-milestones", params={"project_id": p}).json()["data"]
    assert any(m["kind"] == "run_due" for m in up["items"])


def test_tester_performance_hidden_with_reports(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    assert _set(client, reports_hidden_from_testers=True).status_code == 200
    _as(client, seeded, "tester")
    assert (
        client.get(f"{API}/reports/tester-performance", params={"project_id": p}).status_code == 403
    )
    # The Overview's own numbers still render (like /dashboard/summary).
    assert (
        client.get(f"{API}/reports/project-test-status", params={"project_id": p}).status_code
        == 200
    )


# --- due dates ----------------------------------------------------------------------------


def test_due_date_assignment_is_independent_of_the_assignee(
    client: TestClient, seeded: dict
) -> None:
    rc = seeded["g1_rc"]
    tester = seeded["tester_id"]
    r = client.patch(f"{API}/test-run-cases/{rc}/assign", json={"assigned_to": tester})
    # The due date set when the run was created (3 days ago) is left alone.
    assert r.json()["data"]["assigned_to"] == tester and r.json()["data"]["due_date"] == _d(-3)
    # Only a due date: the assignee is kept.
    r = client.patch(f"{API}/test-run-cases/{rc}/assign", json={"due_date": _d(7)})
    assert r.status_code == 200 and r.json()["data"]["assigned_to"] == tester
    assert r.json()["data"]["due_date"] == _d(7)
    # Only an assignee: the due date is kept.
    r = client.patch(f"{API}/test-run-cases/{rc}/assign", json={"assigned_to": None})
    assert r.json()["data"]["assigned_to"] is None and r.json()["data"]["due_date"] == _d(7)
    # null clears the date; years outside 2000-2100 are refused.
    r = client.patch(f"{API}/test-run-cases/{rc}/assign", json={"due_date": None})
    assert r.json()["data"]["due_date"] is None
    for bad in ("1999-12-31", "2101-01-01", "not-a-date"):
        assert (
            client.patch(f"{API}/test-run-cases/{rc}/assign", json={"due_date": bad}).status_code
            == 422
        )


def test_due_date_on_create_add_cases_audit_and_read_schemas(
    client: TestClient, seeded: dict, owner_engine
) -> None:
    p = seeded["project_id"]
    extra = _case(client, p, "Extra for due")
    run = _run(client, p, "Due run", [extra], due_date=_d(2))
    assert [c["due_date"] for c in run["cases"]] == [_d(2)]
    extra2 = _case(client, p, "Extra two for due")
    added = client.post(
        f"{API}/test-runs/{run['id']}/cases", json={"test_case_ids": [extra2], "due_date": _d(4)}
    ).json()["data"]
    assert sorted(c["due_date"] for c in added["cases"]) == [_d(2), _d(4)]
    rc = _rc(added, extra)
    ctx = client.get(f"{API}/test-run-cases/{rc}/context").json()["data"]
    assert ctx["due_date"] == _d(2)
    client.patch(f"{API}/test-run-cases/{rc}/assign", json={"due_date": _d(9)})
    with owner_engine.begin() as conn:
        meta = conn.execute(
            text(
                "SELECT metadata FROM audit_logs WHERE action = 'testruncase.assigned' "
                "AND entity_id = :e ORDER BY created_at DESC LIMIT 1"
            ),
            {"e": rc},
        ).scalar_one()
    assert meta["due_date"] == _d(9)
    bad = client.post(
        f"{API}/projects/{p}/test-runs",
        json={
            "name": "Bad due",
            "run_type": "Smoke",
            "test_case_ids": [extra],
            "due_date": "1990-01-01",
        },
    )
    assert bad.status_code == 422


def test_my_work_run_cases_carry_due_date_overdue_and_project_filter(
    client: TestClient, seeded: dict
) -> None:
    p = seeded["project_id"]
    client.patch(
        f"{API}/test-run-cases/{seeded['g1_rc']}/assign",
        json={"assigned_to": seeded["tester_id"], "due_date": _d(-2)},
    )
    _as(client, seeded, "tester")
    mine = client.get(f"{API}/my-work/run-cases").json()["data"]
    row = next(i for i in mine["items"] if i["id"] == seeded["g1_rc"])
    assert row["due_date"] == _d(-2) and row["overdue"] is True
    upcoming = next(i for i in mine["items"] if i["id"] == seeded["b2_rc"])
    assert upcoming["due_date"] == _d(5) and upcoming["overdue"] is False
    scoped = client.get(f"{API}/my-work/run-cases", params={"project_id": p}).json()["data"]
    assert scoped["total"] == mine["total"] > 0
    none = client.get(
        f"{API}/my-work/run-cases", params={"project_id": seeded["other_project_id"]}
    ).json()["data"]
    assert none["total"] == 0


# --- project dashboard layouts ------------------------------------------------------------

DEFAULT_ORDER = [
    "kpi_strip",
    "test_status",
    "execution_trend",
    "defect_severity",
    "module_coverage",
    "requirement_traceability",
    "task_progress",
    "tester_performance",
    "tester_workload",
    "upcoming_milestones",
    "release_readiness",
    "my_pending",
    "overdue_cases",
    "recent_activity",
    "recent_defects",
]


def _layout(client: TestClient, p: str) -> dict:
    r = client.get(f"{API}/projects/{p}/dashboard")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _w(*keys: str, size: str = "M") -> dict:
    return {"widgets": [{"widget_type": k, "size": size} for k in keys]}


def test_builtin_layout_and_catalogue(client: TestClient, seeded: dict) -> None:
    got = _layout(client, seeded["project_id"])
    assert got["layout_source"] == "builtin"
    assert [w["widget_type"] for w in got["widgets"]] == DEFAULT_ORDER
    assert [c["widget_type"] for c in got["catalogue"]] == DEFAULT_ORDER
    assert got["can_set_default"] is True and got["has_project_default"] is False


def test_own_layout_round_trip_reset_and_validation(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    path = f"{API}/projects/{p}/dashboard"
    saved = client.put(path, json=_w("overdue_cases", "kpi_strip", size="S")).json()["data"]
    assert saved["layout_source"] == "user"
    assert [w["widget_type"] for w in saved["widgets"]] == ["overdue_cases", "kpi_strip"]
    assert {w["size"] for w in saved["widgets"]} == {"S"}
    # Replacing is atomic and an empty layout is a valid (everything hidden) choice.
    assert client.put(path, json={"widgets": []}).json()["data"]["widgets"] == []
    assert _layout(client, p)["layout_source"] == "user"
    reset = client.delete(path).json()["data"]
    assert reset["layout_source"] == "builtin" and len(reset["widgets"]) == len(DEFAULT_ORDER)
    for body in (
        _w("kpi_strip", "kpi_strip"),  # duplicate
        _w("nope"),  # unknown type
        {"widgets": [{"widget_type": "kpi_strip", "size": "XL"}]},
        {"widgets": [{"widget_type": "kpi_strip", "settings": {"a": 1}}]},
        {"widgets": [], "extra": 1},
    ):
        assert client.put(path, json=body).status_code == 422, body
    assert _layout(client, p)["layout_source"] == "builtin"  # nothing was stored


def test_project_default_precedence_permissions_and_audit(
    client: TestClient, seeded: dict, owner_engine
) -> None:
    p = seeded["project_id"]
    path = f"{API}/projects/{p}/dashboard"
    saved = client.put(f"{path}/default", json=_w("test_status", "kpi_strip")).json()["data"]
    assert saved["has_project_default"] is True and saved["layout_source"] == "project_default"
    assert [w["widget_type"] for w in saved["widgets"]] == ["test_status", "kpi_strip"]
    with owner_engine.begin() as conn:
        n = conn.execute(
            text("SELECT count(*) FROM audit_logs WHERE action = 'dashboard.project_default_set'")
        ).scalar_one()
    assert n == 1

    _as(client, seeded, "tester")  # a project member without project.edit
    mine = _layout(client, p)
    assert mine["layout_source"] == "project_default" and mine["can_set_default"] is False
    assert client.put(f"{path}/default", json=_w("kpi_strip")).status_code == 403
    assert client.delete(f"{path}/default").status_code == 403
    # Their own layout wins over the default, and resetting returns to the default.
    client.put(path, json=_w("my_pending"))
    assert [w["widget_type"] for w in _layout(client, p)["widgets"]] == ["my_pending"]
    back = client.delete(path).json()["data"]
    assert back["layout_source"] == "project_default"

    _as(client, seeded, "manager")  # tenant manager who is not assigned to the project
    assert _layout(client, p)["can_set_default"] is False
    assert client.put(f"{path}/default", json=_w("kpi_strip")).status_code == 403

    _as(client, seeded, "admin")
    assert (
        client.post(
            f"{API}/projects/{p}/members", json={"user_id": seeded["manager_id"]}
        ).status_code
        == 200
    )
    _as(client, seeded, "manager")
    assert _layout(client, p)["can_set_default"] is True
    assert client.put(f"{path}/default", json=_w("recent_defects")).status_code == 200

    _as(client, seeded, "admin")
    cleared = client.delete(f"{path}/default").json()["data"]
    assert cleared["layout_source"] == "builtin" and cleared["has_project_default"] is False
    with owner_engine.begin() as conn:
        n = conn.execute(
            text(
                "SELECT count(*) FROM audit_logs WHERE action = 'dashboard.project_default_cleared'"
            )
        ).scalar_one()
    assert n == 1


def test_layout_is_invisible_outside_the_project_scope(client: TestClient, seeded: dict) -> None:
    other = seeded["other_project_id"]
    _as(client, seeded, "tester")  # not a member of project Q
    path = f"{API}/projects/{other}/dashboard"
    assert client.get(path).status_code == 404
    assert client.put(path, json=_w("kpi_strip")).status_code == 404
    assert client.delete(path).status_code == 404
    assert client.put(f"{path}/default", json=_w("kpi_strip")).status_code == 403
    _as(client, seeded, "admin")
    assert client.get(f"{API}/projects/{uuid.uuid4()}/dashboard").status_code == 404


def test_org_dashboards_do_not_see_project_layouts(
    client: TestClient, seeded: dict, owner_engine
) -> None:
    p = seeded["project_id"]
    before = client.get(f"{API}/dashboards").json()["data"]
    client.put(f"{API}/projects/{p}/dashboard", json=_w("kpi_strip"))
    client.put(f"{API}/projects/{p}/dashboard/default", json=_w("kpi_strip"))
    assert client.get(f"{API}/dashboards").json()["data"] == before
    with owner_engine.begin() as conn:
        ids = [
            str(r[0])
            for r in conn.execute(
                text("SELECT id FROM dashboards WHERE project_id = :p"), {"p": p}
            ).all()
        ]
    assert len(ids) == 2
    for dashboard_id in ids:  # never reachable (or editable) through the org API
        assert client.get(f"{API}/dashboards/{dashboard_id}").status_code == 404
        assert client.delete(f"{API}/dashboards/{dashboard_id}").status_code == 404
        put = client.put(f"{API}/dashboards/{dashboard_id}/widgets", json={"widgets": []})
        assert put.status_code == 404
    # The per-user cap counts org dashboards only.
    for i in range(10):
        assert client.post(f"{API}/dashboards", json={"name": f"Org {i}"}).status_code == 200
