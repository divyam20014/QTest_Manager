"""ADR-093: per-tenant Tester visibility switches (both OFF by default)."""

from fastapi.testclient import TestClient

from tests.test_project_role_scoping import (
    _bootstrap_tenant,
    _create_project,
    _create_user,
    _login_and_verify,
)

ADMIN_PW = "AdminPassw0rd!"
USER_PW = "UserPassw0rd!!"
STEPS = [{"action": "do it", "expected": "it works"}]


def _setup(client: TestClient, platform_admin: dict, name: str) -> dict:
    """Admin session left active. Returns ids/emails; cases: mine (assigned),
    other (unassigned), run (in a run assigned to the tester)."""
    slug = name.lower().replace(" ", "")
    boot = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = boot["tenant"]["id"]
    admin_email = f"admin@{slug}.example.com"
    _login_and_verify(client, tenant_id, admin_email, ADMIN_PW)
    project = _create_project(client, f"{name} Claims")
    tester_id = _create_user(client, f"tester@{slug}.example.com", "Tess", "tester", USER_PW)
    _create_user(client, f"manager@{slug}.example.com", "Mo", "manager", USER_PW)
    r = client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    assert r.status_code == 200, r.text

    def mk(title: str, assignee: str | None = None) -> str:
        body = {"title": title, "priority": "High", "steps": STEPS}
        if assignee:
            body["assignee_id"] = assignee
        resp = client.post(f"/api/v1/projects/{project['id']}/test-cases", json=body)
        assert resp.status_code == 200, resp.text
        return resp.json()["data"]["id"]

    mine = mk("Zebra assigned case", tester_id)
    other = mk("Zebra hidden case")
    run_case = mk("Zebra via run case")
    client.post(f"/api/v1/test-cases/{run_case}/submit-review")
    ap = client.post(f"/api/v1/test-cases/{run_case}/approve")
    assert ap.status_code == 200, ap.text
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Run One", "run_type": "Smoke", "test_case_ids": [run_case]},
    ).json()["data"]
    rc_id = run["cases"][0]["id"]
    a = client.patch(f"/api/v1/test-run-cases/{rc_id}/assign", json={"assigned_to": tester_id})
    assert a.status_code == 200, a.text
    return {
        "tenant_id": tenant_id,
        "admin_email": admin_email,
        "tester_email": f"tester@{slug}.example.com",
        "manager_email": f"manager@{slug}.example.com",
        "project_id": project["id"],
        "mine": mine,
        "other": other,
        "run_case": run_case,
    }


def _as(client: TestClient, s: dict, who: str) -> None:
    pw = ADMIN_PW if who == "admin" else USER_PW
    _login_and_verify(client, s["tenant_id"], s[f"{who}_email"], pw)


def _set(client: TestClient, **flags: bool):
    return client.patch("/api/v1/settings", json=flags)


def test_default_off_changes_nothing(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Vis Default")
    got = client.get("/api/v1/settings").json()["data"]
    assert got["testers_see_assigned_cases_only"] is False
    assert got["reports_hidden_from_testers"] is False
    _as(client, s, "tester")
    listed = client.get(f"/api/v1/projects/{s['project_id']}/test-cases").json()["data"]
    assert listed["total"] == 3
    assert client.get(f"/api/v1/test-cases/{s['other']}").status_code == 200
    assert (
        client.get("/api/v1/reports/aggregate?metric=priority&group_by=project").status_code == 200
    )
    me = client.get("/api/v1/auth/me").json()["data"]
    assert me["reports_hidden"] is False and me["tester_case_scope"] is False


def test_case_scope_filters_everywhere(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Vis Scope")
    assert _set(client, testers_see_assigned_cases_only=True).status_code == 200
    _as(client, s, "tester")
    me = client.get("/api/v1/auth/me").json()["data"]
    assert me["tester_case_scope"] is True

    listed = client.get(f"/api/v1/projects/{s['project_id']}/test-cases").json()["data"]
    ids = {c["id"] for c in listed["items"]}
    assert ids == {s["mine"], s["run_case"]} and listed["total"] == 2
    page = client.get(f"/api/v1/projects/{s['project_id']}/test-cases?page_size=1").json()["data"]
    assert page["total"] == 2 and len(page["items"]) == 1
    wide = client.get("/api/v1/test-cases").json()["data"]
    assert {c["id"] for c in wide["items"]} == ids and wide["total"] == 2

    assert client.get(f"/api/v1/test-cases/{s['mine']}").status_code == 200
    assert client.get(f"/api/v1/test-cases/{s['run_case']}").status_code == 200
    for path in ("", "/history", "/versions"):
        assert client.get(f"/api/v1/test-cases/{s['other']}{path}").status_code == 404, path

    found = client.get("/api/v1/search", params={"q": "Zebra"}).json()["data"]
    titles = {r["title"] for r in found["results"] if r["type"] == "test_case"}
    assert "Zebra hidden case" not in titles and len(titles) == 2

    csv_text = client.get(f"/api/v1/projects/{s['project_id']}/test-cases/export.csv").text
    assert "Zebra assigned case" in csv_text and "Zebra hidden case" not in csv_text

    summary = client.get("/api/v1/dashboard/summary")
    assert summary.status_code == 200
    assert summary.json()["data"]["test_cases"]["total"] == 2

    modules = client.get(f"/api/v1/projects/{s['project_id']}/modules")
    assert modules.status_code == 200

    # Manager and Admin are unaffected.
    for who in ("manager", "admin"):
        _as(client, s, who)
        assert (
            client.get(f"/api/v1/projects/{s['project_id']}/test-cases").json()["data"]["total"]
            == 3
        )
        assert client.get(f"/api/v1/test-cases/{s['other']}").status_code == 200

    # Cases are visible again the moment the switch is turned off.
    _as(client, s, "admin")
    assert _set(client, testers_see_assigned_cases_only=False).status_code == 200
    _as(client, s, "tester")
    assert client.get(f"/api/v1/test-cases/{s['other']}").status_code == 200


def test_reports_hidden_from_testers(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Vis Reports")
    assert _set(client, reports_hidden_from_testers=True).status_code == 200
    _as(client, s, "tester")
    assert client.get("/api/v1/auth/me").json()["data"]["reports_hidden"] is True
    for path in (
        "/api/v1/reports/aggregate?metric=priority&group_by=project",
        "/api/v1/reports/execution-trend",
        "/api/v1/reports/defect-trend",
        "/api/v1/reports/workload",
        "/api/v1/reports/compliance-export",
    ):
        assert client.get(path).status_code == 403, path
    # The Dashboard keeps rendering.
    assert client.get("/api/v1/dashboard/summary").status_code == 200
    assert client.get("/api/v1/dashboard/activity-stream").status_code == 200

    _as(client, s, "manager")
    ok = client.get("/api/v1/reports/aggregate?metric=priority&group_by=project")
    assert ok.status_code == 200


def test_setting_needs_admin_and_is_audited(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Vis Audit")
    _as(client, s, "manager")
    assert _set(client, reports_hidden_from_testers=True).status_code == 403
    _as(client, s, "tester")
    assert _set(client, reports_hidden_from_testers=True).status_code == 403
    _as(client, s, "admin")
    assert _set(client, reports_hidden_from_testers=True).status_code == 200
    assert _set(client, reports_hidden_from_testers=True).status_code == 200  # no-op, no event
    logs = client.get("/api/v1/audit-logs", params={"action": "tenant.setting_changed"}).json()[
        "data"
    ]
    items = logs["items"] if isinstance(logs, dict) else logs
    assert len(items) == 1
    assert items[0]["metadata"] == {"key": "reports_hidden_from_testers", "value": True}


def test_cross_tenant_isolation(client: TestClient, platform_admin: dict) -> None:
    a = _setup(client, platform_admin, "Vis Alpha")
    assert _set(client, testers_see_assigned_cases_only=True).status_code == 200
    b = _setup(client, platform_admin, "Vis Beta")
    _as(client, b, "tester")  # tenant B never enabled the switch
    assert client.get("/api/v1/auth/me").json()["data"]["tester_case_scope"] is False
    assert client.get(f"/api/v1/test-cases/{b['other']}").status_code == 200
    _as(client, a, "tester")
    assert client.get(f"/api/v1/test-cases/{b['other']}").status_code == 404


def test_every_test_case_read_route_is_known() -> None:
    """Guard: a NEW GET route exposing test cases must be added here AFTER it
    has been wired through app.services.tester_visibility (ADR-093)."""
    from app.main import app

    known = {
        "/api/v1/test-cases",
        "/api/v1/projects/{project_id}/test-cases",
        "/api/v1/test-cases/{test_case_id}",
        "/api/v1/test-cases/{test_case_id}/history",
        "/api/v1/test-cases/{test_case_id}/versions",
        "/api/v1/test-cases/{test_case_id}/versions/compare",
        # scoped through test_case_service.get_test_case (tester visibility)
        "/api/v1/test-cases/{test_case_id}/requirements",
        "/api/v1/projects/{project_id}/test-cases/export.csv",
        "/api/v1/projects/{project_id}/test-cases/export.xlsx",
        # scoped through owner_access.authorize_owner_access -> get_test_case
        "/api/v1/test-cases/{test_case_id}/attachments",
        "/api/v1/test-cases/{test_case_id}/comments",
        # scoped in test_data_set_service.list_data_sets
        "/api/v1/test-cases/{test_case_id}/data-sets",
        # scoped through test_case_service._authorize_case_access (ADR-116)
        "/api/v1/test-cases/{test_case_id}/executions",
        # scoped through test_case_service.get_test_case (ADR-118)
        "/api/v1/test-cases/{test_case_id}/defects",
        # no case data
        "/api/v1/test-cases/columns",
        "/api/v1/test-cases/import/jobs/{job_id}",
        "/api/v1/test-cases/import/template.csv",
        # ADR-120: import templates and the caller's own import preview / job (no case data)
        "/api/v1/test-cases/import-template.csv",
        "/api/v1/test-cases/import-template.xlsx",
        "/api/v1/test-cases/import/preview/{token}/rows",
        "/api/v1/test-cases/import/status/{job_id}",
    }
    found = {
        r.path
        for r in app.routes
        if hasattr(r, "methods")
        and "GET" in r.methods
        and ("/test-cases" in r.path)
        and "test-data" not in r.path
        and not r.path.startswith("/api/v1/test-case-")
    }
    extra = {
        p
        for p in found - known
        if p.rstrip("/").split("/")[-1] != "test-cases" or "{" in p.split("test-cases")[0][-1:]
    }
    assert not extra, f"Unreviewed test-case read routes (scope via tester_visibility): {extra}"
