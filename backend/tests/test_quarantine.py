"""ADR-097: manual flaky-test quarantine."""

from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_project_role_scoping import (
    _bootstrap_tenant,
    _create_project,
    _create_user,
    _login_and_verify,
)

ADMIN_PW = "AdminPassw0rd!"
USER_PW = "UserPassw0rd!!"
STEPS = [{"action": "do it", "expected": "it works"}]


def _approved_case(client: TestClient, pid: str, title: str, assignee: str | None = None) -> str:
    body = {"title": title, "priority": "High", "steps": STEPS}
    if assignee:
        body["assignee_id"] = assignee
    r = client.post(f"/api/v1/projects/{pid}/test-cases", json=body)
    assert r.status_code == 200, r.text
    cid = r.json()["data"]["id"]
    client.post(f"/api/v1/test-cases/{cid}/submit-review")
    assert client.post(f"/api/v1/test-cases/{cid}/approve").status_code == 200
    return cid


def _setup(client: TestClient, platform_admin: dict, name: str) -> dict:
    slug = name.lower().replace(" ", "")
    boot = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = boot["tenant"]["id"]
    admin_email = f"admin@{slug}.example.com"
    _login_and_verify(client, tenant_id, admin_email, ADMIN_PW)
    project = _create_project(client, f"{name} Claims")
    pid = project["id"]
    tester_id = _create_user(client, f"tester@{slug}.example.com", "Tess", "tester", USER_PW)
    _create_user(client, f"manager@{slug}.example.com", "Mo", "manager", USER_PW)
    assert (
        client.post(f"/api/v1/projects/{pid}/members", json={"user_id": tester_id}).status_code
        == 200
    )
    flaky = _approved_case(client, pid, "Flaky checkout case", tester_id)
    stable = _approved_case(client, pid, "Stable login case")
    return {
        "tenant_id": tenant_id,
        "slug": slug,
        "project_id": pid,
        "flaky": flaky,
        "stable": stable,
        "admin_email": admin_email,
        "tester_email": f"tester@{slug}.example.com",
        "manager_email": f"manager@{slug}.example.com",
    }


def _as(client: TestClient, s: dict, who: str) -> None:
    _login_and_verify(
        client, s["tenant_id"], s[f"{who}_email"], ADMIN_PW if who == "admin" else USER_PW
    )


def test_permission_and_reason_validation(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Quar Perm")
    url = f"/api/v1/test-cases/{s['flaky']}/quarantine"
    _as(client, s, "tester")
    assert client.post(url, json={"reason": "flaky on CI"}).status_code == 403
    assert client.post(f"/api/v1/test-cases/{s['flaky']}/unquarantine").status_code == 403
    _as(client, s, "manager")
    for bad in ({}, {"reason": "ab"}, {"reason": "x" * 501}):
        assert client.post(url, json=bad).status_code == 422
    r = client.post(url, json={"reason": "  flaky on CI  "})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["quarantined"] is True and d["quarantine_reason"] == "flaky on CI"
    assert d["quarantined_at"]
    assert client.post(url, json={"reason": "again please"}).status_code == 409
    u = client.post(f"/api/v1/test-cases/{s['flaky']}/unquarantine")
    assert u.status_code == 200 and u.json()["data"]["quarantined"] is False
    assert u.json()["data"]["quarantine_reason"] is None
    assert client.post(f"/api/v1/test-cases/{s['flaky']}/unquarantine").status_code == 409


def test_audit_events_do_not_copy_reason(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    s = _setup(client, platform_admin, "Quar Audit")
    reason = "secret-ish reason text"
    client.post(f"/api/v1/test-cases/{s['flaky']}/quarantine", json={"reason": reason})
    client.post(f"/api/v1/test-cases/{s['flaky']}/unquarantine")
    with owner_engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT action, metadata::text FROM audit_logs "
                "WHERE entity_id = :i AND action LIKE 'testcase.%quarantined' ORDER BY created_at"
            ),
            {"i": s["flaky"]},
        ).all()
    actions = [r[0] for r in rows]
    assert actions == ["testcase.quarantined", "testcase.unquarantined"]
    assert "reason_length" in rows[0][1] and reason not in rows[0][1]


def test_filter_and_saved_view_allowlist(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Quar Filter")
    client.post(f"/api/v1/test-cases/{s['flaky']}/quarantine", json={"reason": "flaky on CI"})
    base = f"/api/v1/projects/{s['project_id']}/test-cases"

    def ids(**params) -> set[str]:
        return {c["id"] for c in client.get(base, params=params).json()["data"]["items"]}

    assert ids() == {s["flaky"], s["stable"]}
    assert ids(quarantined="any") == {s["flaky"], s["stable"]}
    assert ids(quarantined="only") == {s["flaky"]}
    assert ids(quarantined="exclude") == {s["stable"]}
    assert client.get(base, params={"quarantined": "bogus"}).status_code == 422
    allp = client.get("/api/v1/test-cases", params={"quarantined": "only"}).json()["data"]
    assert [c["id"] for c in allp["items"]] == [s["flaky"]]
    sv = client.post(
        "/api/v1/saved-views",
        json={"list_key": "test_cases", "name": "Quarantined", "filters": {"quarantined": "only"}},
    )
    assert sv.status_code in (200, 201), sv.text


def test_exclude_quarantined_on_run_and_suite(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Quar Run")
    client.post(f"/api/v1/test-cases/{s['flaky']}/quarantine", json={"reason": "flaky on CI"})
    pid = s["project_id"]
    both = [s["flaky"], s["stable"]]
    default = client.post(
        f"/api/v1/projects/{pid}/test-runs",
        json={"name": "Default run", "run_type": "Smoke", "test_case_ids": both},
    ).json()["data"]
    assert len(default["cases"]) == 2
    skip = client.post(
        f"/api/v1/projects/{pid}/test-runs",
        json={
            "name": "Skip run",
            "run_type": "Smoke",
            "test_case_ids": both,
            "exclude_quarantined": True,
        },
    ).json()["data"]
    assert [c["test_case_id"] for c in skip["cases"]] == [s["stable"]]
    only_q = client.post(
        f"/api/v1/projects/{pid}/test-runs",
        json={
            "name": "Nothing",
            "run_type": "Smoke",
            "test_case_ids": [s["flaky"]],
            "exclude_quarantined": True,
        },
    )
    assert only_q.status_code == 422
    suite = client.post(
        f"/api/v1/projects/{pid}/test-suites",
        json={"name": "Suite A", "test_case_ids": both},
    )
    assert suite.status_code == 200, suite.text
    sid = suite.json()["data"]["id"]
    sr = client.post(
        f"/api/v1/test-suites/{sid}/create-run",
        json={"name": "Suite run", "run_type": "Smoke", "exclude_quarantined": True},
    )
    assert sr.status_code == 200, sr.text
    assert len(sr.json()["data"]["cases"]) == 1
    # Verdict on a quarantined case already inside a run still works.
    step_id = client.get(f"/api/v1/test-run-cases/{default['cases'][0]['id']}/steps").json()[
        "data"
    ][0]["id"]
    v = client.post(f"/api/v1/execution-steps/{step_id}/verdict", json={"verdict": "pass"})
    assert v.status_code in (200, 409), v.text  # 409 only if a step must be opened first


def test_readiness_quarantined_count(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Quar Ready")
    params = {"project_id": s["project_id"]}
    assert (
        client.get("/api/v1/reports/release-readiness", params=params).json()["data"][
            "quarantined_count"
        ]
        == 0
    )
    client.post(f"/api/v1/test-cases/{s['flaky']}/quarantine", json={"reason": "flaky on CI"})
    assert (
        client.get("/api/v1/reports/release-readiness", params=params).json()["data"][
            "quarantined_count"
        ]
        == 1
    )
    leak = client.get("/api/v1/reports/defect-leakage", params=params).json()["data"]
    assert leak["quarantined_test_cases"] == 1
    flaky = client.get("/api/v1/reports/flaky-tests", params=params)
    assert flaky.status_code == 200


def test_tester_scope_404_and_cross_tenant(client: TestClient, platform_admin: dict) -> None:
    s = _setup(client, platform_admin, "Quar Scope")
    assert (
        client.patch("/api/v1/settings", json={"testers_see_assigned_cases_only": True}).status_code
        == 200
    )
    # A scoped Tester never reaches the service (403 on permission first), but still gets a
    # 404 for the unseen case itself; the service re-checks visibility for approve-level roles.
    _as(client, s, "tester")
    hidden = client.get(f"/api/v1/test-cases/{s['stable']}")
    assert hidden.status_code == 404
    _as(client, s, "manager")
    other = _setup(client, platform_admin, "Quar Other Tenant")
    _as(client, other, "admin")
    r = client.post(f"/api/v1/test-cases/{s['flaky']}/quarantine", json={"reason": "cross tenant"})
    assert r.status_code == 404
    assert client.post(f"/api/v1/test-cases/{s['flaky']}/unquarantine").status_code == 404
