"""Tier 1 / ADR-053: tenant user-invite flow (SR-2.4/5.11, SAAS-GAP-8),
replacing admin-sets-the-password-directly provisioning."""

from fastapi.testclient import TestClient


def _bootstrap_tenant(client: TestClient, platform_admin: dict) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Horizon Mutual",
            "admin_name": "Admin A",
            "admin_email": "admin@horizon.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _login_and_verify(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login_response = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert login_response.status_code == 200, login_response.text
    code = login_response.json()["data"]["debug_code"]
    verify_response = client.post("/api/v1/auth/mfa/verify", json={"code": code})
    assert verify_response.status_code == 200, verify_response.text


def _setup_admin(client: TestClient, platform_admin: dict) -> str:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return tenant_id


def test_invite_then_accept_creates_an_active_user(
    client: TestClient, platform_admin: dict
) -> None:
    _setup_admin(client, platform_admin)

    response = client.post(
        "/api/v1/users/invite",
        json={"email": "newhire@horizon.com", "name": "New Hire", "role": "tester"},
    )
    assert response.status_code == 200, response.text
    invite = response.json()["data"]
    assert invite["invite_token"] is not None

    # No user exists yet -- only the invite.
    users = client.get("/api/v1/users").json()["data"]
    assert all(u["email"] != "newhire@horizon.com" for u in users)

    accept = client.post(
        f"/api/v1/users/invite/{invite['invite_token']}/accept",
        json={"password": "NewHirePassw0rd!"},
    )
    assert accept.status_code == 200, accept.text
    assert accept.json()["data"]["email"] == "newhire@horizon.com"
    assert accept.json()["data"]["role"] == "tester"

    users = client.get("/api/v1/users").json()["data"]
    assert any(u["email"] == "newhire@horizon.com" for u in users)


def test_invite_token_is_single_use(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    invite = client.post(
        "/api/v1/users/invite",
        json={"email": "newhire@horizon.com", "name": "New Hire", "role": "tester"},
    ).json()["data"]

    first = client.post(
        f"/api/v1/users/invite/{invite['invite_token']}/accept",
        json={"password": "NewHirePassw0rd!"},
    )
    assert first.status_code == 200, first.text

    second = client.post(
        f"/api/v1/users/invite/{invite['invite_token']}/accept",
        json={"password": "AnotherPassw0rd!"},
    )
    assert second.status_code == 401, second.text


def test_wrong_token_is_rejected(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    invite = client.post(
        "/api/v1/users/invite",
        json={"email": "newhire@horizon.com", "name": "New Hire", "role": "tester"},
    ).json()["data"]

    invite_id = invite["invite_token"].split(".")[0]
    tampered = f"{invite_id}.not-the-real-secret"

    response = client.post(
        f"/api/v1/users/invite/{tampered}/accept", json={"password": "NewHirePassw0rd!"}
    )
    assert response.status_code == 401, response.text


def test_malformed_token_is_rejected(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    response = client.post(
        "/api/v1/users/invite/not-a-real-token/accept", json={"password": "NewHirePassw0rd!"}
    )
    assert response.status_code == 401, response.text


def test_cannot_invite_an_email_that_already_has_an_account(
    client: TestClient, platform_admin: dict
) -> None:
    _setup_admin(client, platform_admin)
    response = client.post(
        "/api/v1/users/invite",
        json={"email": "admin@horizon.com", "name": "Someone", "role": "tester"},
    )
    assert response.status_code == 422, response.text


def test_cannot_double_invite_the_same_pending_email(
    client: TestClient, platform_admin: dict
) -> None:
    _setup_admin(client, platform_admin)
    client.post(
        "/api/v1/users/invite",
        json={"email": "newhire@horizon.com", "name": "New Hire", "role": "tester"},
    )
    response = client.post(
        "/api/v1/users/invite",
        json={"email": "newhire@horizon.com", "name": "New Hire", "role": "tester"},
    )
    assert response.status_code == 422, response.text


def test_invited_user_is_scoped_to_the_inviting_tenant(
    client: TestClient, platform_admin: dict
) -> None:
    """A second tenant's admin inviting the same email must produce an
    independent invite/user scoped to their own tenant, not a collision."""
    tenant_a = _setup_admin(client, platform_admin)

    bootstrap_b = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Apex Insurance",
            "admin_name": "Admin B",
            "admin_email": "admin@apex.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    tenant_b = bootstrap_b["tenant"]["id"]

    invite_a = client.post(
        "/api/v1/users/invite",
        json={"email": "shared@example.com", "name": "Shared Person", "role": "tester"},
    ).json()["data"]
    accept_a = client.post(
        f"/api/v1/users/invite/{invite_a['invite_token']}/accept",
        json={"password": "SharedPassw0rd!"},
    )
    assert accept_a.status_code == 200, accept_a.text

    _login_and_verify(client, tenant_b, "admin@apex.com", "AdminPassw0rd!")
    invite_b = client.post(
        "/api/v1/users/invite",
        json={"email": "shared@example.com", "name": "Shared Person", "role": "manager"},
    ).json()["data"]
    accept_b = client.post(
        f"/api/v1/users/invite/{invite_b['invite_token']}/accept",
        json={"password": "SharedPassw0rd2!"},
    )
    assert accept_b.status_code == 200, accept_b.text

    # Each tenant sees only its own copy of this user.
    _login_and_verify(client, tenant_a, "admin@horizon.com", "AdminPassw0rd!")
    users_a = client.get("/api/v1/users").json()["data"]
    assert any(u["email"] == "shared@example.com" and u["role"] == "tester" for u in users_a)

    _login_and_verify(client, tenant_b, "admin@apex.com", "AdminPassw0rd!")
    users_b = client.get("/api/v1/users").json()["data"]
    assert any(u["email"] == "shared@example.com" and u["role"] == "manager" for u in users_b)


def test_invite_requires_user_manage_permission(client: TestClient, platform_admin: dict) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    tester_id = client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    ).json()["data"]["id"]
    assert tester_id

    _login_and_verify(client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    response = client.post(
        "/api/v1/users/invite",
        json={"email": "another@horizon.com", "name": "Another", "role": "tester"},
    )
    assert response.status_code == 403, response.text
