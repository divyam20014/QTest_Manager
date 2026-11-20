"""ADR-085 (GAP-01): HMAC-signed checkpoints over the tenant and platform audit chains.

The point of the feature, tested explicitly: someone with database-owner rights
can rewrite a whole hash chain consistently (the plain chain walk then passes),
but once a checkpoint exists that rewrite no longer verifies.
"""

import hashlib
import hmac
import json
import uuid
from datetime import UTC

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.audit import GENESIS_HASH, _canonical
from app.core.config import InsecureProductionConfigError, Settings, validate_for_production
from app.main import app
from app.services import audit_checkpoint_service as svc
from app.services.platform_audit_service import _hash as platform_hash
from app.services.platform_audit_service import record_platform_event

TENANT_VERIFY = "/api/v1/audit-logs/verify-chain"
TENANT_CP = "/api/v1/audit-logs/checkpoints"
PLATFORM = "/api/v1/platform/audit-events"
PLATFORM_CP = f"{PLATFORM}/checkpoints"
PLATFORM_VERIFY = f"{PLATFORM}/verify"


# ---------------------------------------------------------------- helpers


def _bootstrap(client: TestClient, platform_admin: dict, name: str, email: str) -> str:
    response = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": name,
            "admin_name": "Admin A",
            "admin_email": email,
            "admin_password": "AdminPassw0rd!",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["tenant"]["id"]


def _login(client: TestClient, tenant_id: str, email: str, password: str) -> None:
    login = client.post(
        "/api/v1/auth/login", json={"tenant_id": tenant_id, "email": email, "password": password}
    )
    assert login.status_code == 200, login.text
    verify = client.post(
        "/api/v1/auth/mfa/verify", json={"code": login.json()["data"]["debug_code"]}
    )
    assert verify.status_code == 200, verify.text


@pytest.fixture
def tenant(client: TestClient, platform_admin: dict) -> dict:
    """A tenant whose admin is signed in on `client`."""
    tenant_id = _bootstrap(client, platform_admin, "Horizon Mutual", "admin@horizon.com")
    _login(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    return {"id": tenant_id, "client": client, "platform": platform_admin}


def _add_user(client: TestClient, email: str, role: str = "manager") -> None:
    response = client.post(
        "/api/v1/users",
        json={"email": email, "name": "User", "role": role, "password": "UserPassw0rd!xx"},
    )
    assert response.status_code in (200, 201), response.text


def _create(client: TestClient) -> dict:
    response = client.post(TENANT_CP)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _verify(client: TestClient) -> dict:
    return client.get(TENANT_VERIFY).json()["data"]


def _tenant_payload(row: dict) -> dict:
    return {
        "tenant_id": str(row["tenant_id"]),
        "user_id": str(row["user_id"]) if row["user_id"] else None,
        "platform_admin_id": str(row["platform_admin_id"]) if row["platform_admin_id"] else None,
        "service_token_id": str(row["service_token_id"]) if row["service_token_id"] else None,
        "action": row["action"],
        "entity_type": row["entity_type"],
        "entity_id": str(row["entity_id"]),
        "metadata": row["metadata"],
        "created_at": row["created_at"].isoformat(),
        "prev_hash": row["prev_hash"],
    }


def _rewrite_tenant_chain(owner_engine, tenant_id: str) -> None:
    """What a DB owner can do: change one event and recompute every hash after
    it so the plain chain walk still passes."""
    with owner_engine.begin() as conn:
        rows = [
            dict(r._mapping)
            for r in conn.execute(
                text("SELECT * FROM audit_logs WHERE tenant_id = :t ORDER BY created_at, id"),
                {"t": tenant_id},
            )
        ]
        prev = GENESIS_HASH
        for index, row in enumerate(rows):
            if index == 1:
                row["action"] = "user.forged"
            row["prev_hash"] = prev
            row["record_hash"] = hashlib.sha256(
                _canonical(_tenant_payload(row)).encode()
            ).hexdigest()
            conn.execute(
                text(
                    "UPDATE audit_logs SET action = :a, prev_hash = :p, record_hash = :h "
                    "WHERE id = :i"
                ),
                {"a": row["action"], "p": prev, "h": row["record_hash"], "i": row["id"]},
            )
            prev = row["record_hash"]


def _rewrite_platform_chain(owner_engine) -> None:
    with owner_engine.begin() as conn:
        rows = [
            dict(r._mapping)
            for r in conn.execute(
                text("SELECT * FROM platform_audit_events ORDER BY created_at, id")
            )
        ]
        prev = GENESIS_HASH
        for index, row in enumerate(rows):
            if index == 0:
                row["ip"] = "203.0.113.9"
            row["prev_hash"] = prev
            row["record_hash"] = platform_hash(row)
            conn.execute(
                text(
                    "UPDATE platform_audit_events SET ip = :ip, prev_hash = :p, record_hash = :h "
                    "WHERE id = :i"
                ),
                {"ip": row["ip"], "p": prev, "h": row["record_hash"], "i": row["id"]},
            )
            prev = row["record_hash"]


# ---------------------------------------------------------------- creation


def test_create_then_skip_when_unchanged(tenant: dict) -> None:
    client = tenant["client"]
    first = _create(client)
    assert first["created"] is True
    cp = first["checkpoint"]
    assert cp["scope"] == f"tenant:{tenant['id']}"
    assert cp["record_count"] >= 2
    assert cp["prev_checkpoint_hash"] == GENESIS_HASH

    again = _create(client)
    assert again == {"created": False, "reason": "no_new_events", "checkpoint": None}
    assert len(client.get(TENANT_CP).json()["data"]) == 1

    _add_user(client, "m1@horizon.com")
    third = _create(client)
    assert third["created"] is True
    assert third["checkpoint"]["record_count"] > cp["record_count"]


def test_checkpoints_chain_and_are_signed(tenant: dict) -> None:
    client = tenant["client"]
    _create(client)
    _add_user(client, "m1@horizon.com")
    _create(client)
    _add_user(client, "m2@horizon.com")
    _create(client)

    cps = client.get(TENANT_CP).json()["data"]
    assert len(cps) == 3  # oldest first
    assert cps[0]["prev_checkpoint_hash"] == GENESIS_HASH
    for older, newer in zip(cps, cps[1:], strict=False):
        assert newer["prev_checkpoint_hash"] == older["checkpoint_hash"]
        assert newer["record_count"] > older["record_count"]
    for cp in cps:
        expected = hmac.new(
            svc._hmac_key(), cp["checkpoint_hash"].encode(), hashlib.sha256
        ).hexdigest()
        assert cp["signature"] == expected
        assert len(cp["checkpoint_hash"]) == 64

    result = _verify(client)
    assert result["valid"] is True
    assert result["checkpoints_checked"] == 3
    assert result["checkpoint_failure"] is None


def test_verify_without_checkpoints_is_backward_compatible(tenant: dict) -> None:
    result = _verify(tenant["client"])
    assert result["valid"] is True
    assert result["broken_at_id"] is None
    assert result["checkpoints_checked"] == 0
    assert result["checkpoint_failure"] is None


def test_export_is_a_json_attachment(tenant: dict) -> None:
    client = tenant["client"]
    _create(client)
    response = client.get(f"{TENANT_CP}/export")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    body = json.loads(response.text)
    assert body["scope"] == f"tenant:{tenant['id']}"
    assert len(body["checkpoints"]) == 1
    assert "exported_at" in body


# ---------------------------------------------------------------- isolation / permissions


def test_tenant_isolation(tenant: dict) -> None:
    client_a = tenant["client"]
    _create(client_a)

    client_b = TestClient(app)
    tenant_b = _bootstrap(client_b, tenant["platform"], "Other Mutual", "admin@other.com")
    _login(client_b, tenant_b, "admin@other.com", "AdminPassw0rd!")
    assert client_b.get(TENANT_CP).json()["data"] == []  # A's checkpoint is invisible
    _create(client_b)

    cps_a = client_a.get(TENANT_CP).json()["data"]
    cps_b = client_b.get(TENANT_CP).json()["data"]
    assert [c["scope"] for c in cps_a] == [f"tenant:{tenant['id']}"]
    assert [c["scope"] for c in cps_b] == [f"tenant:{tenant_b}"]
    assert _verify(client_a)["checkpoints_checked"] == 1
    assert _verify(client_b)["checkpoints_checked"] == 1
    # The scope is never taken from input.
    assert client_a.get(TENANT_CP, params={"scope": f"tenant:{tenant_b}"}).json()["data"] == cps_a


def test_tester_cannot_use_checkpoints_and_anonymous_gets_401(tenant: dict) -> None:
    _add_user(tenant["client"], "tester@horizon.com", role="tester")
    tester = TestClient(app)
    _login(tester, tenant["id"], "tester@horizon.com", "UserPassw0rd!xx")
    assert tester.get(TENANT_CP).status_code == 403
    assert tester.post(TENANT_CP).status_code == 403
    assert tester.get(f"{TENANT_CP}/export").status_code == 403

    anonymous = TestClient(app)
    assert anonymous.get(TENANT_CP).status_code == 401
    assert anonymous.post(TENANT_CP).status_code == 401


def test_app_role_is_insert_only_on_checkpoints(tenant: dict, db_session) -> None:
    _create(tenant["client"])
    for statement in (
        "UPDATE audit_chain_checkpoints SET record_count = 0",
        "DELETE FROM audit_chain_checkpoints",
        "TRUNCATE audit_chain_checkpoints",
    ):
        with pytest.raises(Exception, match="permission denied"):
            db_session.execute(text(statement))
        db_session.rollback()
    assert db_session.execute(text("SELECT count(*) FROM audit_chain_checkpoints")).scalar() == 1


# ---------------------------------------------------------------- tamper detection


def test_consistent_rewrite_of_the_whole_chain_is_detected(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    _create(client)
    assert _verify(client)["valid"] is True

    _rewrite_tenant_chain(owner_engine, tenant["id"])

    result = _verify(client)
    # The plain chain walk is fooled: every link and hash is consistent...
    assert result["broken_at_id"] is None
    # ...but the signed checkpoint still pins the original head.
    assert result["valid"] is False
    assert result["checkpoints_checked"] == 1
    assert result["checkpoint_failure"]["reason"] == "anchor_hash_mismatch"


def test_rewrite_after_checkpoint_passes_without_one(tenant: dict, owner_engine) -> None:
    """Control: with no checkpoint the same rewrite is invisible (the gap)."""
    _add_user(tenant["client"], "m1@horizon.com")
    _rewrite_tenant_chain(owner_engine, tenant["id"])
    assert _verify(tenant["client"])["valid"] is True


def test_deleted_tail_events_are_detected(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    _create(client)
    cp_id = client.get(TENANT_CP).json()["data"][0]["id"]
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "DELETE FROM audit_logs WHERE id = (SELECT id FROM audit_logs "
                "WHERE tenant_id = :t ORDER BY created_at DESC, id DESC LIMIT 1)"
            ),
            {"t": tenant["id"]},
        )
    result = _verify(client)
    # The chain walk of the shortened log is still consistent; the anchor is gone.
    assert result["broken_at_id"] is None
    assert result["valid"] is False
    assert result["checkpoint_failure"] == {"checkpoint_id": cp_id, "reason": "anchor_missing"}


def test_count_mismatch_is_detected(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    _create(client)
    cp_id = client.get(TENANT_CP).json()["data"][0]["id"]
    with owner_engine.begin() as conn:
        # Slip an extra event in before the anchor; the anchor row itself is untouched.
        conn.execute(
            text(
                "INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, prev_hash, "
                "record_hash, created_at) SELECT tenant_id, 'user.extra', entity_type, "
                "gen_random_uuid(), prev_hash, 'f' || repeat('0', 63), "
                "created_at - interval '1 ms' "
                "FROM audit_logs WHERE tenant_id = :t ORDER BY created_at DESC, id DESC LIMIT 1"
            ),
            {"t": tenant["id"]},
        )
    result = _verify(client)
    assert result["valid"] is False
    assert result["checkpoint_failure"] == {"checkpoint_id": cp_id, "reason": "count_mismatch"}


def test_tampered_checkpoint_is_detected(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    _create(client)
    cp_id = client.get(TENANT_CP).json()["data"][0]["id"]
    with owner_engine.begin() as conn:
        conn.execute(text("UPDATE audit_chain_checkpoints SET record_count = record_count - 1"))
    failure = _verify(client)["checkpoint_failure"]
    assert failure == {"checkpoint_id": cp_id, "reason": "signature_invalid"}


def test_checkpoint_forged_with_another_key_is_detected(tenant: dict, owner_engine) -> None:
    """A DB owner can recompute checkpoint_hash, but cannot sign without the key."""
    client = tenant["client"]
    _create(client)
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE audit_chain_checkpoints SET signature = :s"),
            {"s": hmac.new(b"not-the-key", b"x", hashlib.sha256).hexdigest()},
        )
    assert _verify(client)["checkpoint_failure"]["reason"] == "signature_invalid"


def test_removed_checkpoint_breaks_the_checkpoint_chain(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    _create(client)
    _add_user(client, "m1@horizon.com")
    _create(client)
    cps = client.get(TENANT_CP).json()["data"]
    with owner_engine.begin() as conn:
        conn.execute(text("DELETE FROM audit_chain_checkpoints WHERE id = :i"), {"i": cps[0]["id"]})
    failure = _verify(client)["checkpoint_failure"]
    assert failure == {"checkpoint_id": cps[1]["id"], "reason": "checkpoint_chain_broken"}


def test_refuses_to_anchor_a_broken_chain(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE audit_logs SET action = 'tampered' WHERE action = 'user.created'")
        )
    response = client.post(TENANT_CP)
    assert response.status_code == 409
    assert client.get(TENANT_CP).json()["data"] == []


# ---------------------------------------------------------------- platform scope


def test_platform_checkpoints_create_chain_and_detect_rewrite(
    client: TestClient, platform_admin: dict, owner_engine, db_session
) -> None:
    headers = platform_admin["headers"]
    first = client.post(PLATFORM_CP, headers=headers).json()["data"]
    assert first["created"] is True and first["checkpoint"]["scope"] == "platform"
    assert client.post(PLATFORM_CP, headers=headers).json()["data"]["created"] is False

    record_platform_event(db_session, "probe", commit=True)
    second = client.post(PLATFORM_CP, headers=headers).json()["data"]
    assert second["checkpoint"]["prev_checkpoint_hash"] == first["checkpoint"]["checkpoint_hash"]

    ok = client.get(PLATFORM_VERIFY, headers=headers).json()["data"]
    assert ok["valid"] is True and ok["checkpoints_checked"] == 2

    export = client.get(f"{PLATFORM_CP}/export", headers=headers)
    assert len(json.loads(export.text)["checkpoints"]) == 2

    _rewrite_platform_chain(owner_engine)
    bad = client.get(PLATFORM_VERIFY, headers=headers).json()["data"]
    assert bad["broken_at_id"] is None
    assert bad["valid"] is False
    assert bad["checkpoint_failure"]["reason"] == "anchor_hash_mismatch"


def test_platform_checkpoints_need_a_platform_session(client: TestClient) -> None:
    assert client.get(PLATFORM_CP).status_code == 401
    assert client.post(PLATFORM_CP).status_code == 401
    assert client.get(f"{PLATFORM_CP}/export").status_code == 401


def test_tenant_session_cannot_reach_platform_checkpoints(tenant: dict) -> None:
    # A tenant admin's cookie is not a platform session.
    anonymous_platform = TestClient(app)
    anonymous_platform.cookies.update(tenant["client"].cookies)
    assert anonymous_platform.post(PLATFORM_CP).status_code == 401


# ---------------------------------------------------------------- CLI / worker runner


def test_run_checkpoints_dry_run_then_real_then_idempotent(tenant: dict, db_session) -> None:
    scope = f"tenant:{tenant['id']}"

    dry = svc.run_checkpoints(db_session, [scope], dry_run=True)
    assert [(r.scope, r.status) for r in dry] == [(scope, "would_create")]
    assert dry[0].new_events >= 2
    assert db_session.execute(text("SELECT count(*) FROM audit_chain_checkpoints")).scalar() == 0

    made = svc.run_checkpoints(db_session, [scope])
    assert made[0].status == "created"
    again = svc.run_checkpoints(db_session, [scope])
    assert again[0].status == "unchanged" and again[0].new_events == 0
    assert svc.run_checkpoints(db_session, [scope], dry_run=True)[0].status == "unchanged"


def test_run_checkpoints_default_covers_platform_and_every_tenant(tenant: dict, db_session) -> None:
    runs = svc.run_checkpoints(db_session)
    scopes = {r.scope for r in runs}
    assert scopes == {"platform", f"tenant:{tenant['id']}"}
    assert all(r.status == "created" for r in runs)


def test_run_checkpoints_reports_refusal_and_continues(
    tenant: dict, db_session, owner_engine
) -> None:
    with owner_engine.begin() as conn:
        conn.execute(
            text("UPDATE audit_logs SET action = 'tampered' WHERE action = 'tenant.created'")
        )
    runs = {r.scope: r for r in svc.run_checkpoints(db_session)}
    assert runs[f"tenant:{tenant['id']}"].status == "refused"
    assert runs["platform"].status == "created"


def test_invalid_scope_is_rejected() -> None:
    with pytest.raises(Exception, match="Invalid audit scope"):
        svc.parse_scope("tenant:not-a-uuid")
    assert svc.parse_scope("platform") is None
    assert svc.parse_scope(f"tenant:{uuid.uuid4()}") is not None


def test_checkpoint_hash_is_stable_and_utc_normalised() -> None:
    from datetime import datetime, timedelta, timezone

    rid = uuid.uuid4()
    utc_time = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    other_zone = utc_time.astimezone(timezone(timedelta(hours=5, minutes=30)))
    args = dict(
        scope="platform",
        record_count=3,
        head_hash="a" * 64,
        prev_checkpoint_hash=GENESIS_HASH,
        last_record_id=rid,
        last_created_at=utc_time,
    )
    assert svc.compute_checkpoint_hash(created_at=utc_time, **args) == svc.compute_checkpoint_hash(
        created_at=other_zone, **args
    )


# ---------------------------------------------------------------- production config


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


def test_production_accepts_a_proper_checkpoint_key() -> None:
    validate_for_production(_prod())


def test_production_requires_the_checkpoint_key() -> None:
    with pytest.raises(InsecureProductionConfigError, match="AUDIT_CHECKPOINT_HMAC_KEY is unset"):
        validate_for_production(_prod(audit_checkpoint_hmac_key=""))


def test_production_rejects_a_short_checkpoint_key() -> None:
    with pytest.raises(InsecureProductionConfigError, match="at least 32"):
        validate_for_production(_prod(audit_checkpoint_hmac_key="short-key"))


@pytest.mark.parametrize(
    "field",
    ["ai_credential_encryption_key", "smtp_password", "s3_secret_access_key"],
)
def test_production_rejects_a_checkpoint_key_reused_from_another_secret(field: str) -> None:
    shared = "kEdknj1w6XzjMsv2T86nToujCkYjMqSYnr3CoPxuKAI="
    overrides = {"audit_checkpoint_hmac_key": shared, field: shared}
    with pytest.raises(InsecureProductionConfigError, match="must differ"):
        validate_for_production(_prod(**overrides))


def test_production_rejects_a_checkpoint_key_embedded_in_a_database_url() -> None:
    key = "Zk3p9vQw1LrT7yUaXc5NmB8dEh2GfJ4sRt6VnKo0WiA"
    url = f"postgresql+psycopg://real_user:{key}@db.internal:5432/qtesthub"
    with pytest.raises(InsecureProductionConfigError, match="must differ"):
        validate_for_production(_prod(database_url=url))


def test_dev_without_a_key_uses_the_dev_fallback() -> None:
    validate_for_production(Settings())  # non-production: never checked
    assert (
        svc.sign("0" * 64)
        == hmac.new(svc._DEV_ONLY_KEY.encode(), ("0" * 64).encode(), hashlib.sha256).hexdigest()
    )


# ---------------------------------------------------- since_checkpoint (ADR-087)


def test_since_checkpoint_walks_only_the_tail(tenant: dict) -> None:
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    _create(client)
    full = client.get(TENANT_VERIFY).json()["data"]
    _add_user(client, "m2@horizon.com")
    fast = client.get(TENANT_VERIFY, params={"since_checkpoint": "true"}).json()["data"]
    assert fast["valid"] is True
    assert fast["skipped_count"] == full["checked_count"]
    assert 0 < fast["checked_count"] < full["checked_count"] + 5
    # The default is unchanged: a full walk, nothing skipped.
    again = client.get(TENANT_VERIFY).json()["data"]
    assert again["skipped_count"] == 0
    assert again["checked_count"] == fast["checked_count"] + fast["skipped_count"]


def test_since_checkpoint_without_checkpoints_is_a_full_walk(tenant: dict) -> None:
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    full = client.get(TENANT_VERIFY).json()["data"]
    fast = client.get(TENANT_VERIFY, params={"since_checkpoint": "true"}).json()["data"]
    assert fast["skipped_count"] == 0
    assert fast["checked_count"] == full["checked_count"]


def test_since_checkpoint_still_catches_tampering_after_the_checkpoint(
    tenant: dict, owner_engine
) -> None:
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    _create(client)
    _add_user(client, "m2@horizon.com")
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE audit_logs SET action = 'user.forged' WHERE id = (SELECT id FROM "
                "audit_logs WHERE tenant_id = :t ORDER BY created_at DESC, id DESC LIMIT 1)"
            ),
            {"t": tenant["id"]},
        )
    fast = client.get(TENANT_VERIFY, params={"since_checkpoint": "true"}).json()["data"]
    assert fast["valid"] is False
    assert fast["broken_at_id"] is not None


def test_since_checkpoint_skips_rows_before_the_checkpoint_by_design(
    tenant: dict, owner_engine
) -> None:
    """Documents the trade-off: a hash-breaking edit INSIDE the checkpointed
    prefix is caught by the default full walk but not by the fast mode."""
    client = tenant["client"]
    _add_user(client, "m1@horizon.com")
    _create(client)
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE audit_logs SET action = 'user.forged' WHERE id = (SELECT id FROM "
                "audit_logs WHERE tenant_id = :t ORDER BY created_at, id LIMIT 1)"
            ),
            {"t": tenant["id"]},
        )
    assert client.get(TENANT_VERIFY).json()["data"]["valid"] is False
    assert (
        client.get(TENANT_VERIFY, params={"since_checkpoint": "true"}).json()["data"]["valid"]
        is True
    )
