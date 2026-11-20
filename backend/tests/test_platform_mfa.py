"""ADR-074: Platform Admin session + TOTP MFA (replaces HTTP Basic)."""

import base64
import threading
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import totp
from app.core.crypto import decrypt_secret
from app.core.rate_limit import limiter
from app.main import app
from tests.platform_helpers import (
    COOKIE_NAME,
    ENROLMENT_CODE,
    PLATFORM_EMAIL,
    PLATFORM_PASSWORD,
    PLATFORM_TOTP_SECRET,
    cookie_from,
    current_code,
    headers_for,
    seed_admin,
    sign_in,
)

LOGIN = "/api/v1/platform/auth/login"
VERIFY = "/api/v1/platform/auth/mfa/verify"
ENROL_START = "/api/v1/platform/auth/mfa/enroll/start"
ENROL_VERIFY = "/api/v1/platform/auth/mfa/enroll/verify"
ME = "/api/v1/platform/auth/me"
LOGOUT = "/api/v1/platform/auth/logout"
TENANTS = "/api/v1/platform/tenants"


def _login(client: TestClient, email: str = PLATFORM_EMAIL, password: str = PLATFORM_PASSWORD):
    return client.post(LOGIN, json={"email": email, "password": password})


def _pre_mfa_headers(
    client: TestClient, email: str = PLATFORM_EMAIL, password: str = PLATFORM_PASSWORD
) -> dict[str, str]:
    response = _login(client, email, password)
    assert response.status_code == 200, response.text
    token = cookie_from(response)
    assert token
    return headers_for(token)


def _away_from_step_boundary(margin: float = 4.0) -> None:
    """Avoid a code generated just before a 30 s rollover being checked just
    after it (makes the +-1 window assertions deterministic)."""
    remaining = totp.PERIOD_SECONDS - (time.time() % totp.PERIOD_SECONDS)
    if remaining < margin:
        time.sleep(remaining + 0.2)


def _enrol(
    client: TestClient,
    email: str = PLATFORM_EMAIL,
    password: str = PLATFORM_PASSWORD,
    enrolment_code: str = ENROLMENT_CODE,
) -> tuple[dict[str, str], str, list[str]]:
    """Walks an un-enrolled admin through enrolment; returns (full-session
    headers, secret, recovery codes)."""
    pre = _pre_mfa_headers(client, email, password)
    start = client.post(ENROL_START, json={"enrolment_code": enrolment_code}, headers=pre)
    assert start.status_code == 200, start.text
    secret = start.json()["data"]["secret"]
    finish = client.post(
        ENROL_VERIFY,
        json={"code": totp.generate_code(secret), "enrolment_code": enrolment_code},
        headers=pre,
    )
    assert finish.status_code == 200, finish.text
    token = cookie_from(finish)
    assert token
    return headers_for(token), secret, finish.json()["data"]["recovery_codes"]


# --- TOTP primitive (RFC 6238 appendix B, SHA-1, last 6 of the 8-digit values) ---

_RFC_SECRET = base64.b32encode(b"12345678901234567890").decode().rstrip("=")


@pytest.mark.parametrize(
    "at,expected",
    [
        (59, "287082"),
        (1111111109, "081804"),
        (1111111111, "050471"),
        (1234567890, "005924"),
        (2000000000, "279037"),
        (20000000000, "353130"),
    ],
)
def test_totp_matches_rfc_6238_vectors(at: int, expected: str) -> None:
    assert totp.generate_code(_RFC_SECRET, at) == expected


def test_totp_window_and_replay_rules() -> None:
    at = 1111111109
    step = totp.time_step(at)
    code = totp.generate_code(_RFC_SECRET, at)
    assert totp.verify_totp(_RFC_SECRET, code, at=at) == step
    # one step either side is tolerated, two is not
    assert totp.verify_totp(_RFC_SECRET, code, at=at + 30) == step
    assert totp.verify_totp(_RFC_SECRET, code, at=at - 30) == step
    assert totp.verify_totp(_RFC_SECRET, code, at=at + 90) is None
    # a step that was already used (or an older one) is never accepted again
    assert totp.verify_totp(_RFC_SECRET, code, at=at, last_used_step=step) is None
    assert totp.verify_totp(_RFC_SECRET, code, at=at, last_used_step=step - 1) == step
    # malformed input
    for bad in ("", "12345", "1234567", "abcdef", "12 456", "١٢٣٤٥٦"):
        assert totp.verify_totp(_RFC_SECRET, bad, at=at) is None


# --- enrolment ---------------------------------------------------------------


def test_enrolment_happy_path_and_storage(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    pre = _pre_mfa_headers(client)

    # Password alone is not enough for any platform API route.
    assert client.get(TENANTS, headers=pre).status_code == 401
    me = client.get(ME, headers=pre).json()["data"]
    assert me == {
        "email": PLATFORM_EMAIL,
        "stage": "password_ok",
        "mfa_enrolled": False,
        "recovery_codes_remaining": None,
        "step_up_expires_at": None,
    }

    start = client.post(ENROL_START, json={"enrolment_code": ENROLMENT_CODE}, headers=pre)
    assert start.status_code == 200, start.text
    data = start.json()["data"]
    assert data["otpauth_uri"].startswith("otpauth://totp/QTestHub%3Aowner%40qtesthub.local?")
    assert f"secret={data['secret']}" in data["otpauth_uri"]
    assert "issuer=QTestHub" in data["otpauth_uri"]

    # Pending secret is stored encrypted and grants nothing yet.
    with owner_engine.begin() as conn:
        row = conn.execute(
            text("SELECT mfa_secret_encrypted, mfa_enabled_at FROM platform_admins")
        ).one()
    assert row.mfa_enabled_at is None
    assert row.mfa_secret_encrypted and data["secret"] not in row.mfa_secret_encrypted
    assert decrypt_secret(row.mfa_secret_encrypted) == data["secret"]
    assert client.get(TENANTS, headers=pre).status_code == 401

    finish = client.post(
        ENROL_VERIFY,
        json={"code": totp.generate_code(data["secret"]), "enrolment_code": ENROLMENT_CODE},
        headers=pre,
    )
    assert finish.status_code == 200, finish.text
    body = finish.json()["data"]
    assert body["stage"] == "mfa_verified"
    codes = body["recovery_codes"]
    assert len(codes) == 10 and len(set(codes)) == 10
    assert all(len(c) == 19 and c.count("-") == 3 for c in codes)

    full = headers_for(cookie_from(finish))
    assert cookie_from(finish) not in pre["Cookie"]  # rotated, not reused
    assert client.get(TENANTS, headers=full).status_code == 200
    # the pre-MFA session was revoked by the promotion
    assert client.get(ME, headers=pre).status_code == 401

    # Recovery codes are stored hashed (SHA-256 hex), never in plaintext.
    with owner_engine.begin() as conn:
        hashes = [
            r[0] for r in conn.execute(text("SELECT code_hash FROM platform_admin_recovery_codes"))
        ]
        enabled, code_hash, code_expiry = conn.execute(
            text(
                "SELECT mfa_enabled_at, enrolment_code_hash, enrolment_code_expires_at "
                "FROM platform_admins"
            )
        ).one()
    assert enabled is not None
    assert code_hash is None and code_expiry is None  # consumed by the enrolment
    assert len(hashes) == 10
    assert all(len(h) == 64 and h not in codes for h in hashes)
    assert not any(c.replace("-", "") in h for c in codes for h in hashes)

    # Enrolment cannot be restarted (or secrets swapped) once enabled.
    again = client.post(
        ENROL_START, json={"enrolment_code": ENROLMENT_CODE}, headers=_pre_mfa_headers(client)
    )
    assert again.status_code == 409


def test_wrong_authenticator_code_does_not_enable_mfa(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    pre = _pre_mfa_headers(client)
    client.post(ENROL_START, json={"enrolment_code": ENROLMENT_CODE}, headers=pre)
    bad = client.post(
        ENROL_VERIFY, json={"code": "000000", "enrolment_code": ENROLMENT_CODE}, headers=pre
    )
    assert bad.status_code == 401
    with owner_engine.begin() as conn:
        assert conn.execute(text("SELECT mfa_enabled_at FROM platform_admins")).scalar_one() is None


def test_enrol_verify_without_start_is_rejected(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    pre = _pre_mfa_headers(client)
    response = client.post(
        ENROL_VERIFY, json={"code": "123456", "enrolment_code": ENROLMENT_CODE}, headers=pre
    )
    assert response.status_code == 422


def test_unenrolled_admin_cannot_use_the_verify_step(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine, totp_secret=None)
    pre = _pre_mfa_headers(client)
    response = client.post(VERIFY, json={"code": "123456"}, headers=pre)
    assert response.status_code == 401
    assert "enrolment" in response.json()["error"]["message"].lower()


# --- sign-in with TOTP ---------------------------------------------------------


def test_sign_in_with_a_valid_code_grants_access(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    assert client.get(TENANTS, headers=headers).status_code == 200
    me = client.get(ME, headers=headers).json()["data"]
    assert me["stage"] == "mfa_verified" and me["recovery_codes_remaining"] == 0


def test_wrong_code_is_rejected_and_password_only_session_gets_nothing(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    pre = _pre_mfa_headers(client)
    assert client.post(VERIFY, json={"code": "000000"}, headers=pre).status_code == 401
    assert client.get(TENANTS, headers=pre).status_code == 401


def test_replayed_code_is_rejected_but_the_next_step_is_accepted(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    _away_from_step_boundary()
    sign_in(client)  # consumes the current step's code
    replay = client.post(VERIFY, json={"code": current_code()}, headers=_pre_mfa_headers(client))
    assert replay.status_code == 401
    nxt = client.post(
        VERIFY, json={"code": current_code(offset_steps=1)}, headers=_pre_mfa_headers(client)
    )
    assert nxt.status_code == 200, nxt.text


@pytest.mark.parametrize("offset,ok", [(-1, True), (1, True), (-2, False), (2, False)])
def test_code_window_tolerance(client: TestClient, owner_engine, offset: int, ok: bool) -> None:
    seed_admin(owner_engine)
    _away_from_step_boundary()
    response = client.post(
        VERIFY,
        json={"code": current_code(offset_steps=offset)},
        headers=_pre_mfa_headers(client),
    )
    assert (response.status_code == 200) is ok, response.text


def test_both_or_neither_credential_is_a_validation_error(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    pre = _pre_mfa_headers(client)
    assert client.post(VERIFY, json={}, headers=pre).status_code == 422
    both = client.post(VERIFY, json={"code": "123456", "recovery_code": "AAAA"}, headers=pre)
    assert both.status_code == 422


def test_two_simultaneous_verifications_with_one_code_only_succeed_once(owner_engine) -> None:
    seed_admin(owner_engine)
    clients = [TestClient(app), TestClient(app)]
    pre = [_pre_mfa_headers(c) for c in clients]
    _away_from_step_boundary()
    code = current_code()
    results: list[int] = []
    barrier = threading.Barrier(2)

    def attempt(c: TestClient, headers: dict[str, str]) -> None:
        barrier.wait()
        results.append(c.post(VERIFY, json={"code": code}, headers=headers).status_code)

    threads = [
        threading.Thread(target=attempt, args=(c, h)) for c, h in zip(clients, pre, strict=True)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200, 401], results


# --- recovery codes ------------------------------------------------------------


def test_recovery_code_is_single_use(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    _, _, codes = _enrol(client)

    first = client.post(VERIFY, json={"recovery_code": codes[0]}, headers=_pre_mfa_headers(client))
    assert first.status_code == 200, first.text
    assert first.json()["data"]["recovery_codes_remaining"] == 9

    reuse = client.post(VERIFY, json={"recovery_code": codes[0]}, headers=_pre_mfa_headers(client))
    assert reuse.status_code == 401

    # case/hyphen-insensitive entry works for an unused code
    lowered = codes[1].lower().replace("-", " ")
    second = client.post(VERIFY, json={"recovery_code": lowered}, headers=_pre_mfa_headers(client))
    assert second.status_code == 200, second.text


# --- lockout -------------------------------------------------------------------


def test_repeated_wrong_codes_lock_the_account_and_kill_sessions(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    full = sign_in(client)
    assert client.get(TENANTS, headers=full).status_code == 200

    pre = _pre_mfa_headers(client)
    statuses = [
        client.post(VERIFY, json={"code": "000000"}, headers=pre).status_code for _ in range(5)
    ]
    assert statuses == [401] * 5
    last = client.post(VERIFY, json={"code": "000000"}, headers=pre)
    assert last.status_code == 401

    locked = _login(client)
    assert locked.status_code == 401 and "locked" in locked.json()["error"]["message"].lower()
    assert client.get(TENANTS, headers=full).status_code == 401  # existing session revoked


# --- session lifetime ----------------------------------------------------------


def test_expired_and_idle_sessions_are_rejected(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    assert client.get(TENANTS, headers=headers).status_code == 200

    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_sessions SET last_seen_at = :t"),
            {"t": datetime.now(UTC) - timedelta(minutes=31)},
        )
    assert client.get(TENANTS, headers=headers).status_code == 401  # idle timeout

    headers = sign_in(client, at=time.time() + 30)
    assert client.get(TENANTS, headers=headers).status_code == 200
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_sessions SET expires_at = :t"),
            {"t": datetime.now(UTC) - timedelta(seconds=1)},
        )
    assert client.get(TENANTS, headers=headers).status_code == 401  # absolute expiry


def test_pre_mfa_session_expires_quickly(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    pre = _pre_mfa_headers(client)
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_sessions SET expires_at = :t"),
            {"t": datetime.now(UTC) - timedelta(seconds=1)},
        )
    response = client.post(VERIFY, json={"code": current_code()}, headers=pre)
    assert response.status_code == 401


def test_logout_invalidates_the_session_and_clears_the_cookie(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    out = client.post(LOGOUT, headers=headers)
    assert out.status_code == 200
    assert any(
        h.startswith(f"{COOKIE_NAME}=") and ("Max-Age=0" in h or "expires=" in h.lower())
        for h in out.headers.get_list("set-cookie")
    )
    assert client.get(TENANTS, headers=headers).status_code == 401
    assert client.get(ME, headers=headers).status_code == 401


def test_session_cookie_attributes(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    response = _login(client)
    cookie = next(h for h in response.headers.get_list("set-cookie") if h.startswith(COOKIE_NAME))
    lowered = cookie.lower()
    assert COOKIE_NAME != "qth_session"
    assert "httponly" in lowered
    assert "samesite=strict" in lowered
    assert "path=/api/v1/platform" in lowered
    # the raw token is never the admin id / a guessable value, and is not stored raw
    token = cookie.split(";", 1)[0].split("=", 1)[1]
    assert len(token) >= 40
    with owner_engine.begin() as conn:
        stored = conn.execute(text("SELECT token_hash FROM platform_sessions")).scalar_one()
    assert stored != token and len(stored) == 64


# --- HTTP Basic and other planes are no longer accepted -------------------------


def _platform_routes() -> list[tuple[str, str]]:
    from fastapi.routing import APIRoute

    out: list[tuple[str, str]] = []
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/v1/platform"):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                out.append((method, route.path))
    return out


_ROUTES = _platform_routes()
# login is the credential exchange itself; logout is idempotent by design.
_SESSION_GUARDED = [
    (m, p)
    for m, p in _ROUTES
    if p
    not in (
        "/api/v1/platform/auth/login",
        "/api/v1/platform/auth/logout",
        # ADR-081: public by design (the target's sessions were revoked); gated by
        # the one-time reset code instead -- see test_platform_password.py.
        "/api/v1/platform/auth/password/reset",
    )
]


def _fill(path: str) -> str:
    out = path
    while "{" in out:
        start = out.index("{")
        end = out.index("}", start)
        out = out[:start] + "00000000-0000-0000-0000-000000000000" + out[end + 1 :]
    return out


def test_route_inventory_is_not_empty() -> None:
    assert len(_SESSION_GUARDED) >= 15


@pytest.mark.parametrize("method,path", _SESSION_GUARDED)
def test_basic_auth_is_rejected_on_every_platform_route(
    client: TestClient, owner_engine, method: str, path: str
) -> None:
    seed_admin(owner_engine)
    import base64 as b64

    basic = b64.b64encode(f"{PLATFORM_EMAIL}:{PLATFORM_PASSWORD}".encode()).decode()
    response = client.request(
        method,
        _fill(path),
        headers={"Authorization": f"Basic {basic}"},
        json={} if method in ("POST", "PATCH", "PUT") else None,
    )
    assert response.status_code == 401, (method, path, response.status_code, response.text)


@pytest.mark.parametrize("method,path", _SESSION_GUARDED)
def test_no_cookie_is_rejected_on_every_platform_route(
    client: TestClient, method: str, path: str
) -> None:
    response = client.request(
        method, _fill(path), json={} if method in ("POST", "PATCH", "PUT") else None
    )
    assert response.status_code == 401, (method, path, response.status_code, response.text)


def test_password_only_session_is_rejected_on_every_guarded_route(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    pre = _pre_mfa_headers(client)
    for method, path in _SESSION_GUARDED:
        if path.startswith("/api/v1/platform/auth/"):
            continue  # those routes are exactly what a pre-MFA session is for
        response = client.request(
            method,
            _fill(path),
            headers=pre,
            json={} if method in ("POST", "PATCH", "PUT") else None,
        )
        assert response.status_code == 401, (method, path, response.status_code)


def test_tenant_and_platform_sessions_are_not_interchangeable(
    client: TestClient, platform_admin: dict
) -> None:
    from tests.test_auth_flow import _bootstrap_tenant, _login_and_verify

    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_client = TestClient(app)
    _login_and_verify(
        tenant_client, bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!"
    )

    # A tenant admin's session cookie opens nothing on the platform plane ...
    assert tenant_client.get(TENANTS).status_code == 401
    # ... and a platform session cookie opens nothing on the tenant plane.
    platform_only = TestClient(app)
    assert (
        platform_only.get("/api/v1/auth/me", headers=platform_admin["headers"]).status_code == 401
    )


# --- CSRF / origin --------------------------------------------------------------


def test_cross_origin_state_changing_requests_are_rejected(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    evil = {"Origin": "https://evil.example.com"}
    login = client.post(
        LOGIN, json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}, headers=evil
    )
    assert login.status_code == 403

    full = sign_in(client)
    forged = client.post(
        TENANTS,
        headers={**full, **evil},
        json={
            "tenant_name": "X",
            "admin_name": "X",
            "admin_email": "x@example.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert forged.status_code == 403
    # a configured origin is fine
    allowed = client.post(
        LOGIN,
        json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
        headers={"Origin": "http://localhost:5173"},
    )
    assert allowed.status_code == 200


# --- admin lifecycle interaction ---------------------------------------------------


def test_new_admin_must_enrol_on_first_sign_in(client: TestClient, platform_admin: dict) -> None:
    created = client.post(
        "/api/v1/platform/admins",
        headers=platform_admin["headers"],
        json={"email": "second@example.com", "password": "SecondAdmin123!"},
    )
    assert created.status_code == 200, created.text
    assert created.json()["data"]["mfa_enabled"] is False
    code = created.json()["data"]["enrolment_code"]
    assert code and len(code.replace("-", "")) == 20

    login = _login(client, "second@example.com", "SecondAdmin123!")
    assert login.json()["data"]["mfa_enrolled"] is False
    pre = headers_for(cookie_from(login))
    assert client.get(TENANTS, headers=pre).status_code == 401
    # password alone gets nothing; the code from the creation response does
    assert client.post(ENROL_START, json={"enrolment_code": "X"}, headers=pre).status_code == 401
    full, _, _ = _enrol(
        TestClient(app), "second@example.com", "SecondAdmin123!", enrolment_code=code
    )
    assert client.get(TENANTS, headers=full).status_code == 200
    listing = client.get("/api/v1/platform/admins", headers=platform_admin["headers"]).json()[
        "data"
    ]
    flags = {a["email"]: a["mfa_enabled"] for a in listing["items"]}
    assert flags == {PLATFORM_EMAIL: True, "second@example.com": True}


def test_deactivating_an_admin_ends_their_session(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, "second@example.com", "SecondAdmin123!", PLATFORM_TOTP_SECRET)
    second = sign_in(TestClient(app), "second@example.com", "SecondAdmin123!", at=time.time() + 30)
    assert client.get(TENANTS, headers=second).status_code == 200

    admins = client.get("/api/v1/platform/admins", headers=platform_admin["headers"]).json()["data"]
    second_id = next(a["id"] for a in admins["items"] if a["email"] == "second@example.com")
    off = client.patch(
        f"/api/v1/platform/admins/{second_id}",
        headers=platform_admin["headers"],
        json={"is_active": False},
    )
    assert off.status_code == 200
    assert client.get(TENANTS, headers=second).status_code == 401


def test_changing_an_admins_password_ends_their_sessions(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, "second@example.com", "SecondAdmin123!", PLATFORM_TOTP_SECRET)
    second = sign_in(TestClient(app), "second@example.com", "SecondAdmin123!", at=time.time() + 30)
    assert client.get(TENANTS, headers=second).status_code == 200

    reset = client.post(
        "/api/v1/platform/admins",
        headers=platform_admin["headers"],
        json={"email": "second@example.com", "password": "BrandNewPass123!"},
    )
    assert reset.status_code == 200
    assert client.get(TENANTS, headers=second).status_code == 401


def test_admin_can_reset_another_admins_mfa_but_not_their_own(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, "second@example.com", "SecondAdmin123!", PLATFORM_TOTP_SECRET)
    second = sign_in(TestClient(app), "second@example.com", "SecondAdmin123!", at=time.time() + 30)
    admins = client.get("/api/v1/platform/admins", headers=platform_admin["headers"]).json()["data"]
    ids = {a["email"]: a["id"] for a in admins["items"]}

    own = client.post(
        f"/api/v1/platform/admins/{ids[PLATFORM_EMAIL]}/reset-mfa",
        headers=platform_admin["headers"],
    )
    assert own.status_code == 409

    done = client.post(
        f"/api/v1/platform/admins/{ids['second@example.com']}/reset-mfa",
        headers=platform_admin["headers"],
    )
    assert done.status_code == 200 and done.json()["data"]["mfa_enabled"] is False
    fresh = done.json()["data"]["enrolment_code"]
    assert fresh and done.json()["data"]["enrolment_code_active"] is True
    assert client.get(TENANTS, headers=second).status_code == 401  # sessions revoked
    relogin = _login(client, "second@example.com", "SecondAdmin123!")
    assert relogin.json()["data"]["mfa_enrolled"] is False  # must re-enrol
    pre = headers_for(cookie_from(relogin))
    # the reset leaves no code but the fresh one: the admin must use it
    assert (
        client.post(ENROL_START, json={"enrolment_code": ENROLMENT_CODE}, headers=pre).status_code
        == 401
    )
    with owner_engine.begin() as conn:
        left = conn.execute(
            text(
                "SELECT count(*) FROM platform_admin_recovery_codes c "
                "JOIN platform_admins a ON a.id = c.admin_id WHERE a.email = 'second@example.com'"
            )
        ).scalar_one()
    assert left == 0
    _enrol(TestClient(app), "second@example.com", "SecondAdmin123!", enrolment_code=fresh)


# --- throttling ---------------------------------------------------------------------


def test_login_and_mfa_endpoints_are_rate_limited(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    limiter.enabled = True
    limiter.reset()
    try:
        statuses = [
            client.post(LOGIN, json={"email": "nobody@example.com", "password": "x"}).status_code
            for _ in range(11)
        ]
    finally:
        limiter.enabled = False
        limiter.reset()
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


# --- operator tooling ---------------------------------------------------------------


def test_seed_with_totp_secret_is_refused_in_production(monkeypatch, owner_engine) -> None:
    import scripts.seed_platform_admin as seed_script
    from app.core.config import get_settings

    monkeypatch.setattr(
        seed_script,
        "get_settings",
        lambda: get_settings().model_copy(update={"environment": "production"}),
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "seed",
            "--email",
            "a@example.com",
            "--password",
            "SomePass123!",
            "--totp-secret",
            PLATFORM_TOTP_SECRET,
        ],
    )
    with pytest.raises(SystemExit) as exc:
        seed_script.main()
    assert "production" in str(exc.value)
    with owner_engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM platform_admins")).scalar_one() == 0


def test_reset_script_clears_mfa(client: TestClient, owner_engine, monkeypatch, capsys) -> None:
    import scripts.reset_platform_admin_mfa as reset_script

    seed_admin(owner_engine)
    headers = sign_in(client)
    monkeypatch.setattr("sys.argv", ["reset", "--email", PLATFORM_EMAIL])
    reset_script.main()
    printed = capsys.readouterr().out.strip().splitlines()[-1].rsplit(": ", 1)[1]
    with owner_engine.begin() as conn:
        row = conn.execute(
            text("SELECT mfa_secret_encrypted, mfa_enabled_at FROM platform_admins")
        ).one()
    assert row.mfa_secret_encrypted is None and row.mfa_enabled_at is None
    assert client.get(TENANTS, headers=headers).status_code == 401
    assert _login(client).json()["data"]["mfa_enrolled"] is False
    full, _, _ = _enrol(client, enrolment_code=printed)  # the CLI-printed code works
    assert client.get(TENANTS, headers=full).status_code == 200


# --- one-time enrolment code (ADR-080) -------------------------------------------------

ENROL_ERROR = "Invalid or expired enrolment code"
_SECOND = ("second@example.com", "SecondAdmin123!")


def _admin_row(owner_engine, email: str = PLATFORM_EMAIL):
    with owner_engine.begin() as conn:
        return conn.execute(
            text(
                "SELECT mfa_secret_encrypted, mfa_enabled_at, mfa_failed_count, "
                "enrolment_code_hash, enrolment_code_expires_at FROM platform_admins "
                "WHERE email = :e"
            ),
            {"e": email},
        ).one()


@pytest.fixture
def security_log(caplog):
    """Alembic's fileConfig (test DB setup) disables existing loggers and the
    app replaces the root handlers, so re-enable the app logger and attach
    caplog's handler to it directly."""
    import logging

    app_logger = logging.getLogger("qtesthub")
    was_disabled = app_logger.disabled
    app_logger.disabled = False
    app_logger.addHandler(caplog.handler)
    caplog.set_level("WARNING", logger="qtesthub")
    yield caplog
    app_logger.removeHandler(caplog.handler)
    app_logger.disabled = was_disabled


def _start(client: TestClient, pre: dict[str, str], code: str | None):
    return client.post(ENROL_START, json={"enrolment_code": code}, headers=pre)


def test_enrolment_is_blocked_when_no_code_was_ever_issued(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine, totp_secret=None)  # e.g. un-enrolled at migration time
    pre = _pre_mfa_headers(client)
    for attempt in (ENROLMENT_CODE, "anything-at-all"):
        response = _start(client, pre, attempt)
        assert response.status_code == 401
        assert response.json()["error"]["message"] == ENROL_ERROR
    # no secret / QR material was issued to a password-only session
    assert _admin_row(owner_engine).mfa_secret_encrypted is None
    # a missing field is a validation error, not a way around the check
    assert client.post(ENROL_START, json={}, headers=pre).status_code == 422
    assert client.post(ENROL_START, headers=pre).status_code == 422
    assert client.post(ENROL_VERIFY, json={"code": "123456"}, headers=pre).status_code == 422


def test_wrong_enrolment_code_is_rejected_generically_and_counts_towards_lockout(
    client: TestClient, owner_engine, security_log
) -> None:
    caplog = security_log
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    pre = _pre_mfa_headers(client)
    with caplog.at_level("WARNING", logger="qtesthub"):
        first = _start(client, pre, "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ")
    assert first.status_code == 401 and first.json()["error"]["message"] == ENROL_ERROR
    assert "security_event=platform_admin_enrolment_code_failed" in caplog.text
    row = _admin_row(owner_engine)
    assert row.mfa_failed_count == 1 and row.mfa_secret_encrypted is None
    assert row.enrolment_code_hash is not None  # a failed guess does not burn the code

    # the real code still works after a wrong guess (failures do not consume it)
    ok = _start(client, pre, ENROLMENT_CODE)
    assert ok.status_code == 200 and ok.json()["data"]["secret"]

    # ...and wrong guesses lock the account exactly like wrong MFA codes
    for _ in range(3):
        assert _start(client, pre, "BAD").status_code == 401
    locked = _start(client, pre, "BAD")  # the 5th failure in total
    assert locked.status_code == 401 and "locked" in locked.json()["error"]["message"].lower()
    login = _login(client)
    assert login.status_code == 401 and "locked" in login.json()["error"]["message"].lower()
    assert _admin_row(owner_engine).enrolment_code_hash is not None


def test_enrolment_code_formatting_is_forgiving_but_not_loose(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    pre = _pre_mfa_headers(client)
    assert _start(client, pre, ENROLMENT_CODE.lower().replace("-", " ")).status_code == 200
    assert _start(client, pre, ENROLMENT_CODE[:-1]).status_code == 401


def test_expired_enrolment_code_is_rejected(client: TestClient, owner_engine) -> None:
    seed_admin(
        owner_engine,
        totp_secret=None,
        enrolment_code=ENROLMENT_CODE,
        enrolment_valid_for=timedelta(seconds=-5),
    )
    pre = _pre_mfa_headers(client)
    response = _start(client, pre, ENROLMENT_CODE)
    assert response.status_code == 401 and response.json()["error"]["message"] == ENROL_ERROR
    assert _admin_row(owner_engine).mfa_secret_encrypted is None

    # expiry reached between the two steps also blocks completion
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_admins SET enrolment_code_expires_at = now() + interval '1 hour'")
        )
    started = _start(client, pre, ENROLMENT_CODE)
    assert started.status_code == 200
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_admins SET enrolment_code_expires_at = now() - interval '1 s'")
        )
    finish = client.post(
        ENROL_VERIFY,
        json={
            "code": totp.generate_code(started.json()["data"]["secret"]),
            "enrolment_code": ENROLMENT_CODE,
        },
        headers=pre,
    )
    assert finish.status_code == 401 and finish.json()["error"]["message"] == ENROL_ERROR
    assert _admin_row(owner_engine).mfa_enabled_at is None


def test_completing_enrolment_needs_the_code_even_with_a_valid_authenticator_code(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    pre = _pre_mfa_headers(client)
    secret = _start(client, pre, ENROLMENT_CODE).json()["data"]["secret"]
    finish = client.post(
        ENROL_VERIFY,
        json={"code": totp.generate_code(secret), "enrolment_code": "WRONG-WRONG-WRONG-WRONG"},
        headers=pre,
    )
    assert finish.status_code == 401 and finish.json()["error"]["message"] == ENROL_ERROR
    row = _admin_row(owner_engine)
    assert row.mfa_enabled_at is None and row.mfa_failed_count == 1


def test_enrolment_code_is_single_use(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    full, _, _ = _enrol(client)
    assert client.get(TENANTS, headers=full).status_code == 200
    row = _admin_row(owner_engine)
    assert row.enrolment_code_hash is None and row.enrolment_code_expires_at is None
    # replaying the same code (even from a fresh password-only session) is refused
    replay = _start(client, _pre_mfa_headers(client), ENROLMENT_CODE)
    assert replay.status_code == 409
    assert _admin_row(owner_engine).mfa_secret_encrypted == row.mfa_secret_encrypted


def test_new_admin_code_is_returned_once_stored_hashed_and_never_listed(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    created = client.post(
        "/api/v1/platform/admins",
        headers=platform_admin["headers"],
        json={"email": _SECOND[0], "password": _SECOND[1]},
    ).json()["data"]
    code = created["enrolment_code"]
    assert created["enrolment_code_active"] is True and created["enrolment_code_expires_at"]
    assert all(ch in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789-" for ch in code)

    row = _admin_row(owner_engine, _SECOND[0])
    assert len(row.enrolment_code_hash) == 64
    assert code not in row.enrolment_code_hash
    assert code.replace("-", "") not in row.enrolment_code_hash

    listing = client.get("/api/v1/platform/admins", headers=platform_admin["headers"])
    second = next(a for a in listing.json()["data"]["items"] if a["email"] == _SECOND[0])
    assert second["enrolment_code_active"] is True
    assert "enrolment_code" not in second and "enrolment_code_hash" not in second
    assert code not in listing.text and row.enrolment_code_hash not in listing.text
    owner_item = next(a for a in listing.json()["data"]["items"] if a["email"] == PLATFORM_EMAIL)
    assert owner_item["enrolment_code_active"] is False


def test_enrolment_code_ttl_comes_from_settings(
    client: TestClient, owner_engine, platform_admin: dict, monkeypatch
) -> None:
    from app.services import platform_auth_service as svc

    monkeypatch.setattr(svc.settings, "platform_enrolment_code_ttl_hours", 2)
    client.post(
        "/api/v1/platform/admins",
        headers=platform_admin["headers"],
        json={"email": _SECOND[0], "password": _SECOND[1]},
    )
    expires = _admin_row(owner_engine, _SECOND[0]).enrolment_code_expires_at
    remaining = expires - datetime.now(UTC)
    assert timedelta(hours=1, minutes=55) < remaining <= timedelta(hours=2)


def test_reissue_replaces_the_previous_code(
    client: TestClient, owner_engine, platform_admin: dict, security_log
) -> None:
    caplog = security_log
    created = client.post(
        "/api/v1/platform/admins",
        headers=platform_admin["headers"],
        json={"email": _SECOND[0], "password": _SECOND[1]},
    ).json()["data"]
    old = created["enrolment_code"]
    base = f"/api/v1/platform/admins/{created['id']}/enrolment-code"
    with caplog.at_level("WARNING", logger="qtesthub"):
        again = client.post(base, headers=platform_admin["headers"])
    assert again.status_code == 200, again.text
    new = again.json()["data"]["enrolment_code"]
    assert new and new != old and again.json()["data"]["enrolment_code_active"] is True
    assert "security_event=platform_admin_enrolment_code_issued" in caplog.text
    assert old not in caplog.text and new not in caplog.text

    pre = _pre_mfa_headers(client, *_SECOND)
    assert _start(client, pre, old).status_code == 401  # the old one is dead
    full, _, _ = _enrol(TestClient(app), *_SECOND, enrolment_code=new)
    assert client.get(TENANTS, headers=full).status_code == 200


def test_reissue_is_refused_for_yourself_enrolled_admins_and_strangers(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, _SECOND[0], _SECOND[1], PLATFORM_TOTP_SECRET)  # already enrolled
    admins = client.get("/api/v1/platform/admins", headers=platform_admin["headers"]).json()
    ids = {a["email"]: a["id"] for a in admins["data"]["items"]}
    h = platform_admin["headers"]
    assert (
        client.post(
            f"/api/v1/platform/admins/{ids[PLATFORM_EMAIL]}/enrolment-code", headers=h
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/platform/admins/{ids[_SECOND[0]]}/enrolment-code", headers=h
        ).status_code
        == 409
    )
    missing = "/api/v1/platform/admins/00000000-0000-0000-0000-000000000000/enrolment-code"
    assert client.post(missing, headers=h).status_code == 404
    assert _admin_row(owner_engine, _SECOND[0]).enrolment_code_hash is None


def test_reissue_needs_a_fully_authenticated_platform_session(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    created = client.post(
        "/api/v1/platform/admins",
        headers=platform_admin["headers"],
        json={"email": _SECOND[0], "password": _SECOND[1]},
    ).json()["data"]
    url = f"/api/v1/platform/admins/{created['id']}/enrolment-code"
    assert client.post(url).status_code == 401
    pre = _pre_mfa_headers(TestClient(app), *_SECOND)
    assert client.post(url, headers=pre).status_code == 401


def test_seed_script_issues_a_code_for_unenrolled_admins_only(
    owner_engine, monkeypatch, capsys
) -> None:
    import scripts.seed_platform_admin as seed_script

    monkeypatch.setattr(
        "sys.argv", ["seed", "--email", "a@example.com", "--password", "SomePass123!"]
    )
    seed_script.main()
    printed = capsys.readouterr().out.strip().splitlines()[-1].rsplit(": ", 1)[1]
    assert len(printed.replace("-", "")) == 20
    assert _admin_row(owner_engine, "a@example.com").enrolment_code_hash is not None

    monkeypatch.setattr(
        "sys.argv",
        [
            "seed",
            "--email",
            "b@example.com",
            "--password",
            "SomePass123!",
            "--totp-secret",
            PLATFORM_TOTP_SECRET,
        ],
    )
    seed_script.main()
    assert "enrolment code" not in capsys.readouterr().out.lower()
    row = _admin_row(owner_engine, "b@example.com")
    assert row.mfa_enabled_at is not None and row.enrolment_code_hash is None


def test_tenant_session_and_basic_auth_cannot_enrol(client: TestClient, owner_engine) -> None:
    import base64 as b64

    seed_admin(owner_engine, totp_secret=None, enrolment_code=ENROLMENT_CODE)
    basic = b64.b64encode(f"{PLATFORM_EMAIL}:{PLATFORM_PASSWORD}".encode()).decode()
    for url in (ENROL_START, ENROL_VERIFY):
        response = client.post(
            url,
            json={"code": "123456", "enrolment_code": ENROLMENT_CODE},
            headers={"Authorization": f"Basic {basic}"},
        )
        assert response.status_code == 401
    assert _admin_row(owner_engine).mfa_secret_encrypted is None
