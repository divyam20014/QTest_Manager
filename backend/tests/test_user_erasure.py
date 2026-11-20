"""ADR-086 (GAP-03): user personal-data erasure.

Every test runs on throwaway tenants created through the platform API (the
conftest truncates tenants after each test); nothing here can touch dev data.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

PW = "UserPassw0rd!xx"


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


def _add_user(client: TestClient, email: str, name: str, role: str) -> str:
    response = client.post(
        "/api/v1/users", json={"email": email, "name": name, "role": role, "password": PW}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _erase(client: TestClient, user_id: str, **body):
    return client.post(f"/api/v1/users/{user_id}/erase", json=body)


@pytest.fixture
def tenant(client: TestClient, platform_admin: dict) -> dict:
    """Admin signed in on `client`, plus a tester (with a live session on their own
    client, a notification and a comment), a manager, and a second admin."""
    tenant_id = _bootstrap(client, platform_admin, "Horizon Mutual", "admin@horizon.com")
    _login(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    admin_id = client.get("/api/v1/auth/me").json()["data"]["user_id"]
    tester_id = _add_user(client, "tester.person@horizon.com", "Tester Person", "tester")
    manager_id = _add_user(client, "manager@horizon.com", "Manager M", "manager")
    admin2_id = _add_user(client, "admin2@horizon.com", "Admin Two", "admin")

    project = client.post(
        "/api/v1/projects",
        json={
            "name": "Apex Motor Claims",
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000",
            "region": "NA",
        },
    ).json()["data"]
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    case = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "Verify Settlement",
            "priority": "High",
            "steps": [{"action": "A", "expected": "B"}],
        },
    ).json()["data"]
    # A notification for the tester (admin mentions them)...
    client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "Please review", "mentioned_user_ids": [tester_id]},
    )
    # ...and a comment the tester authors (a business record that must survive).
    tester_client = TestClient(client.app)
    _login(tester_client, tenant_id, "tester.person@horizon.com", PW)
    comment = tester_client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "Reviewed, looks fine", "mentioned_user_ids": [admin_id]},
    )
    assert comment.status_code == 200, comment.text
    return {
        "id": tenant_id,
        "client": client,
        "platform": platform_admin,
        "admin_id": admin_id,
        "tester_id": tester_id,
        "manager_id": manager_id,
        "admin2_id": admin2_id,
        "tester_client": tester_client,
        "case_id": case["id"],
    }


def _row(owner_engine, sql: str, **params):
    with owner_engine.connect() as conn:
        return conn.execute(text(sql), params).all()


def test_dry_run_is_default_and_changes_nothing(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    response = _erase(client, tenant["tester_id"])  # no body fields at all
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["dry_run"] is True and data["erased"] is False
    assert data["changes"]["sessions_revoked"] == 1
    assert data["changes"]["notifications_deleted"] == 1
    assert data["retained"]["comments"] == 1

    user = next(
        u for u in client.get("/api/v1/users").json()["data"] if u["id"] == tenant["tester_id"]
    )
    assert user["name"] == "Tester Person" and user["is_active"] is True
    assert user["erased_at"] is None
    assert tenant["tester_client"].get("/api/v1/auth/me").status_code == 200
    n = _row(
        owner_engine,
        "SELECT count(*) FROM notifications WHERE recipient_id = :u",
        u=tenant["tester_id"],
    )
    assert n[0][0] == 1
    assert not _row(owner_engine, "SELECT 1 FROM audit_logs WHERE action = 'user.erased'")


def test_real_run_anonymises_and_closes_the_account(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    response = _erase(
        client, tenant["tester_id"], dry_run=False, confirm_email="Tester.Person@horizon.com"
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["erased"] is True

    user = next(
        u for u in client.get("/api/v1/users").json()["data"] if u["id"] == tenant["tester_id"]
    )
    assert user["name"] == "Erased user"
    assert user["email"].startswith("erased-") and user["email"].endswith("@erased.invalid")
    assert user["is_active"] is False and user["erased_at"] is not None

    # The live session is dead and the old credentials no longer sign in.
    assert tenant["tester_client"].get("/api/v1/auth/me").status_code == 401
    login = TestClient(client.app).post(
        "/api/v1/auth/login",
        json={
            "tenant_id": tenant["id"],
            "email": "tester.person@horizon.com",
            "password": PW,
        },
    )
    assert login.status_code in (401, 403)
    assert not _row(
        owner_engine,
        "SELECT 1 FROM sessions WHERE user_id = :u AND revoked_at IS NULL",
        u=tenant["tester_id"],
    )

    # Notifications removed; the comment they wrote is kept under their (now
    # pseudonymous) id and renders as "Erased user".
    assert (
        _row(
            owner_engine,
            "SELECT count(*) FROM notifications WHERE recipient_id = :u",
            u=tenant["tester_id"],
        )[0][0]
        == 0
    )
    comments = client.get(f"/api/v1/test-cases/{tenant['case_id']}/comments").json()["data"]
    mine = next(c for c in comments if c["body"] == "Reviewed, looks fine")
    assert mine["author_id"] == tenant["tester_id"]
    assert mine["author_name"] == "Erased user"


def test_erased_account_cannot_be_reopened_or_edited(tenant: dict) -> None:
    client = tenant["client"]
    uid = tenant["tester_id"]
    assert (
        _erase(client, uid, dry_run=False, confirm_email="tester.person@horizon.com").status_code
        == 200
    )
    assert client.patch(f"/api/v1/users/{uid}", json={"is_active": True}).status_code == 409
    assert client.patch(f"/api/v1/users/{uid}", json={"name": "Back"}).status_code == 409
    assert (
        client.post(f"/api/v1/users/{uid}/reset-password", json={"new_password": PW}).status_code
        == 409
    )


def test_invites_and_report_recipients_are_cleaned(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    email = "tester.person@horizon.com"
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO report_schedules (tenant_id, report_type, cadence, recipient_emails,"
                " enabled, created_by) VALUES (:t, 'compliance', 'weekly',"
                " ARRAY[:e, 'keep@horizon.com'], true, :u)"
            ),
            {"t": tenant["id"], "e": email, "u": tenant["admin_id"]},
        )
        conn.execute(
            text(
                "INSERT INTO user_invites (tenant_id, email, name, role_id, invited_by, token_hash,"
                " expires_at) SELECT :t, :e, 'Tester Person', id, :u, 'h', now() + interval '1 day'"
                " FROM roles WHERE code = 'tester'"
            ),
            {"t": tenant["id"], "e": email, "u": tenant["admin_id"]},
        )
    preview = _erase(client, tenant["tester_id"]).json()["data"]["changes"]
    assert preview["user_invites_anonymised"] == 1
    assert preview["report_schedule_recipients_removed"] == 1

    assert (
        _erase(client, tenant["tester_id"], dry_run=False, confirm_email=email).status_code == 200
    )
    recipients = _row(owner_engine, "SELECT recipient_emails FROM report_schedules")[0][0]
    assert recipients == ["keep@horizon.com"]
    invite = _row(owner_engine, "SELECT email, name, token_hash FROM user_invites")[0]
    assert invite.name == "Erased user" and invite.email.endswith("@erased.invalid")
    assert invite.token_hash == "erased"


def test_audit_chain_and_checkpoints_still_verify(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    assert client.post("/api/v1/audit-logs/checkpoints").json()["data"]["created"] is True
    before = _row(
        owner_engine,
        "SELECT id, record_hash, metadata FROM audit_logs "
        "WHERE tenant_id = :t ORDER BY created_at, id",
        t=tenant["id"],
    )

    assert (
        _erase(
            client, tenant["tester_id"], dry_run=False, confirm_email="tester.person@horizon.com"
        ).status_code
        == 200
    )

    verify = client.get("/api/v1/audit-logs/verify-chain").json()["data"]
    assert verify["valid"] is True and verify["checkpoint_failure"] is None
    assert verify["checkpoints_checked"] == 1
    # Existing rows are byte-for-byte what they were; the erasure only appended.
    after = _row(
        owner_engine,
        "SELECT id, record_hash, metadata FROM audit_logs "
        "WHERE tenant_id = :t ORDER BY created_at, id",
        t=tenant["id"],
    )
    assert [tuple(r) for r in after[: len(before)]] == [tuple(r) for r in before]
    assert len(after) == len(before) + 1
    # A checkpoint can still be created over the post-erasure chain.
    assert client.post("/api/v1/audit-logs/checkpoints").json()["data"]["created"] is True
    assert client.get("/api/v1/audit-logs/verify-chain").json()["data"]["valid"] is True


def test_audit_event_carries_no_personal_data(tenant: dict, owner_engine) -> None:
    client = tenant["client"]
    email = "tester.person@horizon.com"
    assert (
        _erase(client, tenant["tester_id"], dry_run=False, confirm_email=email).status_code == 200
    )
    row = _row(
        owner_engine,
        "SELECT user_id, entity_id, metadata FROM audit_logs WHERE action = 'user.erased'",
    )[0]
    assert str(row.user_id) == tenant["admin_id"] and str(row.entity_id) == tenant["tester_id"]
    blob = json.dumps(row.metadata).lower()
    for forbidden in (email, "tester person", "tester.person", "horizon.com"):
        assert forbidden not in blob
    assert set(row.metadata) == {"changes"}


def test_self_erase_refused(tenant: dict) -> None:
    response = _erase(
        tenant["client"], tenant["admin_id"], dry_run=False, confirm_email="admin@horizon.com"
    )
    assert response.status_code == 409
    assert _erase(tenant["client"], tenant["admin_id"]).status_code == 409  # dry run too


def test_deactivated_peer_admin_can_be_erased_while_another_admin_remains(tenant: dict) -> None:
    client = tenant["client"]
    resp = client.patch(f"/api/v1/users/{tenant['admin2_id']}", json={"is_active": False})
    assert resp.status_code == 200
    ok = _erase(client, tenant["admin2_id"], dry_run=False, confirm_email="admin2@horizon.com")
    assert ok.status_code == 200, ok.text


def test_last_admin_guard_blocks_erasing_the_only_active_admin(
    client: TestClient, platform_admin: dict
) -> None:
    """Needs two different actors, so the actor is a custom role holding user.erase."""
    tenant_id = _bootstrap(client, platform_admin, "Solo Admin Co", "solo@horizon.com")
    _login(client, tenant_id, "solo@horizon.com", "AdminPassw0rd!")
    solo_id = client.get("/api/v1/auth/me").json()["data"]["user_id"]
    role = client.post(
        "/api/v1/roles",
        json={"name": "Data Protection Officer", "permission_codes": ["user.erase"]},
    )
    assert role.status_code == 200, role.text
    dpo_role_id = role.json()["data"]["id"]
    resp = client.post(
        "/api/v1/users",
        json={
            "email": "dpo@horizon.com",
            "name": "DPO",
            "role_id": dpo_role_id,
            "password": PW,
        },
    )
    assert resp.status_code == 200, resp.text
    dpo = TestClient(client.app)
    _login(dpo, tenant_id, "dpo@horizon.com", PW)
    refused = _erase(dpo, solo_id, dry_run=False, confirm_email="solo@horizon.com")
    assert refused.status_code == 409
    assert "last remaining Admin" in refused.json()["error"]["message"]


def test_double_erase_is_409(tenant: dict) -> None:
    client = tenant["client"]
    email = "tester.person@horizon.com"
    assert (
        _erase(client, tenant["tester_id"], dry_run=False, confirm_email=email).status_code == 200
    )
    again = _erase(client, tenant["tester_id"], dry_run=False, confirm_email=email)
    assert again.status_code == 409
    assert _erase(client, tenant["tester_id"]).status_code == 409


def test_wrong_or_missing_confirm_email_refused_and_nothing_changes(tenant: dict) -> None:
    client = tenant["client"]
    for body in (
        {"dry_run": False},
        {"dry_run": False, "confirm_email": "someone.else@horizon.com"},
        {"dry_run": False, "confirm_email": "ERASE"},
    ):
        response = _erase(client, tenant["tester_id"], **body)
        assert response.status_code == 422, response.text
    assert tenant["tester_client"].get("/api/v1/auth/me").status_code == 200
    user = next(
        u for u in client.get("/api/v1/users").json()["data"] if u["id"] == tenant["tester_id"]
    )
    assert user["name"] == "Tester Person"


def test_manager_and_tester_get_403(tenant: dict) -> None:
    manager = TestClient(tenant["client"].app)
    _login(manager, tenant["id"], "manager@horizon.com", PW)
    assert _erase(manager, tenant["tester_id"]).status_code == 403
    assert (
        _erase(manager, tenant["tester_id"], dry_run=False, confirm_email="x@y.com").status_code
        == 403
    )
    assert _erase(tenant["tester_client"], tenant["manager_id"]).status_code == 403
    assert (
        TestClient(tenant["client"].app)
        .post(f"/api/v1/users/{tenant['tester_id']}/erase", json={})
        .status_code
        == 401
    )


def test_only_admin_role_holds_the_permission(tenant: dict, owner_engine) -> None:
    rows = _row(
        owner_engine,
        "SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id "
        "JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'user.erase' AND r.is_system",
    )
    assert [r[0] for r in rows] == ["admin"]


def test_cross_tenant_id_is_404(tenant: dict, client: TestClient) -> None:
    other = TestClient(client.app)
    other_tenant = _bootstrap(other, tenant["platform"], "Other Insurer", "admin@other-insurer.com")
    _login(other, other_tenant, "admin@other-insurer.com", "AdminPassw0rd!")
    assert _erase(other, tenant["tester_id"]).status_code == 404
    assert (
        _erase(
            other, tenant["tester_id"], dry_run=False, confirm_email="tester.person@horizon.com"
        ).status_code
        == 404
    )
    # and the user in the first tenant is untouched
    users = tenant["client"].get("/api/v1/users").json()["data"]
    assert next(u for u in users if u["id"] == tenant["tester_id"])["name"] == "Tester Person"
