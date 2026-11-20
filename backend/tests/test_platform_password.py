"""ADR-081: Platform Admin self-service password change and admin-initiated
reset (one-time reset code)."""

import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import totp
from app.core.rate_limit import limiter
from app.core.security import verify_password
from app.main import app
from app.services.platform_auth_service import hash_enrolment_code, hash_recovery_code
from tests.platform_helpers import (
    PLATFORM_EMAIL,
    PLATFORM_PASSWORD,
    PLATFORM_TOTP_SECRET,
    cookie_from,
    headers_for,
    seed_admin,
    sign_in,
)

BASE = "/api/v1/platform"
CHANGE = f"{BASE}/auth/password/change"
RESET = f"{BASE}/auth/password/reset"
LOGIN = f"{BASE}/auth/login"
ME = f"{BASE}/auth/me"
TENANTS = f"{BASE}/tenants"
NEW_PASSWORD = "BrandNewPass456!"
OTHER = ("other@example.com", "OtherAdmin123!")


def _next_code(secret: str = PLATFORM_TOTP_SECRET) -> str:
    """A code for the NEXT 30 s step: valid (window +-1) and newer than the
    step the sign-in already consumed."""
    return totp.generate_code(secret, time.time() + totp.PERIOD_SECONDS)


def _row(owner_engine, email: str = PLATFORM_EMAIL):
    with owner_engine.begin() as conn:
        return conn.execute(
            text(
                "SELECT id, password_hash, failed_login_count, locked_until, mfa_failed_count, "
                "password_reset_code_hash, password_reset_code_expires_at "
                "FROM platform_admins WHERE email = :e"
            ),
            {"e": email},
        ).one()


def _free_totp_step(owner_engine, email: str = PLATFORM_EMAIL) -> None:
    """Forget the consumed TOTP step so a test can sign in / verify more than
    once inside one 30 s window (replay protection itself is tested apart)."""
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_admins SET mfa_last_used_step = NULL WHERE email = :e"),
            {"e": email},
        )


def _add_recovery_code(owner_engine, plain: str, email: str = PLATFORM_EMAIL) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO platform_admin_recovery_codes (admin_id, code_hash) "
                "SELECT id, :h FROM platform_admins WHERE email = :e"
            ),
            {"h": hash_recovery_code(plain), "e": email},
        )


def _change(client, headers, current=PLATFORM_PASSWORD, new=NEW_PASSWORD, **extra):
    body = {"current_password": current, "new_password": new}
    body.update(extra or {"code": _next_code()})
    return client.post(CHANGE, json=body, headers=headers)


@pytest.fixture
def security_log(caplog):
    import logging

    app_logger = logging.getLogger("qtesthub")
    was_disabled = app_logger.disabled
    app_logger.disabled = False
    app_logger.addHandler(caplog.handler)
    try:
        yield caplog
    finally:
        app_logger.removeHandler(caplog.handler)
        app_logger.disabled = was_disabled


# --- self-service change ------------------------------------------------------------


def test_change_password_succeeds_keeps_current_session_and_revokes_others(
    client: TestClient, owner_engine, platform_admin: dict, security_log
) -> None:
    _free_totp_step(owner_engine)
    other_session = sign_in(TestClient(app))
    _free_totp_step(owner_engine)
    assert client.get(TENANTS, headers=other_session).status_code == 200
    with security_log.at_level("WARNING", logger="qtesthub"):
        done = _change(client, platform_admin["headers"])
    assert done.status_code == 200, done.text
    assert done.json()["data"] == {"password_changed": True}
    assert "security_event=platform_admin_password_changed" in security_log.text
    for secret in (PLATFORM_PASSWORD, NEW_PASSWORD):
        assert secret not in security_log.text

    row = _row(owner_engine)
    assert verify_password(NEW_PASSWORD, row.password_hash)
    assert not verify_password(PLATFORM_PASSWORD, row.password_hash)
    # the calling session survives, every other one is dead
    assert client.get(TENANTS, headers=platform_admin["headers"]).status_code == 200
    assert client.get(TENANTS, headers=other_session).status_code == 401
    # the old password no longer signs in, the new one does
    assert (
        client.post(
            LOGIN, json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": NEW_PASSWORD}).status_code
        == 200
    )


def test_change_password_with_recovery_code_consumes_it(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    _add_recovery_code(owner_engine, "ABCD-EFGH-JKLM-NPQR")
    done = _change(client, platform_admin["headers"], recovery_code="abcd efgh jklm npqr")
    assert done.status_code == 200, done.text
    with owner_engine.begin() as conn:
        used = conn.execute(text("SELECT used_at FROM platform_admin_recovery_codes")).scalar_one()
    assert used is not None
    again = _change(
        client,
        platform_admin["headers"],
        current=NEW_PASSWORD,
        new="Another789Pass!",
        recovery_code="ABCD-EFGH-JKLM-NPQR",
    )
    assert again.status_code == 401


def test_change_password_wrong_current_password_counts_toward_lockout(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    for attempt in range(1, 5):
        r = _change(client, platform_admin["headers"], current="WrongPassword123!")
        assert r.status_code == 401
        assert _row(owner_engine).failed_login_count == attempt
    assert verify_password(PLATFORM_PASSWORD, _row(owner_engine).password_hash)
    fifth = _change(client, platform_admin["headers"], current="WrongPassword123!")
    assert fifth.status_code == 401
    row = _row(owner_engine)
    assert row.locked_until is not None and row.locked_until > datetime.now(UTC)
    # locked: even the right credentials are refused and the session is gone
    assert client.get(TENANTS, headers=platform_admin["headers"]).status_code == 401
    assert verify_password(PLATFORM_PASSWORD, row.password_hash)


def test_change_password_wrong_code_counts_toward_mfa_lockout_and_changes_nothing(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    bad = _change(client, platform_admin["headers"], code="000000")
    assert bad.status_code == 401
    row = _row(owner_engine)
    assert row.mfa_failed_count == 1
    assert verify_password(PLATFORM_PASSWORD, row.password_hash)
    for _ in range(4):
        _change(client, platform_admin["headers"], code="000000")
    row = _row(owner_engine)
    assert row.locked_until is not None and row.locked_until > datetime.now(UTC)
    assert verify_password(PLATFORM_PASSWORD, row.password_hash)
    assert client.get(TENANTS, headers=platform_admin["headers"]).status_code == 401


def test_change_password_code_is_replay_protected(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    # sign_in already consumed the current step; replaying it must fail
    replay = _change(
        client, platform_admin["headers"], code=totp.generate_code(PLATFORM_TOTP_SECRET)
    )
    assert replay.status_code == 401
    assert verify_password(PLATFORM_PASSWORD, _row(owner_engine).password_hash)


def test_change_password_enforces_policy_and_difference(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    weak = _change(client, platform_admin["headers"], new="short1A")
    assert weak.status_code == 422
    same = _change(client, platform_admin["headers"], new=PLATFORM_PASSWORD)
    assert same.status_code == 422
    assert "differ" in same.text
    row = _row(owner_engine)
    assert verify_password(PLATFORM_PASSWORD, row.password_hash)
    assert row.mfa_failed_count == 0  # neither burned a strike or the TOTP step


def test_change_password_needs_exactly_one_second_factor(
    client: TestClient, platform_admin: dict
) -> None:
    body = {"current_password": PLATFORM_PASSWORD, "new_password": NEW_PASSWORD}
    assert client.post(CHANGE, json=body, headers=platform_admin["headers"]).status_code == 422
    both = {**body, "code": _next_code(), "recovery_code": "AAAA-AAAA-AAAA-AAAA"}
    assert client.post(CHANGE, json=both, headers=platform_admin["headers"]).status_code == 422


def test_change_password_needs_a_fully_authenticated_session(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    body = {"current_password": PLATFORM_PASSWORD, "new_password": NEW_PASSWORD, "code": "123456"}
    assert client.post(CHANGE, json=body).status_code == 401
    login = client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD})
    pre = headers_for(cookie_from(login))
    assert client.post(CHANGE, json=body, headers=pre).status_code == 401
    cross = client.post(CHANGE, json=body, headers={"Origin": "https://evil.example"})
    assert cross.status_code in (401, 403)


# --- admin-initiated reset ----------------------------------------------------------


def _issue(client, headers, admin_id):
    return client.post(f"{BASE}/admins/{admin_id}/password-reset-code", headers=headers)


def _other_id(client, headers) -> str:
    items = client.get(f"{BASE}/admins", headers=headers).json()["data"]["items"]
    return next(a["id"] for a in items if a["email"] == OTHER[0])


def _reset(client, reset_code, new=NEW_PASSWORD, email=OTHER[0], **extra):
    body = {"email": email, "reset_code": reset_code, "new_password": new}
    body.update(extra or {"code": _next_code()})
    return client.post(RESET, json=body)


def test_reset_code_is_issued_once_hashed_listed_without_secrets_and_revokes_sessions(
    client: TestClient, owner_engine, platform_admin: dict, security_log
) -> None:
    seed_admin(owner_engine, *OTHER)
    target = sign_in(TestClient(app), *OTHER)
    assert client.get(TENANTS, headers=target).status_code == 200
    target_id = _other_id(client, platform_admin["headers"])

    with security_log.at_level("WARNING", logger="qtesthub"):
        issued = _issue(client, platform_admin["headers"], target_id)
    assert issued.status_code == 200, issued.text
    data = issued.json()["data"]
    code = data["password_reset_code"]
    assert len(code.replace("-", "")) == 20
    assert all(ch in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789-" for ch in code)
    assert data["password_reset_code_active"] is True and data["password_reset_code_expires_at"]
    assert "security_event=platform_admin_password_reset_code_issued" in security_log.text
    assert code not in security_log.text

    row = _row(owner_engine, OTHER[0])
    assert row.password_reset_code_hash == hash_enrolment_code(code)
    assert code.replace("-", "") not in row.password_reset_code_hash

    # sessions revoked immediately; the old password no longer signs in
    assert client.get(TENANTS, headers=target).status_code == 401
    blocked = client.post(LOGIN, json={"email": OTHER[0], "password": OTHER[1]})
    assert blocked.status_code == 401 and "reset" in blocked.json()["error"]["message"].lower()

    listing = client.get(f"{BASE}/admins", headers=platform_admin["headers"])
    item = next(a for a in listing.json()["data"]["items"] if a["email"] == OTHER[0])
    assert item["password_reset_code_active"] is True
    assert "password_reset_code" not in item and "password_reset_code_hash" not in item
    assert code not in listing.text and row.password_reset_code_hash not in listing.text
    owner_item = next(a for a in listing.json()["data"]["items"] if a["email"] == PLATFORM_EMAIL)
    assert owner_item["password_reset_code_active"] is False


def test_reset_flow_sets_password_consumes_code_and_is_single_use(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER)
    target_id = _other_id(client, platform_admin["headers"])
    code = _issue(client, platform_admin["headers"], target_id).json()["data"][
        "password_reset_code"
    ]
    # forgiving formatting, like the enrolment code
    done = _reset(client, code.lower().replace("-", " "))
    assert done.status_code == 200, done.text
    assert done.json()["data"] == {"password_reset": True}
    row = _row(owner_engine, OTHER[0])
    assert row.password_reset_code_hash is None and row.password_reset_code_expires_at is None
    assert verify_password(NEW_PASSWORD, row.password_hash)
    assert row.failed_login_count == 0
    # the reset does not sign anyone in; a normal sign-in with the new password works
    _free_totp_step(owner_engine, OTHER[0])
    assert sign_in(TestClient(app), OTHER[0], NEW_PASSWORD)
    # replay with the same code is refused
    replay = _reset(client, code, new="Different789Pass!", code="000000")
    assert replay.status_code == 401


def test_reset_with_wrong_or_missing_code_is_generic_counts_toward_lockout_and_keeps_code(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER)
    target_id = _other_id(client, platform_admin["headers"])
    code = _issue(client, platform_admin["headers"], target_id).json()["data"][
        "password_reset_code"
    ]
    stored = _row(owner_engine, OTHER[0]).password_reset_code_hash
    messages = set()
    for attempt in range(1, 5):
        r = _reset(client, "AAAAA-AAAAA-AAAAA-AAAAA")
        assert r.status_code == 401
        messages.add(r.json()["error"]["message"])
        assert _row(owner_engine, OTHER[0]).failed_login_count == attempt
    # unknown email gets the very same message
    unknown = _reset(client, "AAAAA-AAAAA-AAAAA-AAAAA", email="nobody@example.com")
    messages.add(unknown.json()["error"]["message"])
    assert messages == {"Invalid or expired reset code"}
    row = _row(owner_engine, OTHER[0])
    assert row.password_reset_code_hash == stored  # not burned
    assert verify_password(OTHER[1], row.password_hash)
    # fifth failure locks; even the right code is then refused
    _reset(client, "AAAAA-AAAAA-AAAAA-AAAAA")
    assert _row(owner_engine, OTHER[0]).locked_until is not None
    assert _reset(client, code).status_code == 401
    assert verify_password(OTHER[1], _row(owner_engine, OTHER[0]).password_hash)


def test_reset_with_valid_code_but_wrong_authenticator_code_fails_and_keeps_code(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER)
    code = _issue(client, platform_admin["headers"], _other_id(client, platform_admin["headers"]))
    code = code.json()["data"]["password_reset_code"]
    bad = _reset(client, code, code="000000")
    assert bad.status_code == 401
    row = _row(owner_engine, OTHER[0])
    assert row.mfa_failed_count == 1 and row.password_reset_code_hash is not None
    assert verify_password(OTHER[1], row.password_hash)
    missing = client.post(
        RESET, json={"email": OTHER[0], "reset_code": code, "new_password": NEW_PASSWORD}
    )
    assert missing.status_code == 401
    assert _reset(client, code).status_code == 200  # still usable with a good code


def test_reset_for_unenrolled_admin_needs_no_authenticator_code(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER, totp_secret=None)
    code = _issue(client, platform_admin["headers"], _other_id(client, platform_admin["headers"]))
    code = code.json()["data"]["password_reset_code"]
    done = client.post(
        RESET, json={"email": OTHER[0], "reset_code": code, "new_password": NEW_PASSWORD}
    )
    assert done.status_code == 200, done.text


def test_reset_enforces_password_policy_without_burning_the_code(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER)
    code = _issue(client, platform_admin["headers"], _other_id(client, platform_admin["headers"]))
    code = code.json()["data"]["password_reset_code"]
    assert _reset(client, code, new="weak").status_code == 422
    assert _row(owner_engine, OTHER[0]).password_reset_code_hash is not None


def test_expired_reset_code_is_rejected_and_old_password_stays_blocked(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER)
    code = _issue(client, platform_admin["headers"], _other_id(client, platform_admin["headers"]))
    code = code.json()["data"]["password_reset_code"]
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_admins SET password_reset_code_expires_at = :t WHERE email = :e"),
            {"t": datetime.now(UTC) - timedelta(minutes=1), "e": OTHER[0]},
        )
    r = _reset(client, code)
    assert r.status_code == 401 and r.json()["error"]["message"] == "Invalid or expired reset code"
    listing = client.get(f"{BASE}/admins", headers=platform_admin["headers"]).json()["data"]
    item = next(a for a in listing["items"] if a["email"] == OTHER[0])
    assert item["password_reset_code_active"] is False
    # an unused expired code does not quietly re-enable the old password
    assert client.post(LOGIN, json={"email": OTHER[0], "password": OTHER[1]}).status_code == 401
    # re-issuing recovers the account
    new_code = _issue(
        client, platform_admin["headers"], _other_id(client, platform_admin["headers"])
    ).json()["data"]["password_reset_code"]
    assert _reset(client, new_code).status_code == 200


def test_reissue_replaces_the_previous_reset_code(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER)
    target_id = _other_id(client, platform_admin["headers"])
    old = _issue(client, platform_admin["headers"], target_id).json()["data"]["password_reset_code"]
    new = _issue(client, platform_admin["headers"], target_id).json()["data"]["password_reset_code"]
    assert new != old
    assert _reset(client, old).status_code == 401
    assert _reset(client, new).status_code == 200


def test_reset_code_ttl_comes_from_settings(
    client: TestClient, owner_engine, platform_admin: dict, monkeypatch
) -> None:
    from app.services import platform_auth_service as svc

    monkeypatch.setattr(svc.settings, "platform_password_reset_code_ttl_hours", 2)
    seed_admin(owner_engine, *OTHER)
    _issue(client, platform_admin["headers"], _other_id(client, platform_admin["headers"]))
    remaining = _row(owner_engine, OTHER[0]).password_reset_code_expires_at - datetime.now(UTC)
    assert timedelta(hours=1, minutes=55) < remaining <= timedelta(hours=2)


def test_issuing_a_reset_code_is_refused_for_self_strangers_and_unauthenticated(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    h = platform_admin["headers"]
    me = next(
        a["id"]
        for a in client.get(f"{BASE}/admins", headers=h).json()["data"]["items"]
        if a["email"] == PLATFORM_EMAIL
    )
    own = _issue(client, h, me)
    assert own.status_code == 409
    assert _row(owner_engine).password_reset_code_hash is None
    assert client.get(TENANTS, headers=h).status_code == 200  # sessions untouched
    assert _issue(client, h, "00000000-0000-0000-0000-000000000000").status_code == 404
    assert _issue(client, {}, me).status_code == 401


def test_reset_is_refused_for_a_deactivated_admin(
    client: TestClient, owner_engine, platform_admin: dict
) -> None:
    seed_admin(owner_engine, *OTHER)
    target_id = _other_id(client, platform_admin["headers"])
    client.patch(
        f"{BASE}/admins/{target_id}", json={"is_active": False}, headers=platform_admin["headers"]
    )
    assert _issue(client, platform_admin["headers"], target_id).status_code == 409


# --- throttling ---------------------------------------------------------------------


def test_password_endpoints_are_rate_limited(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    limiter.enabled = True
    limiter.reset()
    try:
        statuses = [
            client.post(
                RESET,
                json={
                    "email": "nobody@example.com",
                    "reset_code": "AAAAA-AAAAA-AAAAA-AAAAA",
                    "new_password": NEW_PASSWORD,
                },
            ).status_code
            for _ in range(11)
        ]
    finally:
        limiter.enabled = False
        limiter.reset()
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
