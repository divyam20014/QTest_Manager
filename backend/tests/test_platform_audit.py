"""ADR-082: platform-level, hash-chained audit trail for the Platform Admin plane."""

import json
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import totp
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.main import app
from app.services.platform_audit_service import record_platform_event
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
EVENTS = f"{BASE}/audit-events"
VERIFY = f"{BASE}/audit-events/verify"
LOGIN = f"{BASE}/auth/login"
MFA = f"{BASE}/auth/mfa/verify"


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()
    yield
    limiter.reset()


def _rows(owner_engine) -> list[dict]:
    with owner_engine.begin() as conn:
        return [
            dict(r._mapping)
            for r in conn.execute(
                text("SELECT * FROM platform_audit_events ORDER BY created_at, id")
            )
        ]


def _types(owner_engine, outcome: str | None = None) -> list[str]:
    return [r["event_type"] for r in _rows(owner_engine) if outcome in (None, r["outcome"])]


def _free_step(owner_engine, email: str) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE platform_admins SET mfa_last_used_step = NULL WHERE email = :e"),
            {"e": email},
        )


def test_endpoints_require_a_platform_session(client: TestClient) -> None:
    assert client.get(EVENTS).status_code == 401
    assert client.get(VERIFY).status_code == 401


def test_password_only_session_cannot_read_the_trail(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    login = client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD})
    pre = headers_for(cookie_from(login))
    assert client.get(EVENTS, headers=pre).status_code == 401


def test_sign_in_and_logout_are_recorded(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    out = client.post(f"{BASE}/auth/logout", headers=headers)
    assert out.status_code == 200
    rows = _rows(owner_engine)
    assert [r["event_type"] for r in rows] == ["login_password_ok", "mfa_success", "logout"]
    assert all(r["outcome"] == "success" for r in rows)
    assert all(r["actor_email"] == PLATFORM_EMAIL for r in rows)
    assert rows[1]["details"] == {"method": "totp"}


def test_failures_are_recorded_even_though_the_request_401s(
    client: TestClient, owner_engine
) -> None:
    seed_admin(owner_engine)
    unknown = client.post(LOGIN, json={"email": "  Nobody@Example.COM ", "password": "x" * 12})
    assert unknown.status_code == 401
    wrong = client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": "WrongPassword123!"})
    assert wrong.status_code == 401
    ok = client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD})
    pre = headers_for(cookie_from(ok))
    bad_code = client.post(MFA, json={"code": "000000"}, headers=pre)
    assert bad_code.status_code == 401

    rows = _rows(owner_engine)
    failures = [(r["event_type"], r["actor_email"]) for r in rows if r["outcome"] == "failure"]
    assert ("login_failed", "nobody@example.com") in failures  # normalised, no admin id
    assert ("login_failed", PLATFORM_EMAIL) in failures
    assert ("mfa_failed", PLATFORM_EMAIL) in failures
    unknown_row = next(r for r in rows if r["actor_email"] == "nobody@example.com")
    assert unknown_row["actor_admin_id"] is None
    assert unknown_row["details"] == {"reason": "unknown_account"}


def test_lockout_is_recorded(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    for _ in range(get_settings().platform_admin_max_failed_logins):
        client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": "WrongPassword123!"})
    types = _types(owner_engine, "failure")
    assert types.count("login_failed") == get_settings().platform_admin_max_failed_logins
    assert "lockout" in types
    blocked = client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD})
    assert blocked.status_code == 401
    assert "login_blocked" in _types(owner_engine, "failure")


def test_full_admin_lifecycle_events_and_no_secrets(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    owner = sign_in(client)
    second_email, second_password = "second@example.com", "SecondAdmin123!"
    created = client.post(
        f"{BASE}/admins", headers=owner, json={"email": second_email, "password": second_password}
    )
    assert created.status_code == 200, created.text
    second_id = created.json()["data"]["id"]
    enrolment_code = created.json()["data"]["enrolment_code"]

    # The second admin enrols (enrolment code -> TOTP -> recovery codes).
    other = TestClient(app)
    login = other.post(LOGIN, json={"email": second_email, "password": second_password})
    pre_token = cookie_from(login)
    pre = headers_for(pre_token)
    start = other.post(
        f"{BASE}/auth/mfa/enroll/start", json={"enrolment_code": enrolment_code}, headers=pre
    )
    assert start.status_code == 200, start.text
    secret = start.json()["data"]["secret"]
    code = totp.generate_code(secret, time.time())
    finish = other.post(
        f"{BASE}/auth/mfa/enroll/verify",
        json={"code": code, "enrolment_code": enrolment_code},
        headers=pre,
    )
    assert finish.status_code == 200, finish.text
    recovery = finish.json()["data"]["recovery_codes"]
    second_session = cookie_from(finish)
    assert second_session

    # Sign in again with a recovery code.
    login2 = other.post(LOGIN, json={"email": second_email, "password": second_password})
    pre2_token = cookie_from(login2)
    again = other.post(MFA, json={"recovery_code": recovery[0]}, headers=headers_for(pre2_token))
    assert again.status_code == 200, again.text
    second_full = headers_for(cookie_from(again))

    # Password change (fresh TOTP) by the second admin.
    _free_step(owner_engine, second_email)
    new_password = "ChangedSecond456!"
    change = other.post(
        f"{BASE}/auth/password/change",
        headers=second_full,
        json={
            "current_password": second_password,
            "new_password": new_password,
            "code": totp.generate_code(secret, time.time()),
        },
    )
    assert change.status_code == 200, change.text

    # Owner issues a reset code, the second admin completes it.
    issued = client.post(f"{BASE}/admins/{second_id}/password-reset-code", headers=owner)
    assert issued.status_code == 200, issued.text
    reset_code = issued.json()["data"]["password_reset_code"]
    _free_step(owner_engine, second_email)
    final_password = "FinalSecond789!"
    reset_totp = totp.generate_code(secret, time.time())
    done = other.post(
        f"{BASE}/auth/password/reset",
        json={
            "email": second_email,
            "reset_code": reset_code,
            "new_password": final_password,
            "code": reset_totp,
        },
    )
    assert done.status_code == 200, done.text

    # MFA reset, then a new enrolment code, deactivate and reactivate.
    reset = client.post(f"{BASE}/admins/{second_id}/reset-mfa", headers=owner)
    assert reset.status_code == 200, reset.text
    reissue = client.post(f"{BASE}/admins/{second_id}/enrolment-code", headers=owner)
    assert reissue.status_code == 200, reissue.text
    off = client.patch(f"{BASE}/admins/{second_id}", headers=owner, json={"is_active": False})
    assert off.status_code == 200
    on = client.patch(f"{BASE}/admins/{second_id}", headers=owner, json={"is_active": True})
    assert on.status_code == 200

    types = set(_types(owner_engine))
    expected = {
        "login_password_ok",
        "mfa_success",
        "admin_created",
        "mfa_enrolled",
        "recovery_code_used",
        "password_changed",
        "password_reset_code_issued",
        "password_reset_completed",
        "mfa_reset",
        "enrolment_code_issued",
        "admin_deactivated",
        "admin_activated",
    }
    assert expected <= types, expected - types

    reset_row = next(r for r in _rows(owner_engine) if r["event_type"] == "mfa_reset")
    assert reset_row["actor_email"] == PLATFORM_EMAIL
    assert str(reset_row["target_admin_id"]) == second_id
    assert reset_row["details"]["source"] == "admin"

    # The chain verifies end to end through the API.
    verify = client.get(VERIFY, headers=owner).json()["data"]
    assert verify["valid"] is True
    assert verify["checked_count"] == len(_rows(owner_engine))

    # Nothing secret anywhere in the stored rows.
    blob = json.dumps(_rows(owner_engine), default=str)
    secrets_used = [
        PLATFORM_PASSWORD,
        PLATFORM_TOTP_SECRET,
        second_password,
        new_password,
        final_password,
        secret,
        code,
        reset_totp,
        enrolment_code,
        reset_code,
        hash_enrolment_code(enrolment_code),
        hash_enrolment_code(reset_code),
        pre_token,
        pre2_token,
        second_session,
        cookie_from(login) or "",
        *recovery,
        *(hash_recovery_code(c) for c in recovery),
    ]
    for value in secrets_used:
        assert value and value not in blob, value
    for word in ("password_hash", "token_hash", "otpauth", "secret_encrypted"):
        assert word not in blob


def test_chain_verifies_and_tampering_is_detected(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    client.post(LOGIN, json={"email": "who@example.com", "password": "x" * 12})
    ok = client.get(VERIFY, headers=headers).json()["data"]
    assert {k: ok[k] for k in ("valid", "checked_count", "broken_at_id")} == {
        "valid": True,
        "checked_count": 3,
        "broken_at_id": None,
    }
    assert ok["checkpoints_checked"] == 0 and ok["checkpoint_failure"] is None

    with owner_engine.begin() as conn:
        victim = conn.execute(
            text("SELECT id FROM platform_audit_events WHERE event_type = 'login_failed'")
        ).scalar_one()
        conn.execute(
            text("UPDATE platform_audit_events SET outcome = 'success' WHERE id = :i"),
            {"i": victim},
        )
    broken = client.get(VERIFY, headers=headers).json()["data"]
    assert broken["valid"] is False
    assert broken["broken_at_id"] == str(victim)


def test_deleting_a_row_is_detected(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    with owner_engine.begin() as conn:
        conn.execute(
            text("DELETE FROM platform_audit_events WHERE event_type = 'login_password_ok'")
        )
    assert client.get(VERIFY, headers=headers).json()["data"]["valid"] is False


def test_app_role_cannot_update_or_delete(db_session) -> None:
    record_platform_event(db_session, "probe", commit=True)
    for statement in (
        "UPDATE platform_audit_events SET outcome = 'success'",
        "DELETE FROM platform_audit_events",
    ):
        with pytest.raises(Exception, match="permission denied"):
            db_session.execute(text(statement))
        db_session.rollback()


def test_details_are_whitelisted_and_timestamps_strictly_increase(db_session, owner_engine) -> None:
    for i in range(5):
        record_platform_event(
            db_session,
            "probe",
            details={"reason": "x", "password": "hunter2", "code": "123456", "n": i},
            commit=True,
        )
    rows = _rows(owner_engine)
    assert all(r["details"] == {"reason": "x"} for r in rows)
    stamps = [r["created_at"] for r in rows]
    assert stamps == sorted(set(stamps))


def test_filters_and_paging(client: TestClient, owner_engine) -> None:
    seed_admin(owner_engine)
    headers = sign_in(client)
    client.post(LOGIN, json={"email": "Zed@example.com", "password": "x" * 12})
    client.post(LOGIN, json={"email": PLATFORM_EMAIL, "password": "WrongPassword123!"})

    def fetch(**params):
        r = client.get(EVENTS, params=params, headers=headers)
        assert r.status_code == 200, r.text
        return r.json()["data"]

    everything = fetch()
    assert everything["total"] == 4
    stamps = [e["created_at"] for e in everything["items"]]
    assert stamps == sorted(stamps, reverse=True)  # newest first
    assert "record_hash" not in everything["items"][0]

    assert fetch(outcome="failure")["total"] == 2
    assert fetch(event_type="mfa_success")["total"] == 1
    assert fetch(actor_email="ZED")["total"] == 1
    assert fetch(actor_email="%")["total"] == 0  # wildcards are escaped
    page = fetch(page=2, page_size=2)
    assert len(page["items"]) == 2 and page["total"] == 4
    assert client.get(EVENTS, params={"outcome": "maybe"}, headers=headers).status_code == 422
