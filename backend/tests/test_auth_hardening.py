from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.test_auth_flow import _bootstrap_tenant, _login_and_verify


def test_suspended_tenant_cannot_login(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE tenants SET status = 'suspended' WHERE id = :id"), {"id": tenant_id}
        )

    response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "AdminPassw0rd!"},
    )
    assert response.status_code == 403
    assert "suspended" in response.json()["error"]["message"].lower()


def test_pending_tenant_cannot_login(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE tenants SET status = 'pending' WHERE id = :id"), {"id": tenant_id}
        )

    response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "AdminPassw0rd!"},
    )
    assert response.status_code == 403
    assert "pending" in response.json()["error"]["message"].lower()


def test_suspending_tenant_mid_session_blocks_further_requests(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    assert client.get("/api/v1/auth/me").status_code == 200

    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE tenants SET status = 'suspended' WHERE id = :id"), {"id": tenant_id}
        )

    response = client.get("/api/v1/auth/me")
    assert response.status_code == 403


def test_admin_password_reset_revokes_existing_sessions(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    create_response = client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester One",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    tester_id = create_response.json()["data"]["id"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert tester_client.get("/api/v1/auth/me").status_code == 200

    reset_response = client.post(
        f"/api/v1/users/{tester_id}/reset-password", json={"new_password": "NewPassw0rd1!"}
    )
    assert reset_response.status_code == 200, reset_response.text

    # The tester's pre-reset session must no longer work.
    assert tester_client.get("/api/v1/auth/me").status_code == 401

    # The old password no longer authenticates; the new one does.
    stale_login = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "tester@horizon.com", "password": "TesterPassw0rd!"},
    )
    assert stale_login.status_code == 401

    fresh_client = TestClient(client.app)
    _login_and_verify(fresh_client, tenant_id, "tester@horizon.com", "NewPassw0rd1!")
    assert fresh_client.get("/api/v1/auth/me").status_code == 200


def test_idle_session_timeout_expires_session(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    assert client.get("/api/v1/auth/me").status_code == 200

    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE sessions SET last_seen_at = now() - interval '31 minutes' "
                "WHERE tenant_id = :tenant_id"
            ),
            {"tenant_id": tenant_id},
        )

    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert "inactivity" in response.json()["error"]["message"].lower()


def test_mfa_real_mode_fails_loudly_without_smtp_configured(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    """ADR-032: 'real' delivery mode must not silently pretend to send."""
    from app.core import mfa as mfa_module
    from app.services import auth_service

    monkeypatch.setattr(auth_service.settings, "mfa_delivery_mode", "real")
    monkeypatch.setattr(mfa_module.settings, "mfa_delivery_mode", "real")

    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]

    response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "AdminPassw0rd!"},
    )
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "configuration_error"
