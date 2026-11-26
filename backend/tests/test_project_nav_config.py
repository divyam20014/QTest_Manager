"""ADR-122: projects.nav_config validation, who may change it, tenant isolation, and the
PATCH /releases/{id} endpoint added with it."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.schemas.project import NavConfig
from tests.test_gap_closure import _bootstrap_tenant, _create_project, _login_and_verify

MANAGER = ("manager@horizon.com", "ManagerPassw0rd!")
TESTER = ("tester@horizon.com", "TesterPassw0rd!")
ADMIN = ("admin@horizonmutual.com", "AdminPassw0rd!")
OTHER_ADMIN = ("admin@otherinsurer.com", "AdminPassw0rd!")


def _setup(client: TestClient, platform_admin: dict) -> dict:
    tenant_id = _bootstrap_tenant(client, platform_admin)["tenant"]["id"]
    _login_and_verify(client, tenant_id, ADMIN[0], ADMIN[1])
    project = _create_project(client)
    ids = {}
    for role, (email, password) in (("manager", MANAGER), ("tester", TESTER)):
        response = client.post(
            "/api/v1/users",
            json={"email": email, "name": f"{role} one", "role": role, "password": password},
        )
        assert response.status_code == 200, response.text
        ids[role] = response.json()["data"]["id"]
    return {"tenant_id": tenant_id, "project": project, **ids}


def _as(client: TestClient, tenant_id: str, creds: tuple[str, str]) -> TestClient:
    other = TestClient(client.app)
    _login_and_verify(other, tenant_id, creds[0], creds[1])
    return other


def _patch(client: TestClient, project_id: str, nav_config: object):
    return client.patch(f"/api/v1/projects/{project_id}", json={"nav_config": nav_config})


def test_nav_config_defaults_to_null_and_round_trips(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    assert ctx["project"]["nav_config"] is None
    config = {"order": ["overview", "defects", "team"], "hidden": ["planning", "tasks"]}
    response = _patch(client, pid, config)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["nav_config"] == config
    assert client.get(f"/api/v1/projects/{pid}").json()["data"]["nav_config"] == config
    # The projects list carries it too, so the switcher can keep the current tab.
    listed = client.get("/api/v1/projects").json()["data"]["items"]
    assert listed[0]["nav_config"] == config
    # null resets to the defaults.
    response = _patch(client, pid, None)
    assert response.status_code == 200
    assert response.json()["data"]["nav_config"] is None


def test_nav_config_is_validated_against_the_allowlist(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    bad = [
        {"order": ["overview", "calendar"], "hidden": []},  # unknown key in order
        {"order": [], "hidden": ["documents"]},  # unknown key in hidden
        {"order": ["overview", "overview"], "hidden": []},  # duplicate
        {"order": [], "hidden": ["team", "team"]},
        {"order": [], "hidden": ["overview"]},  # core tab
        {"order": [], "hidden": ["defects"]},
        {"order": [], "hidden": ["Planning"]},  # case-sensitive allowlist
    ]
    for config in bad:
        response = _patch(client, pid, config)
        assert response.status_code == 422, (config, response.text)
    # Nothing was stored by the rejected requests.
    assert client.get(f"/api/v1/projects/{pid}").json()["data"]["nav_config"] is None
    # A partial order and an empty hidden list are fine.
    assert _patch(client, pid, {"order": ["reports"]}).status_code == 200


def test_changing_nav_config_needs_project_edit_and_assignment(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    config = {"order": [], "hidden": ["team"]}

    tester = _as(client, ctx["tenant_id"], TESTER)
    client.post(f"/api/v1/projects/{pid}/members", json={"user_id": ctx["tester"]})
    assert _patch(tester, pid, config).status_code == 403

    manager = _as(client, ctx["tenant_id"], MANAGER)
    # A manager who is not assigned to the project may not change it (ADR-018).
    assert _patch(manager, pid, config).status_code == 403
    client.post(f"/api/v1/projects/{pid}/members", json={"user_id": ctx["manager"]})
    assert _patch(manager, pid, config).status_code == 200
    assert client.get(f"/api/v1/projects/{pid}").json()["data"]["nav_config"] == config
    # Everyone who can see the project can read it.
    assert tester.get(f"/api/v1/projects/{pid}").json()["data"]["nav_config"] == config


def test_nav_config_change_is_audited_and_bumps_version(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    before = ctx["project"]["version"]
    config = {"order": ["overview"], "hidden": ["team"]}
    assert _patch(client, pid, config).status_code == 200
    assert client.get(f"/api/v1/projects/{pid}").json()["data"]["version"] == before + 1
    logs = client.get("/api/v1/audit-logs", params={"action": "project.updated"}).json()["data"]
    assert any(row["entity_id"] == pid for row in logs)


def test_nav_config_is_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    assert _patch(client, pid, {"order": [], "hidden": ["team"]}).status_code == 200

    other_tenant = _bootstrap_tenant(client, platform_admin, "Other Insurer")["tenant"]["id"]
    other = _as(client, other_tenant, OTHER_ADMIN)
    assert other.get(f"/api/v1/projects/{pid}").status_code == 404
    assert _patch(other, pid, {"order": [], "hidden": []}).status_code == 404
    # The owning tenant's value is untouched.
    assert client.get(f"/api/v1/projects/{pid}").json()["data"]["nav_config"] == {
        "order": [],
        "hidden": ["team"],
    }
    # And the other tenant's own project starts from the defaults.
    own = _create_project(other, "Other Insurer Project")
    assert own["nav_config"] is None


@pytest.mark.parametrize(
    ("saved", "order", "hidden"),
    [
        # The merged tab takes the place of whichever old one came first.
        (
            {"order": ["releases", "overview", "test-plans"], "hidden": []},
            ["planning", "overview"],
            [],
        ),
        # Only one of the two hidden: Planning stays, since the other was still visible.
        ({"order": [], "hidden": ["test-plans"]}, [], []),
        ({"order": [], "hidden": ["releases"]}, [], []),
        # Both hidden: so is Planning.
        ({"order": [], "hidden": ["releases", "team", "test-plans"]}, [], ["team", "planning"]),
        # Tabs that are now opened from the header, and the one removed before them.
        (
            {"order": ["settings", "activity", "requirements", "team"], "hidden": ["activity"]},
            ["team"],
            [],
        ),
        # Today's keys are left alone: hiding Planning means hiding it.
        ({"order": ["planning"], "hidden": ["planning"]}, ["planning"], ["planning"]),
    ],
)
def test_a_layout_saved_with_old_tabs_is_read_in_todays_keys(
    saved: dict, order: list[str], hidden: list[str]
) -> None:
    config = NavConfig.model_validate(saved)
    assert (config.order, config.hidden) == (order, hidden)


def test_a_project_with_an_old_stored_layout_still_loads(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    # Every tab of the old strip, as the settings page saved it after a reorder.
    old_order = [
        "overview", "tasks", "test-cases", "test-runs", "defects", "reports",
        "test-plans", "releases", "team", "activity", "settings",
    ]  # fmt: skip
    stored = json.dumps({"order": old_order, "hidden": ["releases", "activity"]})
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE projects SET nav_config = CAST(:c AS jsonb) WHERE id = :p"),
            {"c": stored, "p": pid},
        )
    expected = {"order": [*old_order[:6], "planning", "team"], "hidden": []}
    one = client.get(f"/api/v1/projects/{pid}")
    assert one.status_code == 200, one.text
    assert one.json()["data"]["nav_config"] == expected
    listed = client.get("/api/v1/projects")
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"]["items"][0]["nav_config"] == expected


# ---- PATCH /releases/{id} ----------------------------------------------------------------


def _release(client: TestClient, project_id: str, **extra) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/releases", json={"name": "R 1.0", **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_release_patch_edits_only_the_fields_sent(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    release = _release(client, pid, release_date="2026-06-30", notes="first")
    assert release["status"] is None
    response = client.patch(
        f"/api/v1/releases/{release['id']}", json={"name": "R 1.1", "status": "In Progress"}
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["name"], data["status"]) == ("R 1.1", "In Progress")
    assert (data["release_date"], data["notes"]) == ("2026-06-30", "first")  # untouched
    # null clears an optional field; the list shows the stored values.
    response = client.patch(
        f"/api/v1/releases/{release['id']}", json={"release_date": None, "status": "Released"}
    )
    assert response.json()["data"]["release_date"] is None
    listed = client.get(f"/api/v1/projects/{pid}/releases").json()["data"]
    assert listed[0]["status"] == "Released" and listed[0]["name"] == "R 1.1"


def test_release_patch_rejects_bad_input(client: TestClient, platform_admin: dict) -> None:
    ctx = _setup(client, platform_admin)
    release = _release(client, ctx["project"]["id"])
    url = f"/api/v1/releases/{release['id']}"
    assert client.patch(url, json={"status": "Shipped"}).status_code == 422
    assert client.patch(url, json={"name": ""}).status_code == 422
    assert client.patch(url, json={"name": None}).status_code == 422
    assert client.patch(url, json={"release_date": "not-a-date"}).status_code == 422
    unknown = "00000000-0000-0000-0000-000000000000"
    assert client.patch(f"/api/v1/releases/{unknown}", json={"name": "X"}).status_code == 404


def test_release_patch_permission_audit_and_isolation(
    client: TestClient, platform_admin: dict
) -> None:
    ctx = _setup(client, platform_admin)
    pid = ctx["project"]["id"]
    release = _release(client, pid)
    url = f"/api/v1/releases/{release['id']}"

    tester = _as(client, ctx["tenant_id"], TESTER)
    assert tester.patch(url, json={"name": "Renamed"}).status_code == 403
    client.post(f"/api/v1/projects/{pid}/members", json={"user_id": ctx["tester"]})
    assert tester.patch(url, json={"name": "Renamed"}).status_code == 403

    response = client.patch(url, json={"status": "Planned"})
    assert response.status_code == 200
    logs = client.get("/api/v1/audit-logs", params={"action": "release.updated"}).json()["data"]
    assert [row["entity_id"] for row in logs] == [release["id"]]

    other_tenant = _bootstrap_tenant(client, platform_admin, "Other Insurer")["tenant"]["id"]
    other = _as(client, other_tenant, OTHER_ADMIN)
    assert other.patch(url, json={"name": "Cross tenant"}).status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/releases").json()["data"][0]["name"] == "R 1.0"
