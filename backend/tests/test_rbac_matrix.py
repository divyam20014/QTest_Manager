"""ADR-125: the permission matrix of the workspace features added in ADR-121..125.

One tenant per test, every role walked through the same operations against a table of expected
status codes (the table is the specification; a failure names the role and the operation).

Roles: admin; manager_assigned (member of project P); manager_free (not a member of P: a tenant
Manager without an assignment); tester (member of P); viewer (a custom role holding only
`report.view`, member of P: the read-only role).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_execution import _create_approved_case
from tests.test_project_role_scoping import _create_project
from tests.test_tester_visibility import USER_PW, _login_and_verify, _setup

API = "/api/v1"
ROLES = ("admin", "manager_assigned", "manager_free", "tester", "viewer")


@pytest.fixture
def mx(client: TestClient, platform_admin: dict) -> dict:
    """Admin session active. Project P has the tester as a member (from `_setup`); the viewer
    and one of two managers are added; project Q has nobody but the admin."""
    s = _setup(client, platform_admin, "Rbac Matrix")
    p = s["project_id"]
    slug = "rbacmatrix"
    role = client.post(
        f"{API}/roles", json={"name": "Read only", "permission_codes": ["report.view"]}
    ).json()["data"]
    emails = {
        "admin": s["admin_email"],
        "manager_assigned": s["manager_email"],
        "tester": s["tester_email"],
        "viewer": f"viewer@{slug}.example.com",
        "manager_free": f"manager2@{slug}.example.com",
    }
    ids = {}
    for who, body in (
        ("viewer", {"name": "View", "role_id": role["id"]}),
        ("manager_free", {"name": "Free", "role": "manager"}),
    ):
        r = client.post(f"{API}/users", json={"email": emails[who], "password": USER_PW, **body})
        assert r.status_code == 200, r.text
        ids[who] = r.json()["data"]["id"]
    with_ids = client.get(f"{API}/users").json()["data"]
    items = with_ids["items"] if isinstance(with_ids, dict) else with_ids
    for u in items:
        for who, email in emails.items():
            if u["email"] == email:
                ids[who] = u["id"]
    for who in ("viewer", "manager_assigned"):
        r = client.post(f"{API}/projects/{p}/members", json={"user_id": ids[who]})
        assert r.status_code == 200, r.text
    q = _create_project(client, "Rbac Matrix Q")
    s.update({"emails": emails, "ids": ids, "q": q["id"]})
    return s


def become(client: TestClient, mx: dict, who: str) -> None:
    pw = "AdminPassw0rd!" if who == "admin" else USER_PW
    _login_and_verify(client, mx["tenant_id"], mx["emails"][who], pw)


def _check(client: TestClient, mx: dict, expected: dict[str, int], call) -> None:
    for who in ROLES:
        become(client, mx, who)
        got = call(who)
        assert got.status_code == expected[who], (who, got.status_code, got.text)


def _w(*keys: str) -> dict:
    return {"widgets": [{"widget_type": k, "size": "M"} for k in keys]}


# --- tenant workspace settings ----------------------------------------------------------------


def test_workspace_settings_matrix(client: TestClient, mx: dict) -> None:
    url = f"{API}/settings/workspace"
    # Everybody signed in may read it (the shell needs it); only tenant.settings.manage replaces it.
    _check(client, mx, dict.fromkeys(ROLES, 200), lambda who: client.get(url))
    put = {"sidebar": {"hidden": ["reports"]}}
    _check(
        client,
        mx,
        {
            "admin": 200,
            "manager_assigned": 403,
            "manager_free": 403,
            "tester": 403,
            "viewer": 403,
        },
        lambda who: client.put(url, json=put),
    )
    become(client, mx, "tester")
    assert client.get(url).json()["data"]["sidebar"]["hidden"] == ["reports"]


# --- project tabs (nav_config) -------------------------------------------------------------------


def test_project_nav_config_matrix(client: TestClient, mx: dict) -> None:
    p = mx["project_id"]
    cfg = {"nav_config": {"order": ["overview"], "hidden": ["planning"]}}
    _check(
        client,
        mx,
        {
            "admin": 200,
            "manager_assigned": 200,
            "manager_free": 403,
            "tester": 403,
            "viewer": 403,
        },
        lambda who: client.patch(f"{API}/projects/{p}", json=cfg),
    )
    become(client, mx, "admin")
    assert client.get(f"{API}/projects/{p}").json()["data"]["nav_config"] == cfg["nav_config"]


# --- project dashboards: project default and personal layouts --------------------------------


def test_project_dashboard_default_matrix(client: TestClient, mx: dict) -> None:
    path = f"{API}/projects/{mx['project_id']}/dashboard"
    can = {"admin": 200, "manager_assigned": 200}
    denied = {w: 403 for w in ("manager_free", "tester", "viewer")}
    _check(
        client,
        mx,
        {**can, **denied},
        lambda who: client.put(f"{path}/default", json=_w("kpi_strip")),
    )
    _check(client, mx, {**can, **denied}, lambda who: client.delete(f"{path}/default"))


def test_personal_project_layout_matrix(client: TestClient, mx: dict) -> None:
    """Anybody who may see the project may arrange their own view of it; nobody else's layout
    changes. A Manager without an assignment still reads the project (tenant-wide Manager read)."""
    path = f"{API}/projects/{mx['project_id']}/dashboard"
    for who in ROLES:
        become(client, mx, who)
        put = client.put(path, json=_w("my_pending"))
        assert put.status_code == 200, (who, put.text)
        assert [w["widget_type"] for w in put.json()["data"]["widgets"]] == ["my_pending"], who
    # Each user's layout is their own: the tester's choice did not move the viewer's or admin's.
    become(client, mx, "admin")
    assert client.put(path, json=_w("kpi_strip")).status_code == 200
    become(client, mx, "tester")
    got = client.get(path).json()["data"]
    assert [w["widget_type"] for w in got["widgets"]] == ["my_pending"]
    assert got["can_set_default"] is False


def test_project_dashboard_is_scoped_to_the_project(client: TestClient, mx: dict) -> None:
    """Project Q: only people who can see it may open its dashboard layout or its aggregates."""
    q = mx["q"]
    path = f"{API}/projects/{q}/dashboard"
    expect = {
        "admin": 200,
        "manager_assigned": 200,
        "manager_free": 200,
        "tester": 404,
        "viewer": 404,
    }
    _check(client, mx, expect, lambda who: client.get(path))
    _check(client, mx, expect, lambda who: client.put(path, json=_w("kpi_strip")))
    status = {
        "admin": 200,
        "manager_assigned": 200,
        "manager_free": 200,
        "tester": 403,
        "viewer": 403,
    }
    _check(
        client,
        mx,
        status,
        lambda who: client.get(f"{API}/reports/project-test-status", params={"project_id": q}),
    )


def test_org_dashboards_never_expose_project_layouts(client: TestClient, mx: dict) -> None:
    p = mx["project_id"]
    assert (
        client.put(f"{API}/projects/{p}/dashboard/default", json=_w("kpi_strip")).status_code == 200
    )
    assert client.put(f"{API}/projects/{p}/dashboard", json=_w("kpi_strip")).status_code == 200
    for who in ROLES:
        become(client, mx, who)
        got = client.get(f"{API}/dashboards")
        assert got.status_code == 200, who
        assert got.json()["data"] == [] or all(
            d.get("project_id") is None for d in got.json()["data"]
        ), who


# --- saved views -------------------------------------------------------------------------------


def test_saved_views_are_private_to_every_role(client: TestClient, mx: dict) -> None:
    ids = {}
    for who in ROLES:
        become(client, mx, who)
        r = client.post(
            f"{API}/saved-views",
            json={"list_key": "defects", "name": f"View {who}", "filters": {"view": "board"}},
        )
        assert r.status_code == 200, (who, r.text)
        ids[who] = r.json()["data"]["id"]
    for who in ROLES:
        become(client, mx, who)
        mine = {
            v["id"]
            for v in client.get(f"{API}/saved-views", params={"list_key": "defects"}).json()["data"]
        }
        assert mine == {ids[who]}, who
        for other, vid in ids.items():
            if other != who:
                assert (
                    client.patch(f"{API}/saved-views/{vid}", json={"name": "x"}).status_code == 404
                ), (who, other)
                assert client.delete(f"{API}/saved-views/{vid}").status_code == 404, (who, other)


# --- board moves: defects ----------------------------------------------------------------------


def _defect(client: TestClient, mx: dict, status: str) -> str:
    become(client, mx, "admin")
    d = client.post(
        f"{API}/defects",
        json={"project_id": mx["project_id"], "title": "Board move defect", "severity": "High"},
    ).json()["data"]["id"]
    steps = ["Open", "Fixed", "Verified"]
    for step in steps[: steps.index(status) + 1]:
        r = client.patch(f"{API}/defects/{d}/status", json={"status": step})
        assert r.status_code == 200, r.text
    return d


def test_defect_board_move_to_an_open_status_matrix(client: TestClient, mx: dict) -> None:
    """Moving a card forward (New -> Open) needs a defect permission (change status, create, close):
    Admin, Manager and Tester may; the read-only role may not."""
    expect = {
        "admin": 200,
        "manager_assigned": 200,
        "manager_free": 200,
        "tester": 200,
        "viewer": 403,
    }
    for who in ROLES:
        d = _new_defect(client, mx)
        become(client, mx, who)
        r = client.patch(f"{API}/defects/{d}/status", json={"status": "Open"})
        assert r.status_code == expect[who], (who, r.status_code, r.text)


def _new_defect(client: TestClient, mx: dict) -> str:
    become(client, mx, "admin")
    r = client.post(
        f"{API}/defects",
        json={"project_id": mx["project_id"], "title": "Board move defect", "severity": "High"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


def test_defect_board_close_and_reopen_matrix(client: TestClient, mx: dict) -> None:
    """Closed and Reopened are Admin / Manager moves (defect.close); a Tester or the read-only
    role gets 403 whatever the card's current column is."""
    close = {
        "admin": 200,
        "manager_assigned": 200,
        "manager_free": 200,
        "tester": 403,
        "viewer": 403,
    }
    for who in ROLES:
        d = _defect(client, mx, "Verified")
        become(client, mx, who)
        r = client.patch(
            f"{API}/defects/{d}/status", json={"status": "Closed", "verification_confirmed": True}
        )
        assert r.status_code == close[who], ("close", who, r.status_code, r.text)
        if r.status_code == 200:  # and now reopen it
            r2 = client.patch(f"{API}/defects/{d}/status", json={"status": "Reopened"})
            assert r2.status_code == 200, ("reopen", who, r2.text)
    # Reopening a closed defect: same tier.
    for who in ROLES:
        d = _defect(client, mx, "Verified")
        become(client, mx, "admin")
        assert (
            client.patch(
                f"{API}/defects/{d}/status",
                json={"status": "Closed", "verification_confirmed": True},
            ).status_code
            == 200
        )
        become(client, mx, who)
        r = client.patch(f"{API}/defects/{d}/status", json={"status": "Reopened"})
        assert r.status_code == close[who], ("reopen", who, r.status_code, r.text)
        r = client.post(f"{API}/defects/{d}/reopen")
        assert r.status_code in (close[who], 409), ("reopen-endpoint", who, r.status_code, r.text)
        if close[who] == 403:
            assert r.status_code == 403, ("reopen-endpoint", who)


# --- board moves: test runs -----------------------------------------------------------------------


def test_run_finish_matrix(client: TestClient, mx: dict) -> None:
    """Finishing a run (the board's In progress -> Completed move) needs testrun.finish: Admin and
    Manager only. A Tester or the read-only role gets 403 and the run stays open."""
    expect = {
        "admin": 200,
        "manager_assigned": 200,
        "manager_free": 200,
        "tester": 403,
        "viewer": 403,
    }
    become(client, mx, "admin")
    for who in ROLES:
        case = _create_approved_case(client, mx["project_id"], f"Run case {who}")
        run = client.post(
            f"{API}/projects/{mx['project_id']}/test-runs",
            json={"name": f"Run {who}", "run_type": "Smoke", "test_case_ids": [case["id"]]},
        ).json()["data"]
        become(client, mx, who)
        r = client.post(f"{API}/test-runs/{run['id']}/finish")
        assert r.status_code == expect[who], (who, r.status_code, r.text)
        become(client, mx, "admin")
        finished = client.get(f"{API}/test-runs/{run['id']}").json()["data"]["finished_at"]
        assert (finished is not None) == (expect[who] == 200), who


# --- calendar -----------------------------------------------------------------------------------


def test_calendar_project_scope_matrix(client: TestClient, mx: dict) -> None:
    q = mx["q"]
    params = {"from": "2026-06-01", "to": "2026-06-30"}
    all_ok = dict.fromkeys(ROLES, 200)
    _check(client, mx, all_ok, lambda who: client.get(f"{API}/calendar", params=params))
    # A project the tester and the viewer do not belong to is refused, not silently empty.
    expect = {
        "admin": 200,
        "manager_assigned": 200,
        "manager_free": 200,
        "tester": 403,
        "viewer": 403,
    }
    _check(
        client,
        mx,
        expect,
        lambda who: client.get(f"{API}/calendar", params={**params, "project_id": q}),
    )
    client.cookies.clear()
    assert client.get(f"{API}/calendar", params=params).status_code == 401


def test_calendar_cases_follow_the_case_scope_for_every_role(
    client: TestClient, mx: dict, owner_engine
) -> None:
    """With the case scope on, only the Tester's due rows shrink; other roles keep theirs."""
    become(client, mx, "admin")
    case = _create_approved_case(client, mx["project_id"], "Due row case")
    run = client.post(
        f"{API}/projects/{mx['project_id']}/test-runs",
        json={"name": "Due run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    rc = run["cases"][0]["id"]
    assert (
        client.patch(
            f"{API}/test-run-cases/{rc}/assign",
            json={"assigned_to": mx["ids"]["admin"], "due_date": "2026-06-15"},
        ).status_code
        == 200
    )
    assert (
        client.patch(f"{API}/settings", json={"testers_see_assigned_cases_only": True}).status_code
        == 200
    )
    params = {"from": "2026-06-01", "to": "2026-06-30", "project_id": mx["project_id"]}
    seen = {}
    for who in ROLES:
        become(client, mx, who)
        r = client.get(f"{API}/calendar", params=params)
        assert r.status_code == 200, (who, r.text)
        seen[who] = len(r.json()["data"]["due"])
    assert seen["tester"] == 0, seen
    assert seen["admin"] >= 1 and seen["manager_assigned"] >= 1, seen


# --- tenant isolation of the new data -------------------------------------------------------------


def test_project_layouts_are_tenant_isolated(
    client: TestClient, platform_admin: dict, mx: dict, owner_engine
) -> None:
    p = mx["project_id"]
    become(client, mx, "admin")
    assert (
        client.put(f"{API}/projects/{p}/dashboard/default", json=_w("kpi_strip")).status_code == 200
    )
    other_client = TestClient(client.app)
    other = _setup(other_client, platform_admin, "Rbac Other Tenant")
    assert other_client.get(f"{API}/projects/{p}/dashboard").status_code == 404
    assert other_client.put(
        f"{API}/projects/{p}/dashboard/default", json=_w("kpi_strip")
    ).status_code in (403, 404)
    assert other_client.patch(f"{API}/projects/{p}", json={"nav_config": None}).status_code in (
        403,
        404,
    )
    with owner_engine.begin() as conn:
        n = conn.execute(
            text("SELECT count(*) FROM dashboards WHERE project_id = :p AND tenant_id = :t"),
            {"p": p, "t": other["tenant_id"]},
        ).scalar_one()
    assert n == 0
