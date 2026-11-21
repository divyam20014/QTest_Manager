"""ADR-099: custom dashboards (CRUD, privacy, limits, widget validation, team default)."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.schemas.dashboards import MAX_DASHBOARDS_PER_USER, MAX_WIDGETS_PER_DASHBOARD
from tests.test_project_role_scoping import _create_project
from tests.test_tester_visibility import _as, _setup

B = "/api/v1/dashboards"


def _mk(client: TestClient, name: str = "Mine") -> str:
    r = client.post(B, json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


def _put(client: TestClient, did: str, widgets: list[dict]):
    return client.put(f"{B}/{did}/widgets", json={"widgets": widgets})


def _w(widget_type: str = "kpi_summary", size: str = "M", **settings) -> dict:
    return {"widget_type": widget_type, "size": size, "settings": settings}


@pytest.fixture
def env(client: TestClient, platform_admin: dict) -> dict:
    s = _setup(client, platform_admin, "Dash Co")
    hidden = _create_project(client, "Dash Hidden Project")
    s["hidden_project_id"] = hidden["id"]
    return s


def test_crud_and_order(client: TestClient, env: dict) -> None:
    did = _mk(client, "  Ops view  ")
    got = client.get(f"{B}/{did}").json()["data"]
    assert got["name"] == "Ops view" and got["widgets"] == [] and got["can_edit"] is True
    r = client.patch(f"{B}/{did}", json={"name": "Renamed"})
    assert r.json()["data"]["name"] == "Renamed"
    r = _put(
        client,
        did,
        [_w("kpi_summary", "L"), _w("execution_trend", "S", days=7), _w("defect_aging")],
    )
    assert r.status_code == 200, r.text
    widgets = r.json()["data"]["widgets"]
    assert [w["widget_type"] for w in widgets] == ["kpi_summary", "execution_trend", "defect_aging"]
    assert [w["position"] for w in widgets] == [0, 1, 2]
    assert widgets[1]["settings"] == {"days": 7} and widgets[0]["size"] == "L"
    # reorder
    r = _put(client, did, [_w("defect_aging"), _w("kpi_summary")])
    assert [w["widget_type"] for w in r.json()["data"]["widgets"]] == [
        "defect_aging",
        "kpi_summary",
    ]
    listed = client.get(B).json()["data"]
    assert [d["widget_count"] for d in listed] == [2]
    assert client.delete(f"{B}/{did}").status_code == 200
    assert client.get(f"{B}/{did}").status_code == 404
    assert client.get(B).json()["data"] == []


def test_name_validation(client: TestClient, env: dict) -> None:
    assert client.post(B, json={"name": ""}).status_code == 422
    assert client.post(B, json={"name": "x" * 61}).status_code == 422
    assert client.post(B, json={"name": "ok", "extra": 1}).status_code == 422


def test_other_users_dashboard_is_404(client: TestClient, env: dict) -> None:
    did = _mk(client)
    assert _put(client, did, [_w()]).status_code == 200
    _as(client, env, "tester")
    for call in (
        lambda: client.get(f"{B}/{did}"),
        lambda: client.patch(f"{B}/{did}", json={"name": "x"}),
        lambda: client.delete(f"{B}/{did}"),
        lambda: _put(client, did, []),
    ):
        assert call().status_code == 404
    assert client.get(B).json()["data"] == []
    _as(client, env, "admin")
    assert client.get(f"{B}/{did}").status_code == 200


def test_limits(client: TestClient, env: dict) -> None:
    for i in range(MAX_DASHBOARDS_PER_USER):
        _mk(client, f"D{i}")
    r = client.post(B, json={"name": "one too many"})
    assert r.status_code == 409
    did = client.get(B).json()["data"][0]["id"]
    assert _put(client, did, [_w()] * MAX_WIDGETS_PER_DASHBOARD).status_code == 200
    assert _put(client, did, [_w()] * (MAX_WIDGETS_PER_DASHBOARD + 1)).status_code == 422


def test_widget_settings_validation(client: TestClient, env: dict) -> None:
    did = _mk(client)
    pid = env["project_id"]
    bad = [
        _w("nope"),
        _w("kpi_summary", "XL"),
        _w("kpi_summary", foo=1),  # unknown key
        _w("execution_trend", days=45),
        _w("execution_trend", days="x"),
        _w("flaky_tests"),  # project required
        _w("flaky_tests", project_id=pid, top_n=0),
        _w("flaky_tests", project_id=pid, top_n=51),
        _w("release_readiness"),
        _w("saved_report"),
        _w("saved_report", report_id="not-a-uuid"),
        _w("kpi_summary", project_id="nope"),
        _w("kpi_summary", note="x" * 2000),  # too large and unknown
    ]
    for widget in bad:
        assert _put(client, did, [widget]).status_code == 422, widget
    assert client.get(f"{B}/{did}").json()["data"]["widgets"] == []
    ok = _put(
        client,
        did,
        [
            _w("flaky_tests", project_id=pid, top_n=5),
            _w("release_readiness", project_id=pid),
            _w("defect_leakage", project_id=pid),
        ],
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["widgets"][0]["settings"] == {"project_id": pid, "top_n": 5}


def test_unknown_project_and_report_rejected(client: TestClient, env: dict) -> None:
    did = _mk(client)
    assert _put(client, did, [_w("kpi_summary", project_id=str(uuid.uuid4()))]).status_code == 422
    assert _put(client, did, [_w("saved_report", report_id=str(uuid.uuid4()))]).status_code == 422


def test_invisible_project_rejected_and_flagged_at_render(client: TestClient, env: dict) -> None:
    _as(client, env, "tester")
    did = _mk(client, "Tess board")
    # tester is a member of project_id but not of the hidden project
    r = _put(client, did, [_w("kpi_summary", project_id=env["hidden_project_id"])])
    assert r.status_code == 422
    assert _put(client, did, [_w("kpi_summary", project_id=env["project_id"])]).status_code == 200
    w = client.get(f"{B}/{did}").json()["data"]["widgets"][0]
    assert w["project_access"] == "ok"
    # visibility changes: tester removed from the project -> flagged, not an error
    tester_id = client.get("/api/v1/auth/me").json()["data"]["user_id"]
    _as(client, env, "admin")
    r = client.delete(f"/api/v1/projects/{env['project_id']}/members/{tester_id}")
    assert r.status_code == 200, r.text
    _as(client, env, "tester")
    w = client.get(f"{B}/{did}").json()["data"]["widgets"][0]
    assert w["project_access"] == "denied"


def test_failed_put_is_atomic(client: TestClient, env: dict) -> None:
    did = _mk(client)
    assert _put(client, did, [_w("kpi_summary"), _w("defect_aging")]).status_code == 200
    r = _put(client, did, [_w("defect_leakage"), _w("flaky_tests")])  # second invalid
    assert r.status_code == 422
    kept = client.get(f"{B}/{did}").json()["data"]["widgets"]
    assert [w["widget_type"] for w in kept] == ["kpi_summary", "defect_aging"]


def test_team_default_rules(client: TestClient, env: dict) -> None:
    did = _mk(client, "Team board")
    assert _put(client, did, [_w("kpi_summary"), _w("defect_aging", "L")]).status_code == 200
    # non-admins cannot set it
    _as(client, env, "tester")
    mine = _mk(client, "Tess own")
    assert client.post(f"{B}/{mine}/team-default", json={"enabled": True}).status_code == 403
    _as(client, env, "manager")
    assert client.post(f"{B}/{mine}/team-default", json={"enabled": True}).status_code in (403, 404)
    _as(client, env, "admin")
    r = client.post(f"{B}/{did}/team-default", json={"enabled": True})
    assert r.status_code == 200, r.text
    td = r.json()["data"]
    assert td["is_team_default"] is True and td["id"] != did
    assert [w["widget_type"] for w in td["widgets"]] == ["kpi_summary", "defect_aging"]
    # a second set replaces (still exactly one)
    other = _mk(client, "Second board")
    td2 = client.post(f"{B}/{other}/team-default", json={"enabled": True}).json()["data"]
    assert client.get(f"{B}/{td['id']}").status_code == 404
    flagged = [d for d in client.get(B).json()["data"] if d["is_team_default"]]
    assert [d["id"] for d in flagged] == [td2["id"]]
    # tester sees it, can read it, cannot edit/delete it
    _as(client, env, "tester")
    listed = client.get(B).json()["data"]
    assert td2["id"] in [d["id"] for d in listed]
    got = client.get(f"{B}/{td2['id']}")
    assert got.status_code == 200 and got.json()["data"]["can_edit"] is False
    assert client.patch(f"{B}/{td2['id']}", json={"name": "x"}).status_code == 403
    assert client.delete(f"{B}/{td2['id']}").status_code == 403
    assert _put(client, td2["id"], []).status_code == 403
    assert client.post(f"{B}/{td2['id']}/team-default", json={"enabled": False}).status_code == 403
    # admin can edit and unset
    _as(client, env, "admin")
    assert client.patch(f"{B}/{td2['id']}", json={"name": "Renamed team"}).status_code == 200
    assert client.post(f"{B}/{td2['id']}/team-default", json={"enabled": False}).status_code == 200
    assert client.get(f"{B}/{td2['id']}").status_code == 404
    assert client.post(f"{B}/{did}/team-default", json={"enabled": False}).status_code == 409


def test_unique_team_default_index(client: TestClient, env: dict, owner_engine) -> None:
    did = _mk(client)
    client.post(f"{B}/{did}/team-default", json={"enabled": True})
    with owner_engine.connect() as conn:
        tenant_id = conn.execute(
            text("SELECT tenant_id FROM dashboards WHERE is_team_default")
        ).scalar_one()
        with pytest.raises(Exception, match="uq_dashboards_one_team_default"):
            conn.execute(
                text(
                    "INSERT INTO dashboards (tenant_id, name, is_team_default) "
                    "VALUES (:t, 'dup', true)"
                ),
                {"t": tenant_id},
            )


def test_cross_tenant_isolation(client: TestClient, platform_admin: dict, env: dict) -> None:
    did = _mk(client, "Tenant A board")
    client.post(f"{B}/{did}/team-default", json={"enabled": True})
    td = next(d for d in client.get(B).json()["data"] if d["is_team_default"])["id"]
    other = _setup(client, platform_admin, "Dash Other")
    assert other["tenant_id"] != env["tenant_id"]
    assert client.get(B).json()["data"] == []
    assert client.get(f"{B}/{did}").status_code == 404
    assert client.get(f"{B}/{td}").status_code == 404
    assert client.delete(f"{B}/{td}").status_code == 404


def test_audit_carries_name_only(client: TestClient, env: dict, owner_engine) -> None:
    did = _mk(client, "Audited board")
    td = client.post(f"{B}/{did}/team-default", json={"enabled": True}).json()["data"]["id"]
    client.delete(f"{B}/{did}")
    with owner_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT action, metadata FROM audit_logs WHERE action LIKE 'dashboard.%' "
                "ORDER BY created_at"
            )
        ).all()
    assert [r[0] for r in rows] == [
        "dashboard.created",
        "dashboard.team_default_set",
        "dashboard.deleted",
    ]
    assert all(r[1]["name"] == "Audited board" for r in rows)
    assert set(rows[0][1]) == {"name"} and set(rows[2][1]) == {"name"}
    assert td


def test_malformed_ids(client: TestClient, env: dict) -> None:
    for method, path in (
        ("GET", f"{B}/not-a-uuid"),
        ("PATCH", f"{B}/not-a-uuid"),
        ("DELETE", f"{B}/not-a-uuid"),
        ("PUT", f"{B}/not-a-uuid/widgets"),
        ("POST", f"{B}/not-a-uuid/team-default"),
    ):
        r = client.request(method, path, json={"name": "x", "widgets": [], "enabled": True})
        assert r.status_code == 422, (method, path, r.status_code)
