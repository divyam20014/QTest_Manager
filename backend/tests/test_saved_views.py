"""ADR-096: private per-user saved views."""

from uuid import uuid4

from fastapi.testclient import TestClient

from tests.test_execution import _create_user, _login_and_verify, _setup_admin_project_and_case

URL = "/api/v1/saved-views"
PW = "TesterPassw0rd!"


def _create(client: TestClient, name: str = "Mine", list_key: str = "defects", **kw):
    body = {"list_key": list_key, "name": name, "filters": {"severity": "High"}, **kw}
    return client.post(URL, json=body)


def test_crud_roundtrip(client: TestClient, platform_admin: dict) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    created = _create(client, "High sev", sort=None)
    assert created.status_code == 200, created.text
    view = created.json()["data"]
    assert view["filters"] == {"severity": "High"} and view["is_default"] is False

    listed = client.get(URL, params={"list_key": "defects"}).json()["data"]
    assert [v["id"] for v in listed] == [view["id"]]
    assert client.get(URL, params={"list_key": "test_runs"}).json()["data"] == []

    patched = client.patch(
        f"{URL}/{view['id']}", json={"name": "Renamed", "filters": {"status": "Open"}}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["data"]["name"] == "Renamed"
    assert patched.json()["data"]["filters"] == {"status": "Open"}

    assert client.delete(f"{URL}/{view['id']}").status_code == 200
    assert client.get(URL).json()["data"] == []
    assert client.delete(f"{URL}/{view['id']}").status_code == 404


def test_validation_rejects_unknown_keys_bad_types_and_size(
    client: TestClient, platform_admin: dict
) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    bad_bodies = [
        {"list_key": "nope", "name": "x", "filters": {}},
        {"list_key": "defects", "name": "x", "filters": {"evil": "1"}},
        {"list_key": "defects", "name": "x", "filters": {"severity": {"a": 1}}},
        {"list_key": "defects", "name": "x", "filters": {"severity": 5}},
        {"list_key": "defects", "name": "x", "filters": {"projectId": "not-a-uuid"}},
        {"list_key": "defects", "name": "x", "filters": {"createdFrom": "yesterday"}},
        {"list_key": "test_runs", "name": "x", "filters": {"severity": "High"}},
        {"list_key": "defects", "name": "x", "filters": {}, "sort": "bogus"},
        {"list_key": "defects", "name": "   ", "filters": {}},
        {"list_key": "defects", "name": "n" * 61, "filters": {}},
        {"list_key": "test_cases", "name": "x", "filters": {"search": "s" * 201}},
    ]
    for body in bad_bodies:
        r = client.post(URL, json=body)
        assert r.status_code == 422, (body, r.text)
    ok = client.post(
        URL,
        json={
            "list_key": "defects",
            "name": "ok",
            "filters": {"projectId": str(uuid4()), "createdFrom": "2026-01-02"},
        },
    )
    assert ok.status_code == 200, ok.text
    # PATCH validates against the view's own list.
    vid = ok.json()["data"]["id"]
    assert client.patch(f"{URL}/{vid}", json={"filters": {"evil": "1"}}).status_code == 422


def test_unique_name_and_max_25_per_list(client: TestClient, platform_admin: dict) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    assert _create(client, "dup").status_code == 200
    assert _create(client, "dup").status_code == 409
    # Same name on another list is fine.
    assert _create(client, "dup", list_key="test_runs", filters={}).status_code == 200
    for i in range(24):
        assert _create(client, f"v{i}").status_code == 200
    over = _create(client, "one-too-many")
    assert over.status_code == 409 and over.json()["error"]["code"] == "conflict"
    assert _create(client, "other list", list_key="test_cases", filters={}).status_code == 200


def test_only_one_default_per_user_and_list(client: TestClient, platform_admin: dict) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    a = _create(client, "a", is_default=True).json()["data"]
    b = _create(client, "b", is_default=True).json()["data"]
    views = {v["id"]: v for v in client.get(URL, params={"list_key": "defects"}).json()["data"]}
    assert views[a["id"]]["is_default"] is False and views[b["id"]]["is_default"] is True
    assert client.patch(f"{URL}/{a['id']}", json={"is_default": True}).status_code == 200
    views = {v["id"]: v for v in client.get(URL, params={"list_key": "defects"}).json()["data"]}
    assert [i for i, v in views.items() if v["is_default"]] == [a["id"]]
    # A default on a different list is independent.
    t = _create(client, "t", list_key="test_runs", filters={}, is_default=True).json()["data"]
    assert t["is_default"] is True
    assert client.patch(f"{URL}/{a['id']}", json={"is_default": False}).status_code == 200


def test_views_are_private_between_users_and_tenants(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, _, _ = _setup_admin_project_and_case(client, platform_admin)
    view = _create(client, "admin private").json()["data"]
    _create_user(client, "tester@horizon.com", "Tester One", "tester", PW)

    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", PW)
    assert tester.get(URL).json()["data"] == []
    assert tester.patch(f"{URL}/{view['id']}", json={"name": "hijack"}).status_code == 404
    assert tester.delete(f"{URL}/{view['id']}").status_code == 404
    # The tester can use the same name for their own view.
    assert _create(tester, "admin private").status_code == 200

    other = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Other Mutual",
            "admin_name": "Other Admin",
            "admin_email": "admin@other.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    other_client = TestClient(client.app)
    _login_and_verify(other_client, other["tenant"]["id"], "admin@other.com", "AdminPassw0rd!")
    assert other_client.get(URL).json()["data"] == []
    assert other_client.delete(f"{URL}/{view['id']}").status_code == 404

    # Untouched for the owner.
    assert len(client.get(URL).json()["data"]) == 1


def test_requires_sign_in() -> None:
    from app.main import app

    assert TestClient(app).get(URL).status_code == 401
