"""ADR-124: the calendar endpoint and the view-mode saved views.

The calendar is checked against what the run, release and due-date writes put in, for a seeded
project with a second project beside it, a soft-deleted run, a finished run and a case-scoped
Tester. Saved views: the new list keys, the `view` mode key and the old views staying valid.
"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_execution import _setup_admin_project_and_case
from tests.test_project_dashboard import _case, _d, _rc, _run
from tests.test_project_role_scoping import _create_project
from tests.test_tester_visibility import _as, _set, _setup

API = "/api/v1"
TODAY = datetime.now(UTC).date()


def _cal(client: TestClient, frm: str, to: str, **params):
    return client.get(f"{API}/calendar", params={"from": frm, "to": to, **params})


@pytest.fixture
def seeded(client: TestClient, platform_admin: dict, owner_engine) -> dict:
    s = _setup(client, platform_admin, "Cal Five")
    p = s["project_id"]
    with owner_engine.begin() as conn:
        s["tester_id"] = str(
            conn.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": s["tester_email"]}
            ).scalar_one()
        )
    c1, c2, c3 = (_case(client, p, f"Cal case {i}") for i in (1, 2, 3))
    run_a = _run(client, p, "Cal run A", [c1, c2], due_date=_d(2))
    run_b = _run(client, p, "Cal run B", [c3])
    # c2 is due in 5 days, c1 was due 3 days ago (open, so overdue).
    for rc, due in ((_rc(run_a, c2), _d(5)), (_rc(run_a, c1), _d(-3))):
        ok = client.patch(f"{API}/test-run-cases/{rc}/assign", json={"due_date": due})
        assert ok.status_code == 200, ok.text
    done = _run(client, p, "Cal finished", [_case(client, p, "Cal case 4")], due_date=_d(1))
    assert client.post(f"{API}/test-runs/{done['id']}/finish").status_code == 200
    gone = _run(client, p, "Cal deleted", [_case(client, p, "Cal case 5")], due_date=_d(1))
    assert client.delete(f"{API}/test-runs/{gone['id']}").status_code == 200

    other = _create_project(client, "Cal Five Other")
    oc = _case(client, other["id"], "Other cal case")
    _run(client, other["id"], "Other cal run", [oc], due_date=_d(2))
    for name, offset in (("Cal release", 4), ("Far release", 90)):
        r = client.post(
            f"{API}/projects/{p}/releases", json={"name": name, "release_date": _d(offset)}
        )
        assert r.status_code == 200, r.text
    s.update({"run_a": run_a["id"], "run_b": run_b["id"], "other_project_id": other["id"]})
    return s


def test_calendar_runs_due_and_releases_for_a_range(client: TestClient, seeded: dict) -> None:
    p = seeded["project_id"]
    got = _cal(client, _d(-7), _d(14), project_id=p).json()["data"]
    names = {r["name"] for r in got["runs"]}
    assert {"Cal run A", "Cal run B"} <= names
    assert "Cal deleted" not in names and "Other cal run" not in names
    run_a = next(r for r in got["runs"] if r["name"] == "Cal run A")
    assert run_a["start_date"] == TODAY.isoformat() and run_a["status"] == "in_progress"
    # Grouped to one row per (day, run): A has a past day and a future day.
    a_rows = [d for d in got["due"] if d["run_id"] == seeded["run_a"]]
    assert {(d["due_date"], d["open_cases"], d["overdue"]) for d in a_rows} == {
        (_d(-3), 1, True),
        (_d(5), 1, False),
    }
    assert all(d["run_name"] != "Cal finished" for d in got["due"])
    assert [r["name"] for r in got["releases"]] == ["Cal release"]
    assert got["truncated"] is False


def test_calendar_outside_the_range_is_empty_and_all_projects_include_the_other(
    client: TestClient, seeded: dict
) -> None:
    empty = _cal(client, _d(200), _d(220)).json()["data"]
    assert empty["runs"] == [] and empty["due"] == [] and empty["releases"] == []
    everything = _cal(client, _d(-7), _d(14)).json()["data"]
    assert "Other cal run" in {r["name"] for r in everything["runs"]}
    scoped = _cal(client, _d(-7), _d(14), project_id=seeded["other_project_id"]).json()["data"]
    assert {r["name"] for r in scoped["runs"]} == {"Other cal run"}


def test_calendar_validates_the_range_and_the_project(client: TestClient, seeded: dict) -> None:
    assert _cal(client, _d(5), _d(1)).status_code == 422
    assert _cal(client, _d(0), _d(100)).status_code == 422
    assert _cal(client, "not-a-date", _d(1)).status_code == 422
    missing = "00000000-0000-0000-0000-000000000000"
    assert _cal(client, _d(0), _d(7), project_id=missing).status_code == 404


def test_run_list_filters_by_type_and_status_for_the_board(
    client: TestClient, seeded: dict
) -> None:
    p = seeded["project_id"]
    # The project's setup run ("Run One") is the only Smoke run; the rest are Regression runs.
    smoke = client.get(f"{API}/test-runs", params={"project_id": p, "run_type": "Smoke"}).json()
    assert [r["name"] for r in smoke["data"]["items"]] == ["Run One"]
    regression = client.get(
        f"{API}/test-runs",
        params={"project_id": p, "run_type": "Regression", "status": "in_progress", "page_size": 2},
    ).json()["data"]
    assert regression["total"] >= 2 and len(regression["items"]) == 2
    assert client.get(f"{API}/test-runs", params={"run_type": "Nope"}).status_code == 422


def test_calendar_requires_a_session(client: TestClient, seeded: dict) -> None:
    client.cookies.clear()
    assert _cal(client, _d(0), _d(7)).status_code == 401


def test_calendar_tester_scope_projects_and_cases(client: TestClient, seeded: dict) -> None:
    p, other = seeded["project_id"], seeded["other_project_id"]
    _as(client, seeded, "tester")
    got = _cal(client, _d(-7), _d(14)).json()["data"]
    names = {r["name"] for r in got["runs"]}
    assert "Other cal run" not in names and "Cal run A" in names
    assert _cal(client, _d(-7), _d(14), project_id=other).status_code == 403
    assert _cal(client, _d(-7), _d(14), project_id=p).status_code == 200
    # Case scope: only cases the tester is assigned to count toward the due rows.
    _as(client, seeded, "admin")
    assert _set(client, testers_see_assigned_cases_only=True).status_code == 200
    _as(client, seeded, "tester")
    scoped = _cal(client, _d(-7), _d(14), project_id=p).json()["data"]
    assert scoped["due"] == []


# --- saved views: new list keys and the view mode -------------------------------------------

UUID_1 = "00000000-0000-0000-0000-000000000001"


def _view(client: TestClient, list_key: str, name: str, filters: dict):
    return client.post(
        f"{API}/saved-views", json={"list_key": list_key, "name": name, "filters": filters}
    )


@pytest.mark.parametrize(
    "list_key,filters",
    [
        ("defects", {"view": "board", "moduleId": UUID_1}),
        ("test_cases", {"view": "board", "executedBy": UUID_1}),
        ("test_runs", {"view": "calendar", "overdue": "true"}),
        ("requirements", {"view": "list", "search": "login"}),
        ("projects", {"view": "list", "status": "Active"}),
    ],
)
def test_saved_view_carries_the_view_mode(
    client: TestClient, platform_admin: dict, list_key: str, filters: dict
) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    r = _view(client, list_key, "Mode", filters)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["filters"] == filters
    listed = client.get(f"{API}/saved-views", params={"list_key": list_key}).json()["data"]
    assert len(listed) == 1


def test_saved_view_rejects_a_bad_mode_and_old_views_still_validate(
    client: TestClient, platform_admin: dict
) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    assert _view(client, "defects", "Bad", {"view": "gantt"}).status_code == 422
    assert _view(client, "requirements", "Bad", {"status": "x"}).status_code == 422
    assert _view(client, "test_runs", "Bad", {"overdue": "maybe"}).status_code == 422
    # A view saved before ADR-124 (no `view` key) is unchanged and can gain a mode.
    old = _view(client, "defects", "Old", {"severity": "High"}).json()["data"]
    assert "view" not in old["filters"]
    upd = client.patch(f"{API}/saved-views/{old['id']}", json={"filters": {"view": "board"}})
    assert upd.status_code == 200, upd.text
