"""ADR-083: Platform Admin session hardening (binding, idle, step-up, own sessions)."""

import json
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import (
    InsecureProductionConfigError,
    Settings,
    get_settings,
    validate_for_production,
)
from app.core.rate_limit import limiter
from tests.platform_helpers import (
    PLATFORM_EMAIL,
    PLATFORM_PASSWORD,
    PLATFORM_TOTP_SECRET,
    age_step_up,
    cookie_from,
    current_code,
    headers_for,
    seed_admin,
    sign_in,
    step_up,
)

BASE = "/api/v1/platform"
AUTH = f"{BASE}/auth"
TENANTS = f"{BASE}/tenants"
ADMINS = f"{BASE}/admins"
OTHER_EMAIL = "other-admin@qtesthub.local"
OTHER_SECRET = "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU"
settings = get_settings()


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()
    yield
    limiter.reset()


def _events(owner_engine, event_type: str) -> list[dict]:
    with owner_engine.begin() as conn:
        return [
            dict(r._mapping)
            for r in conn.execute(
                text(
                    "SELECT * FROM platform_audit_events WHERE event_type = :t ORDER BY created_at"
                ),
                {"t": event_type},
            )
        ]


def _set(owner_engine, sql: str, **params) -> None:
    with owner_engine.begin() as conn:
        conn.execute(text(sql), params)


def _session_row(owner_engine) -> dict:
    with owner_engine.begin() as conn:
        return dict(
            conn.execute(
                text(
                    "SELECT * FROM platform_sessions "
                    "WHERE stage = 'mfa_verified' ORDER BY created_at"
                )
            )
            .first()
            ._mapping
        )


def _login_headers(
    client: TestClient,
    email: str = PLATFORM_EMAIL,
    password: str = PLATFORM_PASSWORD,
    secret: str = PLATFORM_TOTP_SECRET,
    at: float | None = None,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    extra = extra or {}
    login = client.post(f"{AUTH}/login", json={"email": email, "password": password}, headers=extra)
    assert login.status_code == 200, login.text
    from app.core import totp

    verify = client.post(
        f"{AUTH}/mfa/verify",
        json={"code": totp.generate_code(secret, at)},
        headers={**headers_for(cookie_from(login)), **extra},
    )
    assert verify.status_code == 200, verify.text
    return {**headers_for(cookie_from(verify)), **extra}


# --- binding ------------------------------------------------------------------


def test_user_agent_is_stored_hashed_and_display_truncated(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    long_ua = "Mozilla/5.0 " + "x" * 400
    _login_headers(client, extra={"user-agent": long_ua})
    row = _session_row(owner_engine)
    assert row["ua_hash"] and len(row["ua_hash"]) == 64
    assert row["user_agent"] == long_ua[:120]
    assert long_ua not in json.dumps({k: str(v) for k, v in row.items() if k != "user_agent"})


def test_user_agent_change_revokes_audits_and_401s(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    assert client.get(TENANTS, headers=headers).status_code == 200

    stolen = {**headers, "user-agent": "curl/8.0 (thief)"}
    resp = client.get(TENANTS, headers=stolen)
    assert resp.status_code == 401
    assert "user" not in resp.json()["error"]["message"].lower()  # generic message

    # The session is dead for the legitimate browser too.
    assert client.get(TENANTS, headers=headers).status_code == 401
    assert _session_row(owner_engine)["revoked_at"] is not None

    events = _events(owner_engine, "session_binding_failed")
    assert len(events) == 1
    assert events[0]["outcome"] == "failure"
    assert events[0]["details"] == {"reason": "user_agent"}
    assert "curl" not in json.dumps(events[0], default=str)


def test_ip_binding_off_by_default_ignores_ip_change(
    client: TestClient, owner_engine, monkeypatch
) -> None:
    assert settings.platform_session_bind_ip is False
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    seed_admin(owner_engine)
    headers = _login_headers(client, extra={"x-forwarded-for": "10.0.0.1"})
    moved = {**headers, "x-forwarded-for": "10.9.9.9"}
    assert client.get(TENANTS, headers=moved).status_code == 200
    assert _events(owner_engine, "session_binding_failed") == []


def test_ip_binding_on_revokes_on_ip_change(client: TestClient, owner_engine, monkeypatch) -> None:
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    monkeypatch.setattr(settings, "platform_session_bind_ip", True)
    seed_admin(owner_engine)
    headers = _login_headers(client, extra={"x-forwarded-for": "10.0.0.1"})
    assert client.get(TENANTS, headers=headers).status_code == 200  # same IP is fine

    moved = {**headers, "x-forwarded-for": "10.9.9.9"}
    assert client.get(TENANTS, headers=moved).status_code == 401
    assert client.get(TENANTS, headers=headers).status_code == 401  # revoked
    events = _events(owner_engine, "session_binding_failed")
    assert len(events) == 1 and events[0]["details"] == {"reason": "ip"}


# --- idle timeout and last_seen throttle -----------------------------------------


def test_idle_session_is_rejected_audited_and_revoked(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    _set(
        owner_engine,
        "UPDATE platform_sessions SET last_seen_at = :t",
        t=datetime.now(UTC) - timedelta(minutes=settings.platform_session_idle_minutes + 1),
    )
    resp = client.get(TENANTS, headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "session_idle_expired"
    events = _events(owner_engine, "session_idle_expired")
    assert len(events) == 1 and events[0]["outcome"] == "failure"
    assert _session_row(owner_engine)["revoked_at"] is not None
    # A second use is a plain 401 and does not write a second event.
    assert client.get(TENANTS, headers=headers).status_code == 401
    assert len(_events(owner_engine, "session_idle_expired")) == 1


def test_idle_window_is_configurable(client: TestClient, owner_engine, monkeypatch) -> None:
    monkeypatch.setattr(settings, "platform_session_idle_minutes", 2)
    seed_admin(owner_engine)
    headers = sign_in(client)
    _set(
        owner_engine,
        "UPDATE platform_sessions SET last_seen_at = :t",
        t=datetime.now(UTC) - timedelta(minutes=3),
    )
    assert client.get(TENANTS, headers=headers).status_code == 401


def test_last_seen_is_written_at_most_once_a_minute(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    recent = datetime.now(UTC) - timedelta(seconds=30)
    _set(owner_engine, "UPDATE platform_sessions SET last_seen_at = :t", t=recent)
    assert client.get(TENANTS, headers=headers).status_code == 200
    assert abs((_session_row(owner_engine)["last_seen_at"] - recent).total_seconds()) < 1

    older = datetime.now(UTC) - timedelta(seconds=120)
    _set(owner_engine, "UPDATE platform_sessions SET last_seen_at = :t", t=older)
    assert client.get(TENANTS, headers=headers).status_code == 200
    assert (datetime.now(UTC) - _session_row(owner_engine)["last_seen_at"]).total_seconds() < 30


# --- step-up -----------------------------------------------------------------------


def _create_target(owner_engine, enrolled: bool = False) -> str:
    seed_admin(
        owner_engine,
        email=OTHER_EMAIL,
        totp_secret=OTHER_SECRET if enrolled else None,
    )
    with owner_engine.begin() as conn:
        return str(
            conn.execute(
                text("SELECT id FROM platform_admins WHERE email = :e"), {"e": OTHER_EMAIL}
            ).scalar_one()
        )


def _sensitive_calls(client: TestClient, headers: dict, target: str) -> dict:
    return {
        "create admin": lambda: client.post(
            ADMINS,
            json={"email": "new-one@example.com", "password": "PlatformMfaPass123!"},
            headers=headers,
        ),
        "deactivate": lambda: client.patch(
            f"{ADMINS}/{target}", json={"is_active": False}, headers=headers
        ),
        "reset mfa": lambda: client.post(f"{ADMINS}/{target}/reset-mfa", headers=headers),
        "enrolment code": lambda: client.post(f"{ADMINS}/{target}/enrolment-code", headers=headers),
        "password reset code": lambda: client.post(
            f"{ADMINS}/{target}/password-reset-code", headers=headers
        ),
    }


def test_fresh_sign_in_counts_as_a_step_up(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    target = _create_target(owner_engine)
    headers = sign_in(client)
    assert _sensitive_calls(client, headers, target)["enrolment code"]().status_code == 200


@pytest.mark.parametrize(
    "action", ["create admin", "deactivate", "reset mfa", "enrolment code", "password reset code"]
)
def test_sensitive_actions_need_a_recent_step_up(
    client: TestClient, owner_engine, action: str
) -> None:
    seed_admin(owner_engine)
    target = _create_target(owner_engine)
    headers = sign_in(client)
    age_step_up(owner_engine)

    call = _sensitive_calls(client, headers, target)[action]
    refused = call()
    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "step_up_required"

    assert step_up(client, headers).status_code == 200
    assert call().status_code in (200, 201)


def test_non_sensitive_actions_and_reactivation_do_not_need_step_up(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    target = _create_target(owner_engine)
    headers = sign_in(client)
    _set(
        owner_engine, "UPDATE platform_admins SET is_active = false WHERE email = :e", e=OTHER_EMAIL
    )
    age_step_up(owner_engine)
    assert client.get(TENANTS, headers=headers).status_code == 200
    assert client.get(ADMINS, headers=headers).status_code == 200
    reactivated = client.patch(f"{ADMINS}/{target}", json={"is_active": True}, headers=headers)
    assert reactivated.status_code == 200


def test_step_up_expires_after_the_window(client: TestClient, owner_engine, monkeypatch) -> None:
    seed_admin(owner_engine)
    target = _create_target(owner_engine)
    headers = sign_in(client)
    age_step_up(owner_engine)
    assert step_up(client, headers).status_code == 200
    enrol = f"{ADMINS}/{target}/enrolment-code"
    assert client.post(enrol, headers=headers).status_code == 200

    age_step_up(owner_engine, minutes=settings.platform_step_up_minutes + 1)
    assert client.post(enrol, headers=headers).status_code == 403


def test_step_up_audits_success_and_failure(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    bad = client.post(f"{AUTH}/step-up", json={"code": "000000"}, headers=headers)
    assert bad.status_code == 401
    assert step_up(client, headers, offset_steps=1).status_code == 200
    ok = _events(owner_engine, "step_up_ok")
    failed = _events(owner_engine, "step_up_failed")
    assert len(ok) == 1 and ok[0]["outcome"] == "success" and ok[0]["details"] == {"method": "totp"}
    assert len(failed) == 1 and failed[0]["outcome"] == "failure"
    assert "000000" not in json.dumps(failed, default=str)


def test_step_up_code_cannot_be_replayed(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    # sign-in used the current step, so the same code is a replay
    replay = client.post(
        f"{AUTH}/step-up", json={"code": current_code(PLATFORM_TOTP_SECRET)}, headers=headers
    )
    assert replay.status_code == 401
    assert step_up(client, headers).status_code == 200
    again = client.post(
        f"{AUTH}/step-up", json={"code": current_code(PLATFORM_TOTP_SECRET, 1)}, headers=headers
    )
    assert again.status_code == 401


def test_step_up_accepts_a_recovery_code_once(client: TestClient, owner_engine) -> None:
    from app.services.platform_auth_service import hash_recovery_code

    seed_admin(owner_engine)
    _set(
        owner_engine,
        "INSERT INTO platform_admin_recovery_codes (admin_id, code_hash) "
        "SELECT id, :h FROM platform_admins",
        h=hash_recovery_code("ABCD-EFGH-IJKL-MNOP"),
    )
    headers = sign_in(client)
    age_step_up(owner_engine)
    ok = client.post(
        f"{AUTH}/step-up", json={"recovery_code": "ABCD-EFGH-IJKL-MNOP"}, headers=headers
    )
    assert ok.status_code == 200
    age_step_up(owner_engine)
    reuse = client.post(
        f"{AUTH}/step-up", json={"recovery_code": "ABCD-EFGH-IJKL-MNOP"}, headers=headers
    )
    assert reuse.status_code == 401


def test_step_up_requires_exactly_one_credential(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    assert client.post(f"{AUTH}/step-up", json={}, headers=headers).status_code == 422
    both = client.post(
        f"{AUTH}/step-up", json={"code": "123456", "recovery_code": "x"}, headers=headers
    )
    assert both.status_code == 422
    assert client.post(f"{AUTH}/step-up", json={"code": "123456"}).status_code == 401


def test_wrong_step_up_codes_share_the_mfa_lockout(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    last = None
    for _ in range(settings.platform_mfa_max_failed_attempts):
        last = client.post(f"{AUTH}/step-up", json={"code": "000000"}, headers=headers)
        assert last.status_code == 401
    assert last is not None and "locked" in last.json()["error"]["message"].lower()
    # Account locked and every session revoked.
    assert client.get(TENANTS, headers=headers).status_code == 401
    login = client.post(
        f"{AUTH}/login", json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}
    )
    assert login.status_code == 401
    assert len(_events(owner_engine, "lockout")) == 1


def test_me_reports_step_up_expiry(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    assert client.get(f"{AUTH}/me", headers=headers).json()["data"]["step_up_expires_at"]
    age_step_up(owner_engine)
    assert client.get(f"{AUTH}/me", headers=headers).json()["data"]["step_up_expires_at"] is None


# --- own sessions ---------------------------------------------------------------------


def test_sessions_list_shows_only_own_sessions_without_secrets(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    seed_admin(owner_engine, email=OTHER_EMAIL, totp_secret=OTHER_SECRET)
    first = sign_in(client)
    second = _login_headers(client, at=time.time() + 30)
    _login_headers(client, email=OTHER_EMAIL, secret=OTHER_SECRET, password=PLATFORM_PASSWORD)

    resp = client.get(f"{AUTH}/sessions", headers=first)
    assert resp.status_code == 200
    items = resp.json()["data"]
    assert len(items) == 2
    assert sum(1 for i in items if i["current"]) == 1
    assert set(items[0]) == {
        "id",
        "created_at",
        "last_seen_at",
        "ip_address",
        "user_agent",
        "current",
    }

    with owner_engine.begin() as conn:
        hashes = [r[0] for r in conn.execute(text("SELECT token_hash FROM platform_sessions"))]
    raw_tokens = [first["Cookie"].split("=", 1)[1], second["Cookie"].split("=", 1)[1]]
    body = resp.text
    assert all(h not in body for h in hashes)
    assert all(t not in body for t in raw_tokens)
    assert "token" not in body.lower()


def test_sessions_requires_a_full_session(client: TestClient, owner_engine) -> None:
    assert client.get(f"{AUTH}/sessions").status_code == 401
    seed_admin(owner_engine)
    login = client.post(
        f"{AUTH}/login", json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}
    )
    pre = headers_for(cookie_from(login))
    assert client.get(f"{AUTH}/sessions", headers=pre).status_code == 401


def test_revoking_one_of_your_own_sessions(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    first = sign_in(client)
    second = _login_headers(client, at=time.time() + 30)
    items = client.get(f"{AUTH}/sessions", headers=first).json()["data"]
    other = next(i for i in items if not i["current"])

    resp = client.delete(f"{AUTH}/sessions/{other['id']}", headers=first)
    assert resp.status_code == 200
    assert resp.json()["data"] == {"revoked": True, "current": False}
    assert client.get(TENANTS, headers=second).status_code == 401
    assert client.get(TENANTS, headers=first).status_code == 200
    assert len(_events(owner_engine, "session_revoked")) == 1
    # Already revoked: nothing to do.
    assert client.delete(f"{AUTH}/sessions/{other['id']}", headers=first).status_code == 404


def test_revoking_the_current_session_signs_out(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    current = next(
        i for i in client.get(f"{AUTH}/sessions", headers=headers).json()["data"] if i["current"]
    )
    resp = client.delete(f"{AUTH}/sessions/{current['id']}", headers=headers)
    assert resp.status_code == 200 and resp.json()["data"]["current"] is True
    assert client.get(TENANTS, headers=headers).status_code == 401


def test_cannot_revoke_another_admins_session(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    seed_admin(owner_engine, email=OTHER_EMAIL, totp_secret=OTHER_SECRET)
    mine = sign_in(client)
    theirs = _login_headers(
        client, email=OTHER_EMAIL, secret=OTHER_SECRET, password=PLATFORM_PASSWORD
    )
    their_id = client.get(f"{AUTH}/sessions", headers=theirs).json()["data"][0]["id"]

    resp = client.delete(f"{AUTH}/sessions/{their_id}", headers=mine)
    assert resp.status_code == 404
    assert client.get(TENANTS, headers=theirs).status_code == 200
    assert _events(owner_engine, "session_revoked") == []
    assert client.delete(f"{AUTH}/sessions/not-a-uuid", headers=mine).status_code == 422


def test_revoke_session_needs_a_session(client: TestClient) -> None:
    assert client.delete(f"{AUTH}/sessions/00000000-0000-0000-0000-000000000000").status_code == 401


# --- production config -------------------------------------------------------------------


def _prod(**overrides) -> Settings:
    defaults = dict(
        environment="production",
        database_url="postgresql+psycopg://real_user:real_pass@db.internal:5432/qtesthub",
        mfa_delivery_mode="real",
        smtp_host="smtp.example.com",
        cors_allow_origins=["https://app.example.com"],
        ai_credential_encryption_key="kEdknj1w6XzjMsv2T86nToujCkYjMqSYnr3CoPxuKAI=",
        audit_checkpoint_hmac_key="Zk3p9vQw1LrT7yUaXc5NmB8dEh2GfJ4sRt6VnKo0WiA",
    )
    defaults.update(overrides)
    return Settings(**defaults)


def test_hardening_defaults() -> None:
    fresh = Settings()
    assert fresh.platform_session_idle_minutes == 30
    assert fresh.platform_session_bind_ip is False
    assert fresh.platform_step_up_minutes == 5
    validate_for_production(_prod())


@pytest.mark.parametrize("value", [0, -5, 1441, 100000])
def test_production_rejects_bad_idle_minutes(value: int) -> None:
    with pytest.raises(InsecureProductionConfigError, match="PLATFORM_SESSION_IDLE_MINUTES"):
        validate_for_production(_prod(platform_session_idle_minutes=value))


@pytest.mark.parametrize("value", [0, -1, 1441])
def test_production_rejects_bad_step_up_minutes(value: int) -> None:
    with pytest.raises(InsecureProductionConfigError, match="PLATFORM_STEP_UP_MINUTES"):
        validate_for_production(_prod(platform_step_up_minutes=value))


@pytest.mark.parametrize("value", [1, 30, 1440])
def test_production_accepts_sane_idle_minutes(value: int) -> None:
    validate_for_production(_prod(platform_session_idle_minutes=value))
