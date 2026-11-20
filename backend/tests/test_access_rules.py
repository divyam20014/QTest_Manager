"""RBAC Phase 4 (ADR-092): time and environment access rules.

Off by default; an active freeze window blocks matching mutations for
non-exempt roles with `blocked_by_access_rule`; Admin is exempt; reads are
never blocked. Windows use explicit timestamps relative to "now" (the server
clock is UTC), and the pure `evaluate` function is tested with an injected clock.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.core import access_rules
from tests.test_project_role_scoping import (
    _create_project,
    _create_user,
    _login_and_verify,
    _setup_tenant_with_tester,
)

ADMIN_PW = "AdminPassw0rd!"
USER_PW = "TesterPassw0rd!"


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _window(start_h: float, end_h: float) -> dict:
    now = datetime.now(UTC)
    return {
        "starts_at": _iso(now + timedelta(hours=start_h)),
        "ends_at": _iso(now + timedelta(hours=end_h)),
    }


def _freeze(client: TestClient, **overrides) -> dict:
    body = {
        "name": "Release 5.2 freeze",
        "rule_type": "freeze_window",
        "blocked_actions": ["testcase"],
        "exempt_roles": ["admin"],
        "reason": "Release 5.2 code freeze until Monday 09:00 UTC",
        **_window(-1, 1),
        **overrides,
    }
    resp = client.post("/api/v1/access-rules", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _case_body(title: str = "Verify total loss payout") -> dict:
    return {"title": title, "priority": "High", "steps": [{"action": "a", "expected": "b"}]}


def _setup(client: TestClient, platform_admin: dict, name: str) -> dict:
    tenant_id, project, tester_id = _setup_tenant_with_tester(client, platform_admin, name)
    slug = name.lower().replace(" ", "")
    manager_id = _create_user(
        client, f"manager@{slug}.example.com", "Mona Manager", "manager", USER_PW
    )
    assert (
        client.post(
            f"/api/v1/projects/{project['id']}/members", json={"user_id": manager_id}
        ).status_code
        == 200
    )
    return {
        "tenant_id": tenant_id,
        "project": project,
        "admin": f"admin@{slug}.example.com",
        "manager": f"manager@{slug}.example.com",
        "tester": f"tester@{slug}.example.com",
    }


def _as(client: TestClient, ctx: dict, who: str) -> None:
    _login_and_verify(client, ctx["tenant_id"], ctx[who], ADMIN_PW if who == "admin" else USER_PW)


def _create_case(client: TestClient, project_id: str):
    return client.post(f"/api/v1/projects/{project_id}/test-cases", json=_case_body())


def test_off_by_default_no_effect(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Default Off")
    _as(client, ctx, "manager")
    assert _create_case(client, ctx["project"]["id"]).status_code == 200
    assert client.get("/api/v1/access-rules/active").json()["data"] == []


def test_active_freeze_blocks_manager_and_tester_but_not_admin(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin, "Freeze Zone")
    pid = ctx["project"]["id"]
    _as(client, ctx, "admin")
    _freeze(client)

    for who in ("manager", "tester"):
        _as(client, ctx, who)
        resp = _create_case(client, pid)
        assert resp.status_code == 403, resp.text
        err = resp.json()["error"]
        assert err["code"] == "blocked_by_access_rule"
        assert err["message"] == "Release 5.2 code freeze until Monday 09:00 UTC"
        # read-only actions are never blocked
        assert client.get(f"/api/v1/projects/{pid}/test-cases").status_code == 200

    _as(client, ctx, "admin")
    assert _create_case(client, pid).status_code == 200


def test_blocked_only_for_matching_actions(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Action Match")
    _as(client, ctx, "admin")
    _freeze(client, blocked_actions=["testrun"])
    _as(client, ctx, "manager")
    # testcase.* is not in blocked_actions
    assert _create_case(client, ctx["project"]["id"]).status_code == 200


def test_window_before_and_after_does_not_block(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Window Edges")
    _as(client, ctx, "admin")
    _freeze(client, name="future", **_window(1, 2))
    _freeze(client, name="past", **_window(-2, -1))
    _as(client, ctx, "manager")
    assert _create_case(client, ctx["project"]["id"]).status_code == 200
    assert client.get("/api/v1/access-rules/active").json()["data"] == []


def test_project_scope_vs_tenant_scope(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Scope Test")
    _as(client, ctx, "admin")
    other = _create_project(client, "Scope Test Other")
    rule = _freeze(client, project_id=ctx["project"]["id"])
    _as(client, ctx, "manager")
    assert _create_case(client, ctx["project"]["id"]).status_code == 403
    assert _create_case(client, other["id"]).status_code == 200

    # resource-id-keyed route resolves its project too
    _as(client, ctx, "admin")
    case = _create_case(client, ctx["project"]["id"]).json()["data"]
    _as(client, ctx, "manager")
    resp = client.patch(f"/api/v1/test-cases/{case['id']}", json={"title": "Renamed case x"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "blocked_by_access_rule"

    _as(client, ctx, "admin")
    resp = client.patch(f"/api/v1/access-rules/{rule['id']}", json={"project_id": None})
    assert resp.status_code == 200
    _as(client, ctx, "manager")
    assert _create_case(client, other["id"]).status_code == 403  # now tenant-wide


def test_disabled_rule_ignored_and_toggle_restores_access(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin, "Toggle Zone")
    pid = ctx["project"]["id"]
    _as(client, ctx, "admin")
    rule = _freeze(client, enabled=False)
    _as(client, ctx, "manager")
    assert _create_case(client, pid).status_code == 200

    _as(client, ctx, "admin")
    assert (
        client.patch(f"/api/v1/access-rules/{rule['id']}", json={"enabled": True}).status_code
        == 200
    )
    _as(client, ctx, "manager")
    assert _create_case(client, pid).status_code == 403
    banners = client.get("/api/v1/access-rules/active").json()["data"]
    assert len(banners) == 1
    assert banners[0]["reason"].startswith("Release 5.2")
    assert "exempt_roles" not in banners[0] and "name" not in banners[0]

    _as(client, ctx, "admin")
    assert client.get("/api/v1/access-rules/active").json()["data"] == []
    client.patch(f"/api/v1/access-rules/{rule['id']}", json={"enabled": False})
    _as(client, ctx, "manager")
    assert _create_case(client, pid).status_code == 200


def test_exempt_role_manager_not_blocked(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Exempt Mgr")
    _as(client, ctx, "admin")
    _freeze(client, exempt_roles=["manager"])
    _as(client, ctx, "manager")
    assert _create_case(client, ctx["project"]["id"]).status_code == 200
    _as(client, ctx, "tester")
    assert _create_case(client, ctx["project"]["id"]).status_code == 403


def test_environment_restriction_on_defects(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Env Guard")
    pid = ctx["project"]["id"]
    _as(client, ctx, "admin")
    resp = client.post(
        "/api/v1/access-rules",
        json={
            "name": "Prod is locked",
            "rule_type": "environment_restriction",
            "environment": "Production",
            "blocked_actions": ["defect.create"],
            "reason": "Production defects are logged by the release manager only",
        },
    )
    assert resp.status_code == 200, resp.text

    def defect(environment: str):
        return client.post(
            "/api/v1/defects",
            json={
                "project_id": pid,
                "title": "Payout is wrong",
                "severity": "High",
                "environment": environment,
            },
        )

    _as(client, ctx, "tester")
    blocked = defect("production")  # case-insensitive
    assert blocked.status_code == 403, blocked.text
    assert blocked.json()["error"]["code"] == "blocked_by_access_rule"
    assert defect("Staging").status_code == 200
    _as(client, ctx, "admin")
    assert defect("Production").status_code == 200


def test_environment_restriction_allowed_window(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Env Window")
    _as(client, ctx, "admin")
    resp = client.post(
        "/api/v1/access-rules",
        json={
            "name": "Prod allowed now",
            "rule_type": "environment_restriction",
            "environment": "Production",
            "blocked_actions": ["defect.create"],
            "reason": "Production only during the release window",
            **_window(-1, 1),
        },
    )
    assert resp.status_code == 200, resp.text
    _as(client, ctx, "tester")
    resp = client.post(
        "/api/v1/defects",
        json={
            "project_id": ctx["project"]["id"],
            "title": "Payout is wrong",
            "severity": "High",
            "environment": "Production",
        },
    )
    assert resp.status_code == 200, resp.text  # inside the allowed window


def test_cross_tenant_isolation(client: TestClient, platform_admin: dict) -> None:
    a = _setup(client, platform_admin, "Tenant Alpha")
    _as(client, a, "admin")
    rule = _freeze(client)
    b = _setup(client, platform_admin, "Tenant Bravo")
    _as(client, b, "manager")
    assert _create_case(client, b["project"]["id"]).status_code == 200
    assert client.get("/api/v1/access-rules/active").json()["data"] == []
    _as(client, b, "admin")
    assert client.get(f"/api/v1/access-rules/{rule['id']}").status_code == 404
    assert client.delete(f"/api/v1/access-rules/{rule['id']}").status_code == 404
    assert client.get("/api/v1/access-rules").json()["data"] == []


def test_crud_requires_permission(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Perm Gate")
    _as(client, ctx, "admin")
    rule = _freeze(client, enabled=False)
    for who in ("manager", "tester"):
        _as(client, ctx, who)
        assert client.get("/api/v1/access-rules").status_code == 403
        assert client.get(f"/api/v1/access-rules/{rule['id']}").status_code == 403
        assert client.post("/api/v1/access-rules", json={}).status_code in (403, 422)
        assert client.patch(f"/api/v1/access-rules/{rule['id']}", json={}).status_code == 403
        assert client.delete(f"/api/v1/access-rules/{rule['id']}").status_code == 403
        assert (
            client.post(
                "/api/v1/access-rules/preview",
                json={"action_code": "testcase.edit", "role_code": "tester"},
            ).status_code
            == 403
        )
        assert client.get("/api/v1/access-rules/active").status_code == 200


def test_validation_rejections(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Validation Zone")
    _as(client, ctx, "admin")
    base = {
        "name": "x",
        "rule_type": "freeze_window",
        "reason": "because",
        "blocked_actions": ["testcase"],
        **_window(-1, 1),
    }

    def post(**kw):
        return client.post("/api/v1/access-rules", json={**base, **kw})

    assert post(blocked_actions=["nonsense.action"]).status_code == 422
    assert post(blocked_actions=[]).status_code == 422
    assert post(blocked_actions=["access_rule.manage"]).status_code == 422
    assert post(blocked_actions=["access_rule"]).status_code == 422
    assert post(blocked_actions=["test*"]).status_code == 422
    assert post(exempt_roles=["wizard"]).status_code == 422
    assert post(reason="").status_code == 422
    assert post(rule_type="bogus").status_code == 422
    assert post(starts_at=None, ends_at=None).status_code == 422
    swapped = _window(1, -1)
    assert post(**swapped).status_code == 422
    assert post(starts_at="2030-01-01T00:00:00", ends_at="2030-01-02T00:00:00").status_code == 422
    assert post(project_id=str(uuid.uuid4())).status_code == 404
    env_missing = post(rule_type="environment_restriction", starts_at=None, ends_at=None)
    assert env_missing.status_code == 422
    # Admin is always kept exempt even if omitted from the list
    ok = post(exempt_roles=["tester"])
    assert ok.status_code == 200
    assert "admin" in ok.json()["data"]["exempt_roles"]


def test_audit_events_without_pii(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Audit Zone")
    _as(client, ctx, "admin")
    rule = _freeze(client)
    rid = rule["id"]
    client.patch(f"/api/v1/access-rules/{rid}", json={"enabled": False})
    client.patch(f"/api/v1/access-rules/{rid}", json={"enabled": True})
    client.patch(f"/api/v1/access-rules/{rid}", json={"name": "Renamed freeze"})
    assert client.delete(f"/api/v1/access-rules/{rid}").status_code == 200

    logs = client.get(
        "/api/v1/audit-logs", params={"entity_type": "access_rule", "limit": 50}
    ).json()["data"]
    items = logs["items"] if isinstance(logs, dict) else logs
    actions = [entry["action"] for entry in items]
    for expected in (
        "access_rule.created",
        "access_rule.disabled",
        "access_rule.enabled",
        "access_rule.updated",
        "access_rule.deleted",
    ):
        assert expected in actions, actions
    blob = str(items)
    assert ctx["admin"] not in blob and "Release 5.2 code freeze" not in blob


def test_preview_and_malformed_ids(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin, "Preview Zone")
    _as(client, ctx, "admin")
    _freeze(client)
    hit = client.post(
        "/api/v1/access-rules/preview",
        json={"action_code": "testcase.edit", "role_code": "manager"},
    ).json()["data"]
    assert hit["blocked"] is True and hit["reason"].startswith("Release 5.2")
    miss = client.post(
        "/api/v1/access-rules/preview",
        json={"action_code": "testcase.edit", "role_code": "admin"},
    ).json()["data"]
    assert miss["blocked"] is False
    assert client.get("/api/v1/access-rules/not-a-uuid").status_code == 422
    assert client.patch("/api/v1/access-rules/not-a-uuid", json={}).status_code == 422


def test_admin_can_always_lift_rule_even_if_listed_blocked(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin, "No Lockout")
    _as(client, ctx, "admin")
    rule = _freeze(client, blocked_actions=["testcase", "testrun", "defect", "project"])
    assert client.delete(f"/api/v1/access-rules/{rule['id']}").status_code == 200


# --- pure evaluate(): injected clock, no database -------------------------


def _rule(**kw):
    now = datetime(2026, 12, 1, 12, 0, tzinfo=UTC)
    base = {
        "enabled": True,
        "rule_type": "freeze_window",
        "project_id": None,
        "environment": None,
        "starts_at": now - timedelta(hours=1),
        "ends_at": now + timedelta(hours=1),
        "blocked_actions": ["testrun"],
        "exempt_roles": ["admin"],
        "reason": "freeze",
    }
    return SimpleNamespace(**{**base, **kw})


NOW = datetime(2026, 12, 1, 12, 0, tzinfo=UTC)


def test_evaluate_window_boundaries_and_matching() -> None:
    r = _rule()
    kw = {"role_code": "manager"}
    assert access_rules.evaluate([r], action_code="testrun.create", now=NOW, **kw) is r
    assert access_rules.evaluate([r], action_code="testrun", now=NOW, **kw) is r
    assert access_rules.evaluate([r], action_code="testrunner.x", now=NOW, **kw) is None
    # start inclusive, end exclusive
    assert access_rules.evaluate([r], action_code="testrun.create", now=r.starts_at, **kw) is r
    assert access_rules.evaluate([r], action_code="testrun.create", now=r.ends_at, **kw) is None
    assert (
        access_rules.evaluate(
            [r], action_code="testrun.create", now=r.starts_at - timedelta(seconds=1), **kw
        )
        is None
    )
    assert (
        access_rules.evaluate([r], action_code="testrun.create", now=NOW, role_code="admin") is None
    )
    assert (
        access_rules.evaluate([_rule(enabled=False)], action_code="testrun.create", now=NOW, **kw)
        is None
    )
    assert access_rules.evaluate([r], action_code="access_rule.manage", now=NOW, **kw) is None


def test_evaluate_project_scope_and_environment() -> None:
    pid = uuid.uuid4()
    scoped = _rule(project_id=pid)
    kw = {"action_code": "testrun.create", "now": NOW, "role_code": "tester"}
    assert access_rules.evaluate([scoped], project_id=pid, **kw) is scoped
    assert access_rules.evaluate([scoped], project_id=uuid.uuid4(), **kw) is None
    assert access_rules.evaluate([scoped], project_id=None, **kw) is None

    env = _rule(
        rule_type="environment_restriction",
        environment="Production",
        starts_at=None,
        ends_at=None,
    )
    assert access_rules.evaluate([env], environment="production", **kw) is env
    assert access_rules.evaluate([env], environment="Staging", **kw) is None
    assert access_rules.evaluate([env], environment=None, **kw) is None
