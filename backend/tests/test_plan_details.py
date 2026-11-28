"""ADR-153 (Phase 4B): test plan owner, dates, status and exit criteria."""

import pytest
from fastapi.testclient import TestClient

from tests.test_task_planning import (
    API,
    _bootstrap_tenant,
    _create_project,
    _login_and_verify,
    _ok,
    _sign_in,
)


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return {
        "tenant_id": tenant_id,
        "project": _create_project(client)["id"],
        "other": _create_project(client, "Other project")["id"],
    }


def _plan(client: TestClient, project: str, **extra):
    return client.post(
        f"{API}/projects/{project}/test-plans", json={"name": "Release plan", **extra}
    )


def _patch(client: TestClient, plan: dict, **changes):
    return client.patch(f"{API}/test-plans/{plan['id']}", json=changes)


def _member(client: TestClient, world: dict) -> dict:
    me = _ok(client.get(f"{API}/auth/me"))
    _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": me["user_id"]}))
    return me


def test_a_plan_has_defaults_and_keeps_its_details(client: TestClient, world: dict) -> None:
    plain = _ok(_plan(client, world["project"]))
    assert (plain["status"], plain["owner_id"], plain["start_date"], plain["exit_criteria"]) == (
        "draft",
        None,
        None,
        None,
    )
    me = _member(client, world)

    detailed = _ok(
        _plan(
            client,
            world["project"],
            name="Detailed plan",
            owner_id=me["user_id"],
            start_date="2026-12-01",
            end_date="2026-12-15",
            status="active",
            exit_criteria="No open critical defects.\nAll smoke tests pass.",
        )
    )

    assert detailed["owner_name"] and detailed["status"] == "active"
    listed = {
        p["name"]: p for p in _ok(client.get(f"{API}/projects/{world['project']}/test-plans"))
    }
    assert listed["Detailed plan"]["exit_criteria"].startswith("No open critical")
    assert listed["Detailed plan"]["end_date"] == "2026-12-15"


def test_details_are_changed_and_cleared(client: TestClient, world: dict) -> None:
    plan = _ok(_plan(client, world["project"], exit_criteria="Old", start_date="2026-12-01"))
    me = _member(client, world)

    changed = _ok(
        _patch(client, plan, owner_id=me["user_id"], status="complete", exit_criteria="New")
    )
    assert (changed["status"], changed["exit_criteria"]) == ("complete", "New")
    # Fields not sent are kept; null clears.
    cleared = _ok(_patch(client, plan, owner_id=None, start_date=None, exit_criteria=None))
    assert (cleared["owner_id"], cleared["start_date"], cleared["exit_criteria"]) == (
        None,
        None,
        None,
    )
    assert cleared["status"] == "complete"


def test_wrong_details_are_refused(client: TestClient, world: dict) -> None:
    outsider = _sign_in(client, {**world, "project": world["other"]}, "out", "tester")
    outsider_id = _ok(outsider.get(f"{API}/auth/me"))["user_id"]
    plan = _ok(_plan(client, world["project"], start_date="2026-12-10"))

    backwards = _plan(client, world["project"], start_date="2026-12-10", end_date="2026-12-01")
    assert backwards.status_code == 422 and "end_date" in backwards.json()["error"]["fields"]
    assert _patch(client, plan, end_date="2026-12-01").status_code == 422
    not_a_member = _patch(client, plan, owner_id=outsider_id)
    assert not_a_member.status_code == 422
    assert "owner_id" in not_a_member.json()["error"]["fields"]
    assert _patch(client, plan, status="done").status_code == 422
    assert _patch(client, plan, status=None).status_code == 422
    assert _ok(client.get(f"{API}/projects/{world['project']}/test-plans"))[0]["end_date"] is None


def test_an_archived_project_keeps_its_plans_as_they_are(client: TestClient, world: dict) -> None:
    plan = _ok(_plan(client, world["project"]))
    _ok(client.post(f"{API}/projects/{world['project']}/archive"))

    assert _patch(client, plan, status="active").status_code == 409
