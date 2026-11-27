"""ADR-141 (Phase 1C): teams, and adding a team's members to a project."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.test_execution import (
    _bootstrap_tenant,
    _create_project,
    _create_user,
    _login_and_verify,
)

API = "/api/v1"


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.fixture
def world(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    users = {
        key: _create_user(client, f"{key}@horizon.com", key.title(), role, "UserPassw0rd!!")
        for key, role in (("ana", "tester"), ("ben", "tester"), ("mia", "manager"))
    }
    return {"tenant_id": tenant_id, "project": _create_project(client)["id"], **users}


def _team(client: TestClient, name: str = "Payments", **extra) -> dict:
    return _ok(client.post(f"{API}/teams", json={"name": name, **extra}))


def _members(team: dict) -> set[str]:
    return {m["user_id"] for m in team["members"]}


def _project_members(client: TestClient, project_id: str) -> set[str]:
    return set(_ok(client.get(f"{API}/projects/{project_id}"))["assigned_user_ids"])


def _sign_in(client: TestClient, world: dict, who: str) -> TestClient:
    them = TestClient(client.app)
    _login_and_verify(them, world["tenant_id"], f"{who}@horizon.com", "UserPassw0rd!!")
    return them


def test_an_admin_creates_changes_and_deletes_a_team(client: TestClient, world: dict) -> None:
    team = _team(client, "  Payments  ", lead_user_id=world["mia"], member_ids=[world["ana"]])
    assert (team["name"], team["lead_user_id"]) == ("Payments", world["mia"])
    assert _members(team) == {world["ana"]}

    changed = _ok(
        client.patch(
            f"{API}/teams/{team['id']}",
            json={"name": "Billing", "lead_user_id": None, "member_ids": [world["ben"]]},
        )
    )
    assert (changed["name"], changed["lead_user_id"], _members(changed)) == (
        "Billing",
        None,
        {world["ben"]},
    )
    assert [t["name"] for t in _ok(client.get(f"{API}/teams"))] == ["Billing"]
    _ok(client.delete(f"{API}/teams/{team['id']}"))
    assert _ok(client.get(f"{API}/teams")) == []


def test_team_names_are_unique_whatever_the_case(client: TestClient, world: dict) -> None:
    _team(client, "Payments")
    assert client.post(f"{API}/teams", json={"name": "payments"}).status_code == 409
    other = _team(client, "Mobile")
    renamed = client.patch(f"{API}/teams/{other['id']}", json={"name": "PAYMENTS"})
    assert renamed.status_code == 409


def test_members_must_belong_to_the_organization(
    client: TestClient, platform_admin: dict, world: dict, owner_engine
) -> None:
    response = client.post(
        f"{API}/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Other Mutual",
            "admin_name": "Other",
            "admin_email": "other@other.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    outsider = _ok(response)["admin_user_id"]
    for body in ({"member_ids": [outsider]}, {"lead_user_id": outsider}):
        refused = client.post(f"{API}/teams", json={"name": "Mixed", **body})
        assert refused.status_code == 404, refused.text

    # The database refuses a cross-organization member even without the service check.
    team = _team(client, "Ours")
    with pytest.raises(DBAPIError):
        with owner_engine.begin() as conn:
            conn.execute(
                text(
                    "insert into team_members (id, tenant_id, team_id, user_id) "
                    "values (gen_random_uuid(), :tenant, :team, :user)"
                ),
                {"tenant": world["tenant_id"], "team": team["id"], "user": outsider},
            )


@pytest.mark.parametrize("who", ["mia", "ana"])
def test_only_admins_manage_teams(client: TestClient, world: dict, who: str) -> None:
    team = _team(client)
    them = _sign_in(client, world, who)
    assert them.post(f"{API}/teams", json={"name": "Mine"}).status_code == 403
    assert them.patch(f"{API}/teams/{team['id']}", json={"name": "Mine"}).status_code == 403
    assert them.delete(f"{API}/teams/{team['id']}").status_code == 403
    # Someone who may manage project members can see the teams to add; a Tester cannot.
    assert them.get(f"{API}/teams").status_code == (200 if who == "mia" else 403)


def test_adding_a_team_adds_its_current_active_members_once(
    client: TestClient, world: dict
) -> None:
    team = _team(client, member_ids=[world["ana"], world["ben"]])
    _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": world["ana"]}))
    _ok(client.patch(f"{API}/users/{world['ben']}", json={"is_active": False}))
    _ok(
        client.patch(
            f"{API}/teams/{team['id']}",
            json={"member_ids": [world["ana"], world["ben"], world["mia"]]},
        )
    )
    before = _project_members(client, world["project"])

    result = _ok(client.post(f"{API}/projects/{world['project']}/teams/{team['id']}"))

    assert result == {"added": 1, "already_members": 1, "skipped_inactive": 1}
    assert _project_members(client, world["project"]) == before | {world["mia"]}
    again = _ok(client.post(f"{API}/projects/{world['project']}/teams/{team['id']}"))
    assert again["added"] == 0


def test_changing_a_team_later_does_not_change_project_access(
    client: TestClient, world: dict
) -> None:
    team = _team(client, member_ids=[world["ana"]])
    _ok(client.post(f"{API}/projects/{world['project']}/teams/{team['id']}"))
    after_adding = _project_members(client, world["project"])

    _ok(client.patch(f"{API}/teams/{team['id']}", json={"member_ids": [world["ben"]]}))
    _ok(client.delete(f"{API}/teams/{team['id']}"))

    assert _project_members(client, world["project"]) == after_adding
    ben = _sign_in(client, world, "ben")
    assert ben.get(f"{API}/projects/{world['project']}").status_code in (403, 404)


def test_adding_a_team_follows_the_rules_for_adding_a_member(
    client: TestClient, world: dict
) -> None:
    team = _team(client, member_ids=[world["ana"]])
    path = f"{API}/projects/{world['project']}/teams/{team['id']}"
    mia = _sign_in(client, world, "mia")
    assert mia.post(path).status_code == 403  # not assigned to the project
    assert _sign_in(client, world, "ana").post(path).status_code == 403

    _ok(client.post(f"{API}/projects/{world['project']}/members", json={"user_id": world["mia"]}))
    assert _ok(mia.post(path))["added"] == 1

    _ok(client.post(f"{API}/projects/{world['project']}/archive"))
    refused = client.post(path)
    assert refused.status_code == 409, refused.text


def test_erasing_a_user_takes_them_out_of_teams(client: TestClient, world: dict) -> None:
    _team(client, lead_user_id=world["ana"], member_ids=[world["ana"], world["ben"]])

    _ok(
        client.post(
            f"{API}/users/{world['ana']}/erase",
            json={"dry_run": False, "confirm_email": "ana@horizon.com"},
        )
    )

    team = _ok(client.get(f"{API}/teams"))[0]
    assert _members(team) == {world["ben"]}
    assert team["lead_user_id"] is None


def test_team_changes_are_audited(client: TestClient, world: dict) -> None:
    team = _team(client, member_ids=[world["ana"]])
    _ok(client.post(f"{API}/projects/{world['project']}/teams/{team['id']}"))
    _ok(client.delete(f"{API}/teams/{team['id']}"))
    events = _ok(client.get(f"{API}/audit-logs", params={"page_size": 100}))
    assert {"team.created", "project.team_added", "team.deleted"} <= {e["action"] for e in events}
