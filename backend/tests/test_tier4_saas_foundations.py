"""Tier 4 / ADR-054: tenant branding, IP allowlist, data residency, tenant
data export, SSO (OIDC), and SCIM provisioning (PV-11.1 through 11.6)."""

import io
import zipfile
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.services import job_service


def _bootstrap_tenant(client: TestClient, platform_admin: dict, **overrides) -> dict:
    payload = {
        "tenant_name": "Horizon Mutual",
        "admin_name": "Admin A",
        "admin_email": "admin@horizon.com",
        "admin_password": "AdminPassw0rd!",
    }
    payload.update(overrides)
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json=payload,
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


# ---------------------------------------------------------------------------
# 1. Tenant branding (PV-11.4)
# ---------------------------------------------------------------------------


def test_branding_round_trips(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)

    response = client.put(
        "/api/v1/settings/branding",
        json={"display_name": "Horizon Insurance Co.", "primary_color": "#1a2b3c"},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["display_name"] == "Horizon Insurance Co."
    assert data["primary_color"] == "#1a2b3c"
    assert data["has_logo"] is False

    read_back = client.get("/api/v1/settings/branding").json()["data"]
    assert read_back["display_name"] == "Horizon Insurance Co."


def test_branding_update_requires_settings_manage_permission(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    _login_and_verify(client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    # Any authenticated tenant member can READ branding (app shell needs
    # it for every user), but only tenant.settings.manage can write it.
    assert client.get("/api/v1/settings/branding").status_code == 200
    response = client.put(
        "/api/v1/settings/branding", json={"display_name": "Should Not Apply"}
    )
    assert response.status_code == 403, response.text


def test_branding_isolated_per_tenant(client: TestClient, platform_admin: dict) -> None:
    tenant_a = _setup_admin(client, platform_admin)
    client.put("/api/v1/settings/branding", json={"display_name": "Tenant A Brand"})

    bootstrap_b = _bootstrap_tenant(
        client,
        platform_admin,
        tenant_name="Apex Insurance",
        admin_email="admin@apex.com",
    )
    _login_and_verify(client, bootstrap_b["tenant"]["id"], "admin@apex.com", "AdminPassw0rd!")
    tenant_b_branding = client.get("/api/v1/settings/branding").json()["data"]
    assert tenant_b_branding["display_name"] is None

    _login_and_verify(client, tenant_a, "admin@horizon.com", "AdminPassw0rd!")
    branding_a = client.get("/api/v1/settings/branding").json()["data"]
    assert branding_a["display_name"] == "Tenant A Brand"


def test_logo_upload_and_download_round_trip(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    upload = client.post(
        "/api/v1/settings/branding/logo",
        files={"file": ("logo.png", png_bytes, "image/png")},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["data"]["has_logo"] is True

    download = client.get("/api/v1/settings/branding/logo")
    assert download.status_code == 200
    assert download.content == png_bytes
    assert download.headers["content-type"] == "image/png"


def test_logo_upload_rejects_unsupported_type(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    response = client.post(
        "/api/v1/settings/branding/logo",
        files={"file": ("payload.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 422, response.text


# ---------------------------------------------------------------------------
# 2. IP allowlist (PV-11.3)
# ---------------------------------------------------------------------------


def test_ip_allowlist_defaults_to_unrestricted(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    assert client.get("/api/v1/settings").json()["data"]["ip_allowlist"] == []
    # TestClient's requests always look like the same loopback address --
    # with no allowlist set, every one of them must succeed, as asserted
    # throughout this whole test module already.


def test_ip_allowlist_blocks_requests_outside_it(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    update = client.patch("/api/v1/settings", json={"ip_allowlist": ["10.0.0.0/8"]})
    assert update.status_code == 200, update.text

    # Starlette's TestClient reports a literal "testclient" host, not a
    # real IP -- patched here to exercise the actual CIDR-matching logic
    # end-to-end rather than only the "can't parse the caller's IP" path.
    with patch("app.core.auth.client_ip", return_value="203.0.113.5"):
        blocked = client.get("/api/v1/settings")
    assert blocked.status_code == 403, blocked.text
    assert "allowlist" in blocked.json()["error"]["message"]


def test_ip_allowlist_allows_matching_cidr(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    update = client.patch("/api/v1/settings", json={"ip_allowlist": ["203.0.113.0/24"]})
    assert update.status_code == 200, update.text
    with patch("app.core.auth.client_ip", return_value="203.0.113.5"):
        assert client.get("/api/v1/settings").status_code == 200


def test_ip_allowlist_rejects_malformed_cidr(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    response = client.patch("/api/v1/settings", json={"ip_allowlist": ["not-a-cidr"]})
    assert response.status_code == 422, response.text


def test_ip_allowlist_enforced_at_login_too(client: TestClient, platform_admin: dict) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    client.patch("/api/v1/settings", json={"ip_allowlist": ["10.0.0.0/8"]})
    client.post("/api/v1/auth/logout")

    response = client.post(
        "/api/v1/auth/login",
        json={"tenant_id": tenant_id, "email": "admin@horizon.com", "password": "AdminPassw0rd!"},
    )
    assert response.status_code == 403, response.text


def test_ip_allowlist_is_isolated_per_tenant(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    client.patch("/api/v1/settings", json={"ip_allowlist": ["10.0.0.0/8"]})

    bootstrap_b = _bootstrap_tenant(
        client, platform_admin, tenant_name="Apex Insurance", admin_email="admin@apex.com"
    )
    login_b = client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": bootstrap_b["tenant"]["id"],
            "email": "admin@apex.com",
            "password": "AdminPassw0rd!",
        },
    )
    # Tenant B has no allowlist of its own -- tenant A's restriction must
    # never leak across.
    assert login_b.status_code == 200, login_b.text


# ---------------------------------------------------------------------------
# 3. Data residency readiness (PV-11.6)
# ---------------------------------------------------------------------------


def test_data_region_set_at_creation(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin, data_region="eu")
    assert bootstrap["tenant"]["data_region"] == "eu"


def test_data_region_defaults_to_us(client: TestClient, platform_admin: dict) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    assert bootstrap["tenant"]["data_region"] == "us"


def test_data_region_is_platform_admin_only(client: TestClient, platform_admin: dict) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    # No tenant-facing endpoint exposes writing this -- only reading it
    # (via /settings, indirectly) and the platform-admin PATCH route can.
    response = client.patch(
        f"/api/v1/platform/tenants/{tenant_id}/data-region",
        json={"data_region": "apac"},
    )
    assert response.status_code == 401, response.text  # no platform Basic auth supplied

    admin_response = client.patch(
        f"/api/v1/platform/tenants/{tenant_id}/data-region",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"data_region": "apac"},
    )
    assert admin_response.status_code == 200, admin_response.text
    assert admin_response.json()["data"]["data_region"] == "apac"


# ---------------------------------------------------------------------------
# 4. Tenant-wide data export (PV-11.5)
# ---------------------------------------------------------------------------


def test_tenant_export_produces_a_valid_archive_with_expected_contents(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    _setup_admin(client, platform_admin)
    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )

    enqueue = client.post("/api/v1/export")
    assert enqueue.status_code == 200, enqueue.text
    job_id = enqueue.json()["data"]["job_id"]

    claimed = job_service.run_once(db_session)
    assert claimed is True

    status = client.get(f"/api/v1/export/jobs/{job_id}").json()["data"]
    assert status["status"] == "succeeded"
    assert status["result"]["manifest"]["users"] == 2  # admin + tester

    download = client.get(f"/api/v1/export/jobs/{job_id}/download")
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        names = set(archive.namelist())
        assert "manifest.json" in names
        assert "users.json" in names
        users_payload = archive.read("users.json").decode()
        assert "tester@horizon.com" in users_payload
        assert "password_hash" not in users_payload  # never exported


def test_tenant_export_never_includes_another_tenants_data(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_a = _setup_admin(client, platform_admin)

    bootstrap_b = _bootstrap_tenant(
        client, platform_admin, tenant_name="Apex Insurance", admin_email="admin@apex.com"
    )
    _login_and_verify(client, bootstrap_b["tenant"]["id"], "admin@apex.com", "AdminPassw0rd!")
    client.post(
        "/api/v1/users",
        json={
            "email": "apex-only@apex.com",
            "name": "Apex Only",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )

    _login_and_verify(client, tenant_a, "admin@horizon.com", "AdminPassw0rd!")
    job_id = client.post("/api/v1/export").json()["data"]["job_id"]
    job_service.run_once(db_session)

    download = client.get(f"/api/v1/export/jobs/{job_id}/download")
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        users_payload = archive.read("users.json").decode()
    assert "apex-only@apex.com" not in users_payload


def test_export_requires_settings_manage_permission(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    _login_and_verify(client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert client.post("/api/v1/export").status_code == 403


# ---------------------------------------------------------------------------
# 5. SSO (OIDC) (PV-11.1) -- validated against a stub IdP, not a real one.
# ---------------------------------------------------------------------------

_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk_from_rsa(key) -> dict:
    pub = key.public_key().public_numbers()
    import base64

    def b64url(n: int) -> str:
        raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return {
        "kty": "RSA",
        "kid": "test-key",
        "use": "sig",
        "alg": "RS256",
        "n": b64url(pub.n),
        "e": b64url(pub.e),
    }


class _FakeResponse:
    def __init__(self, json_data: dict) -> None:
        self._json = json_data

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self._json


def _fake_discovery(issuer: str) -> dict:
    return {
        "authorization_endpoint": f"{issuer}/authorize",
        "token_endpoint": f"{issuer}/token",
        "jwks_uri": f"{issuer}/jwks",
    }


def test_sso_status_is_public_and_defaults_to_disabled(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    client.post("/api/v1/auth/logout")
    response = client.get(f"/api/v1/auth/sso/{tenant_id}/status")
    assert response.status_code == 200
    assert response.json()["data"]["enabled"] is False


def test_sso_config_requires_sso_manage_permission(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    _login_and_verify(client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    response = client.put(
        "/api/v1/sso/config",
        json={
            "enabled": True,
            "issuer": "https://idp.example.com",
            "client_id": "abc",
            "client_secret": "shh",
        },
    )
    assert response.status_code == 403


def test_sso_full_login_flow_against_stub_idp_provisions_and_logs_in(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id = _setup_admin(client, platform_admin)

    with patch("app.services.sso_service._fetch_discovery", side_effect=_fake_discovery):
        config_response = client.put(
            "/api/v1/sso/config",
            json={
                "enabled": True,
                "issuer": "https://idp.example.com",
                "client_id": "qtesthub-client",
                "client_secret": "super-secret",
                "default_role_code": "tester",
            },
        )
        assert config_response.status_code == 200, config_response.text

    client.post("/api/v1/auth/logout")

    status = client.get(f"/api/v1/auth/sso/{tenant_id}/status").json()["data"]
    assert status["enabled"] is True

    id_token = jwt.encode(
        {"email": "ssouser@horizon.com", "name": "SSO User", "aud": "qtesthub-client", "iss": "https://idp.example.com"},
        _RSA_KEY,
        algorithm="RS256",
        headers={"kid": "test-key"},
    )

    class _FakeJwksClient:
        def __init__(self, jwks_uri: str) -> None:
            self.jwks_uri = jwks_uri

        def get_signing_key_from_jwt(self, token: str):
            class _Key:
                key = _RSA_KEY.public_key()

            return _Key()

    token_response = _FakeResponse({"id_token": id_token})
    with (
        patch("app.services.sso_service._fetch_discovery", side_effect=_fake_discovery),
        patch("app.services.sso_service.httpx.post", return_value=token_response),
        patch("app.services.sso_service.jwt.PyJWKClient", _FakeJwksClient),
    ):
        login_redirect = client.get(f"/api/v1/auth/sso/{tenant_id}/login", follow_redirects=False)
        assert login_redirect.status_code in (302, 307)
        state_cookie = login_redirect.cookies.get("qth_sso_state")
        assert state_cookie

        callback = client.get(
            f"/api/v1/auth/sso/{tenant_id}/callback",
            params={"code": "fake-code", "state": state_cookie},
            cookies={"qth_sso_state": state_cookie},
            follow_redirects=False,
        )
        assert callback.status_code in (302, 307), callback.text

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["data"]["email"] == "ssouser@horizon.com"
    assert me.json()["data"]["role"] == "tester"


def test_sso_callback_rejects_mismatched_state(client: TestClient, platform_admin: dict) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    with patch("app.services.sso_service._fetch_discovery", side_effect=_fake_discovery):
        client.put(
            "/api/v1/sso/config",
            json={
                "enabled": True,
                "issuer": "https://idp.example.com",
                "client_id": "abc",
                "client_secret": "shh",
            },
        )
    client.post("/api/v1/auth/logout")

    response = client.get(
        f"/api/v1/auth/sso/{tenant_id}/callback",
        params={"code": "x", "state": "attacker-supplied"},
        cookies={"qth_sso_state": "a-different-value"},
        follow_redirects=False,
    )
    assert response.status_code == 401


def test_password_login_still_works_once_sso_is_configured(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    with patch("app.services.sso_service._fetch_discovery", side_effect=_fake_discovery):
        client.put(
            "/api/v1/sso/config",
            json={
                "enabled": True,
                "issuer": "https://idp.example.com",
                "client_id": "abc",
                "client_secret": "shh",
            },
        )
    client.post("/api/v1/auth/logout")
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    assert client.get("/api/v1/auth/me").status_code == 200


# ---------------------------------------------------------------------------
# 6. SCIM 2.0 provisioning (PV-11.2) -- validated against the spec's
#    documented shapes, not a real IdP's SCIM client.
# ---------------------------------------------------------------------------


def _scim_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_scim_token_creation_and_bearer_auth(client: TestClient, platform_admin: dict) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    created = client.post("/api/v1/scim-tokens")
    assert created.status_code == 200, created.text
    token = created.json()["data"]["token"]

    unauthed = client.get(f"/api/v1/scim/v2/{tenant_id}/Users")
    assert unauthed.status_code == 401

    wrong_token = client.get(
        f"/api/v1/scim/v2/{tenant_id}/Users", headers=_scim_headers("not-the-token")
    )
    assert wrong_token.status_code == 401

    authed = client.get(f"/api/v1/scim/v2/{tenant_id}/Users", headers=_scim_headers(token))
    assert authed.status_code == 200, authed.text
    assert authed.json()["schemas"] == ["urn:ietf:params:scim:api:messages:2.0:ListResponse"]


def test_scim_create_list_patch_and_deactivate_user(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    token = client.post("/api/v1/scim-tokens").json()["data"]["token"]
    headers = _scim_headers(token)

    create = client.post(
        f"/api/v1/scim/v2/{tenant_id}/Users",
        headers=headers,
        json={"userName": "newscim@horizon.com", "displayName": "New SCIM User", "active": True},
    )
    assert create.status_code == 201, create.text
    scim_user = create.json()
    assert scim_user["userName"] == "newscim@horizon.com"
    user_id = scim_user["id"]

    listing = client.get(f"/api/v1/scim/v2/{tenant_id}/Users", headers=headers)
    assert any(r["id"] == user_id for r in listing.json()["Resources"])

    patch_response = client.patch(
        f"/api/v1/scim/v2/{tenant_id}/Users/{user_id}",
        headers=headers,
        json={"Operations": [{"op": "replace", "path": "active", "value": False}]},
    )
    assert patch_response.status_code == 200, patch_response.text
    assert patch_response.json()["active"] is False

    # DELETE deprovisions (deactivates) -- never a hard delete.
    delete_response = client.delete(
        f"/api/v1/scim/v2/{tenant_id}/Users/{user_id}", headers=headers
    )
    assert delete_response.status_code == 204

    still_there = client.get(f"/api/v1/scim/v2/{tenant_id}/Users/{user_id}", headers=headers)
    assert still_there.status_code == 200
    assert still_there.json()["active"] is False


def test_scim_is_isolated_per_tenant(client: TestClient, platform_admin: dict) -> None:
    _setup_admin(client, platform_admin)
    token_a = client.post("/api/v1/scim-tokens").json()["data"]["token"]

    bootstrap_b = _bootstrap_tenant(
        client, platform_admin, tenant_name="Apex Insurance", admin_email="admin@apex.com"
    )
    tenant_b = bootstrap_b["tenant"]["id"]

    # Tenant A's token must not authenticate against tenant B's SCIM URL.
    cross_tenant = client.get(f"/api/v1/scim/v2/{tenant_b}/Users", headers=_scim_headers(token_a))
    assert cross_tenant.status_code == 401


def test_scim_token_revocation(client: TestClient, platform_admin: dict) -> None:
    tenant_id = _setup_admin(client, platform_admin)
    created = client.post("/api/v1/scim-tokens").json()["data"]
    token, token_id = created["token"], created["id"]

    assert client.get(
        f"/api/v1/scim/v2/{tenant_id}/Users", headers=_scim_headers(token)
    ).status_code == 200

    revoke = client.delete(f"/api/v1/scim-tokens/{token_id}")
    assert revoke.status_code == 200, revoke.text

    assert client.get(
        f"/api/v1/scim/v2/{tenant_id}/Users", headers=_scim_headers(token)
    ).status_code == 401
