"""Platform Admin UI/UX pass: tenant 'inactive' status (distinct from
'suspended'), force-session-revocation on suspend/inactive, tenant list
search/filter/pagination, and platform-admin self-management (list/create/
deactivate, with a self-deactivation guard)."""

from fastapi.testclient import TestClient
from sqlalchemy import text


def _create_tenant(client: TestClient, platform_admin: dict, name: str = "Lifecycle Test Co") -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
            "admin_name": "Admin A",
            "admin_email": f"admin@{name.lower().replace(' ', '')}.example.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify_mfa(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    """Drives the real cookie-based flow via the client's own cookie jar
    (matches how `verify_mfa` reads the pending session id from the request
    cookie, not from the request body) -- leaves `client` authenticated."""
    login = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": email, "password": password},
    )
    assert login.status_code == 200, login.text
    code = login.json()["data"]["debug_code"]
    verify = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify.status_code == 200, verify.text


def test_tenant_status_accepts_inactive(client: TestClient, platform_admin: dict) -> None:
    tenant = _create_tenant(client, platform_admin, "Inactive Status Co")
    tenant_id = tenant["tenant"]["id"]

    response = client.patch(
        f"/api/v1/platform/tenants/{tenant_id}/status",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"status": "inactive"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["status"] == "inactive"


def test_inactive_tenant_login_blocked_with_distinct_message(
    client: TestClient, platform_admin: dict
) -> None:
    tenant = _create_tenant(client, platform_admin, "Inactive Login Co")
    tenant_id = tenant["tenant"]["id"]
    admin_email = f"admin@{'Inactive Login Co'.lower().replace(' ', '')}.example.com"

    client.patch(
        f"/api/v1/platform/tenants/{tenant_id}/status",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"status": "inactive"},
    )

    login = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": admin_email, "password": "AdminPassw0rd!"},
    )
    assert login.status_code == 403
    assert "deactivated" in login.json()["error"]["message"].lower()


def test_suspending_a_tenant_revokes_active_sessions(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    tenant = _create_tenant(client, platform_admin, "Force Logout Co")
    tenant_id = tenant["tenant"]["id"]
    admin_email = f"admin@{'Force Logout Co'.lower().replace(' ', '')}.example.com"

    _login_and_verify_mfa(client, tenant_id, admin_email, "AdminPassw0rd!")
    assert client.cookies.get("qth_session")

    with owner_engine.begin() as conn:
        active_before = conn.execute(
            text(
                "SELECT count(*) FROM sessions WHERE tenant_id = :tid AND revoked_at IS NULL"
            ),
            {"tid": tenant_id},
        ).scalar_one()
    assert active_before == 1

    suspend = client.patch(
        f"/api/v1/platform/tenants/{tenant_id}/status",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"status": "suspended"},
    )
    assert suspend.status_code == 200, suspend.text

    with owner_engine.begin() as conn:
        active_after = conn.execute(
            text(
                "SELECT count(*) FROM sessions WHERE tenant_id = :tid AND revoked_at IS NULL"
            ),
            {"tid": tenant_id},
        ).scalar_one()
    assert active_after == 0

    # Already-authenticated requests using the now-revoked session must be
    # rejected, not merely blocked at a future login.
    whoami = client.get("/api/v1/auth/me")
    assert whoami.status_code == 401


def test_approving_a_tenant_does_not_touch_sessions(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    """Approve is a reversible, non-destructive transition -- it must never
    revoke sessions, unlike suspend/inactive."""
    tenant = _create_tenant(client, platform_admin, "Approve Noop Co")
    tenant_id = tenant["tenant"]["id"]
    admin_email = f"admin@{'Approve Noop Co'.lower().replace(' ', '')}.example.com"

    _login_and_verify_mfa(client, tenant_id, admin_email, "AdminPassw0rd!")

    response = client.patch(
        f"/api/v1/platform/tenants/{tenant_id}/status",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"status": "approved"},
    )
    assert response.status_code == 200, response.text

    with owner_engine.begin() as conn:
        active = conn.execute(
            text(
                "SELECT count(*) FROM sessions WHERE tenant_id = :tid AND revoked_at IS NULL"
            ),
            {"tid": tenant_id},
        ).scalar_one()
    assert active == 1


def test_tenant_list_search_filter_and_pagination(client: TestClient, platform_admin: dict) -> None:
    _create_tenant(client, platform_admin, "Searchable Alpha Co")
    _create_tenant(client, platform_admin, "Searchable Beta Co")
    _create_tenant(client, platform_admin, "Unrelated Gamma Co")

    search_response = client.get(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        params={"search": "Searchable"},
    )
    assert search_response.status_code == 200, search_response.text
    body = search_response.json()["data"]
    assert body["total"] >= 2
    names = {t["name"] for t in body["items"]}
    assert "Searchable Alpha Co" in names
    assert "Searchable Beta Co" in names
    assert "Unrelated Gamma Co" not in names

    paged_response = client.get(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        params={"page": 1, "page_size": 1, "search": "Searchable"},
    )
    assert paged_response.status_code == 200
    paged_body = paged_response.json()["data"]
    assert len(paged_body["items"]) == 1
    assert paged_body["total"] >= 2

    status_response = client.get(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        params={"status": "approved"},
    )
    assert status_response.status_code == 200
    assert all(t["status"] == "approved" for t in status_response.json()["data"]["items"])


def test_platform_admin_crud_and_self_deactivation_guard(
    client: TestClient, platform_admin: dict
) -> None:
    auth = (platform_admin["email"], platform_admin["password"])

    create_response = client.post(
        "/api/v1/platform/admins",
        auth=auth,
        json={"email": "second.admin@example.com", "password": "SecondAdmin123!"},
    )
    assert create_response.status_code == 200, create_response.text
    second_admin = create_response.json()["data"]
    assert second_admin["is_active"] is True

    list_response = client.get("/api/v1/platform/admins", auth=auth)
    assert list_response.status_code == 200
    emails = {a["email"] for a in list_response.json()["data"]["items"]}
    assert "second.admin@example.com" in emails
    assert platform_admin["email"] in emails

    self_id = next(
        a["id"]
        for a in list_response.json()["data"]["items"]
        if a["email"] == platform_admin["email"]
    )
    self_deactivate = client.patch(
        f"/api/v1/platform/admins/{self_id}", auth=auth, json={"is_active": False}
    )
    assert self_deactivate.status_code == 409
    assert "your own" in self_deactivate.json()["error"]["message"].lower()

    other_id = second_admin["id"]
    deactivate_other = client.patch(
        f"/api/v1/platform/admins/{other_id}", auth=auth, json={"is_active": False}
    )
    assert deactivate_other.status_code == 200
    assert deactivate_other.json()["data"]["is_active"] is False

    locked_out = client.post(
        "/api/v1/platform/tenants",
        auth=("second.admin@example.com", "SecondAdmin123!"),
        json={
            "tenant_name": "x",
            "admin_name": "x",
            "admin_email": "x2@example.com",
            "admin_password": "x",
        },
    )
    assert locked_out.status_code == 401
    assert "deactivated" in locked_out.json()["error"]["message"].lower()

    reactivate = client.patch(
        f"/api/v1/platform/admins/{other_id}", auth=auth, json={"is_active": True}
    )
    assert reactivate.status_code == 200
    assert reactivate.json()["data"]["is_active"] is True
