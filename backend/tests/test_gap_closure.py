"""Gap-closure pass (ADR-057): subscription/billing enforcement, platform-
admin plan CRUD, IP-allowlist break-glass recovery, bulk module
reassignment, bulk builds/releases creation. See ADR-057 for the full
list of items this pass addressed."""

from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from fastapi.testclient import TestClient


def _bootstrap_tenant(
    client: TestClient, platform_admin: dict, name: str = "Horizon Mutual"
) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
            "admin_name": "Admin A",
            "admin_email": f"admin@{name.lower().replace(' ', '')}.com",
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


def _create_project(client: TestClient, name: str = "Apex Motor Claims") -> dict:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "450000.00",
            "region": "North America",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _create_case(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "Do the thing", "expected": "Thing happens"}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup_admin_email(name: str) -> str:
    return f"admin@{name.lower().replace(' ', '')}.com"


# ---------------------------------------------------------------------------
# Item 1: subscription/billing enforcement
# ---------------------------------------------------------------------------


def test_platform_admin_can_create_and_update_a_plan(
    client: TestClient, platform_admin: dict
) -> None:
    create = client.post(
        "/api/v1/platform/plans",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"code": "gap-closure-plan", "name": "Gap Closure Plan", "seat_limit": 3},
    )
    assert create.status_code == 200, create.text
    assert create.json()["data"]["seat_limit"] == 3

    update = client.patch(
        "/api/v1/platform/plans/gap-closure-plan",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"seat_limit": 5},
    )
    assert update.status_code == 200, update.text
    assert update.json()["data"]["seat_limit"] == 5
    assert update.json()["data"]["name"] == "Gap Closure Plan"


def test_duplicate_plan_code_rejected(client: TestClient, platform_admin: dict) -> None:
    client.post(
        "/api/v1/platform/plans",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"code": "dup-plan", "name": "Dup Plan"},
    )
    second = client.post(
        "/api/v1/platform/plans",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"code": "dup-plan", "name": "Dup Plan Again"},
    )
    assert second.status_code == 422, second.text


def test_seat_limit_blocks_user_creation_once_reached(
    client: TestClient, platform_admin: dict
) -> None:
    name = "SeatLimited Co"
    client.post(
        "/api/v1/platform/plans",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"code": "one-seat", "name": "One Seat Plan", "seat_limit": 1},
    )
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    client.put(
        f"/api/v1/platform/tenants/{tenant_id}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"plan_code": "one-seat", "status": "active"},
    )
    _login_and_verify(client, tenant_id, _setup_admin_email(name), "AdminPassw0rd!")

    # The admin created at tenant-bootstrap already consumes the single seat.
    response = client.post(
        "/api/v1/users",
        json={
            "email": "second@seatlimited.com",
            "name": "Second User",
            "role": "tester",
            "password": "SecondUserPassw0rd!",
        },
    )
    assert response.status_code == 409, response.text


def test_ai_quota_blocks_further_ai_calls_once_reached(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    from uuid import UUID

    import pytest
    from sqlalchemy import select

    from app.core.db import set_tenant_context
    from app.core.errors import ConflictError
    from app.models.ai_usage import AIUsageLog
    from app.models.identity import User
    from app.services import plan_limits

    name = "AIQuota Co"
    client.post(
        "/api/v1/platform/plans",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"code": "zero-ai", "name": "Zero AI Plan", "ai_monthly_request_limit": 1},
    )
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    client.put(
        f"/api/v1/platform/tenants/{tenant_id}/subscription",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={"plan_code": "zero-ai", "status": "active"},
    )
    tid = UUID(tenant_id)

    set_tenant_context(db_session, tenant_id)
    # No usage yet -- under the limit of 1, should not raise.
    plan_limits.enforce_ai_quota(db_session, tid)

    user_id = db_session.execute(select(User.id).where(User.tenant_id == tid)).scalar_one()
    db_session.add(
        AIUsageLog(
            tenant_id=tid,
            user_id=user_id,
            provider="gemini",
            action="generate",
            prompt_tokens=10,
            completion_tokens=10,
            total_tokens=20,
            success=True,
        )
    )
    db_session.commit()

    set_tenant_context(db_session, tenant_id)
    with pytest.raises(ConflictError):
        plan_limits.enforce_ai_quota(db_session, tid)


# ---------------------------------------------------------------------------
# Item 2: IP-allowlist break-glass recovery
# ---------------------------------------------------------------------------


def test_platform_admin_can_clear_ip_allowlist(client: TestClient, platform_admin: dict) -> None:
    name = "Allowlist Co"
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, _setup_admin_email(name), "AdminPassw0rd!")

    set_resp = client.patch(
        "/api/v1/settings", json={"ip_allowlist": ["10.0.0.0/8"]}
    )
    assert set_resp.status_code == 200, set_resp.text

    clear_resp = client.post(
        f"/api/v1/platform/tenants/{tenant_id}/clear-ip-allowlist",
        auth=(platform_admin["email"], platform_admin["password"]),
    )
    assert clear_resp.status_code == 200, clear_resp.text

    get_resp = client.get("/api/v1/settings")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["data"]["ip_allowlist"] in (None, [])


def test_clear_ip_allowlist_is_platform_admin_only(
    client: TestClient, platform_admin: dict
) -> None:
    name = "Allowlist Two Co"
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]

    response = client.post(f"/api/v1/platform/tenants/{tenant_id}/clear-ip-allowlist")
    assert response.status_code == 401, response.text


# ---------------------------------------------------------------------------
# Item 6: bulk module reassignment
# ---------------------------------------------------------------------------


def test_bulk_assign_module_moves_many_test_cases_at_once(
    client: TestClient, platform_admin: dict
) -> None:
    name = "BulkModule Co"
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, _setup_admin_email(name), "AdminPassw0rd!")
    project = _create_project(client)
    project_id = project["id"]

    case_a = _create_case(client, project_id, "Case A")
    case_b = _create_case(client, project_id, "Case B")

    module = client.post(f"/api/v1/projects/{project_id}/modules", json={"name": "Claims"})
    assert module.status_code == 200, module.text
    module_id = module.json()["data"]["id"]

    response = client.post(
        "/api/v1/test-cases/bulk-assign-module",
        json={"test_case_ids": [case_a["id"], case_b["id"]], "module_id": module_id},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["reassigned"] == 2

    detail_a = client.get(f"/api/v1/test-cases/{case_a['id']}")
    assert detail_a.json()["data"]["module_id"] == module_id


def test_bulk_assign_module_rejects_module_from_another_project(
    client: TestClient, platform_admin: dict
) -> None:
    name = "BulkModule Cross Co"
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, _setup_admin_email(name), "AdminPassw0rd!")
    project_a = _create_project(client, "Project A")
    project_b = _create_project(client, "Project B")

    case = _create_case(client, project_a["id"], "Case in A")
    module_b = client.post(
        f"/api/v1/projects/{project_b['id']}/modules", json={"name": "Module in B"}
    )
    module_b_id = module_b.json()["data"]["id"]

    response = client.post(
        "/api/v1/test-cases/bulk-assign-module",
        json={"test_case_ids": [case["id"]], "module_id": module_b_id},
    )
    assert response.status_code == 409, response.text


# ---------------------------------------------------------------------------
# Item 5: bulk builds/releases creation
# ---------------------------------------------------------------------------


def test_bulk_create_builds(client: TestClient, platform_admin: dict) -> None:
    name = "BulkBuild Co"
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, _setup_admin_email(name), "AdminPassw0rd!")
    project = _create_project(client)

    response = client.post(
        f"/api/v1/projects/{project['id']}/builds/bulk",
        json={"builds": [{"name": "Build 1"}, {"name": "Build 2"}, {"name": "Build 3"}]},
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["data"]) == 3

    listing = client.get(f"/api/v1/projects/{project['id']}/builds")
    assert len(listing.json()["data"]) == 3


def test_bulk_create_releases(client: TestClient, platform_admin: dict) -> None:
    name = "BulkRelease Co"
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, _setup_admin_email(name), "AdminPassw0rd!")
    project = _create_project(client)

    response = client.post(
        f"/api/v1/projects/{project['id']}/releases/bulk",
        json={"releases": [{"name": "Release 1"}, {"name": "Release 2"}]},
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["data"]) == 2


# ---------------------------------------------------------------------------
# Item 8 (GAP-12): load-test the audit hash-chain advisory lock under real
# concurrency -- never done before this pass. 25 threads, each its own real
# DB connection (not the same Session reused across threads), each
# appending one audit event (via a real defect-create call, which goes
# through record_audit_event + the pg_advisory_xact_lock serialization)
# for the SAME tenant at once. Asserts: none were dropped, and the chain
# re-verifies cleanly afterward -- i.e. the lock actually serialized the
# concurrent prev_hash reads rather than letting two transactions read the
# same "previous" hash and both write a now-ambiguous chain.
# ---------------------------------------------------------------------------


def test_audit_hash_chain_survives_concurrent_writes_to_the_same_tenant(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    from app.services import audit_service

    name = "AuditConcurrency Co"
    bootstrap = _bootstrap_tenant(client, platform_admin, name)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, _setup_admin_email(name), "AdminPassw0rd!")
    project = _create_project(client)

    THREAD_COUNT = 25

    def _create_defect(i: int) -> int:
        thread_client = TestClient(client.app)
        thread_client.cookies.update(client.cookies)
        response = thread_client.post(
            "/api/v1/defects",
            json={
                "project_id": project["id"],
                "title": f"Concurrent defect {i}",
                "severity": "Medium",
                "description": "Created by the audit concurrency load test",
            },
        )
        return response.status_code

    with ThreadPoolExecutor(max_workers=THREAD_COUNT) as pool:
        statuses = list(pool.map(_create_defect, range(THREAD_COUNT)))

    assert all(s == 200 for s in statuses), statuses

    from app.core.db import set_tenant_context

    set_tenant_context(db_session, tenant_id)
    result = audit_service.verify_chain(db_session, UUID(tenant_id))
    assert result.valid, result

    from sqlalchemy import func, select

    from app.models.audit import AuditLog

    defect_created_count = db_session.execute(
        select(func.count(AuditLog.id)).where(
            AuditLog.tenant_id == UUID(tenant_id), AuditLog.action == "defect.created"
        )
    ).scalar_one()
    # Every one of the 25 concurrent creates must have produced exactly
    # one audit row -- a lost/overwritten write under contention would
    # show up here as a count below 25 even if the chain still "looked"
    # internally consistent for the rows that did survive.
    assert defect_created_count == THREAD_COUNT
