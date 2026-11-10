"""Phase 9: audit log hardening verification (ADR-006). Exercises the full
hash chain against real accumulated data (not a unit test of the hashing
function in isolation) and confirms the insert-only DB grant actually holds
for the application's own role under realistic conditions."""

import hashlib
import json

from fastapi.testclient import TestClient
from sqlalchemy import text

GENESIS_HASH = "0" * 64


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


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


def _run_full_scenario(client: TestClient, platform_admin: dict) -> str:
    """Touches every module that writes an audit event: platform bootstrap,
    auth, user management, projects, test cases (+approval), test runs
    (+verdict), and defects (+status change)."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    client.post(
        "/api/v1/users",
        json={
            "email": "manager@horizon.com",
            "name": "Manager One",
            "role": "manager",
            "password": "ManagerPassw0rd!",
        },
    )

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

    case = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "Verify Settlement",
            "priority": "High",
            "steps": [{"action": "Do X", "expected": "Y"}],
        },
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Sprint Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "fail"})

    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": steps[0]["id"], "severity": "Critical"}
    ).json()["data"]
    client.patch(f"/api/v1/defects/{defect['id']}/status", json={"status": "Open"})

    client.post("/api/v1/auth/logout")
    return tenant_id


def test_audit_hash_chain_is_internally_consistent(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    tenant_id = _run_full_scenario(client, platform_admin)

    with owner_engine.begin() as conn:
        rows = (
            conn.execute(
                text(
                    "SELECT tenant_id, user_id, platform_admin_id, action, entity_type, "
                    "entity_id, metadata, prev_hash, record_hash, created_at FROM audit_logs "
                    "WHERE tenant_id = :tenant_id ORDER BY created_at, ctid"
                ),
                {"tenant_id": tenant_id},
            )
            .mappings()
            .all()
        )

    assert len(rows) >= 8, "expected at least one audit row per module touched in the scenario"

    expected_prev_hash = GENESIS_HASH
    for row in rows:
        payload = {
            "tenant_id": str(row["tenant_id"]),
            "user_id": str(row["user_id"]) if row["user_id"] else None,
            "platform_admin_id": (
                str(row["platform_admin_id"]) if row["platform_admin_id"] else None
            ),
            "action": row["action"],
            "entity_type": row["entity_type"],
            "entity_id": str(row["entity_id"]),
            "metadata": row["metadata"],
            "created_at": row["created_at"].isoformat(),
            "prev_hash": row["prev_hash"],
        }
        recomputed = hashlib.sha256(_canonical(payload).encode()).hexdigest()

        assert row["prev_hash"] == expected_prev_hash, (
            f"chain broken at action={row['action']}: expected prev_hash={expected_prev_hash}, "
            f"got {row['prev_hash']}"
        )
        assert (
            recomputed == row["record_hash"]
        ), f"hash mismatch for action={row['action']} -- row was tampered or corrupted"
        expected_prev_hash = row["record_hash"]


def test_every_touched_module_writes_an_audit_event(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    tenant_id = _run_full_scenario(client, platform_admin)

    with owner_engine.begin() as conn:
        actions = set(
            conn.execute(
                text("SELECT action FROM audit_logs WHERE tenant_id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            .scalars()
            .all()
        )

    expected = {
        "tenant.created",
        "user.created",  # bootstrap admin
        "auth.login_attempted",
        "auth.mfa_verified",
        "project.created",
        "testcase.created",
        "testcase.submitted_for_review",
        "testcase.approved",
        "testrun.created",
        "executionstep.verdict_recorded",
        "defect.created",
        "defect.status_changed",
        "auth.logout",
    }
    missing = expected - actions
    assert not missing, f"expected audit actions missing from the log: {missing}"


def test_audit_logs_are_insert_only_for_the_application_role(
    client: TestClient, platform_admin: dict
) -> None:
    """Re-verifies ADR-006 as an automated regression test (Phase 1 checked
    this manually via psql; this makes it durable)."""
    from app.core.db import SessionLocal

    _run_full_scenario(client, platform_admin)

    db = SessionLocal()
    try:
        update_failed = False
        try:
            db.execute(text("UPDATE audit_logs SET action = 'tampered' WHERE true"))
            db.commit()
        except Exception:
            update_failed = True
            db.rollback()
        assert (
            update_failed
        ), "app role was able to UPDATE audit_logs -- ADR-006 insert-only guarantee is broken"

        delete_failed = False
        try:
            db.execute(text("DELETE FROM audit_logs"))
            db.commit()
        except Exception:
            delete_failed = True
            db.rollback()
        assert (
            delete_failed
        ), "app role was able to DELETE audit_logs -- ADR-006 insert-only guarantee is broken"
    finally:
        db.close()
