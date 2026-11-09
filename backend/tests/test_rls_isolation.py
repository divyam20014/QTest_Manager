"""Phase 9: systematic cross-tenant RLS verification across every
tenant-scoped table that now has real data flowing through it (Phases 2-8).
Earlier phases each verified isolation for their own module's tables;
this file is the full-system sweep, including a direct-SQL check (as the
app role, bypassing the API/service layer entirely) to prove RLS itself
is the enforcement mechanism, not just service-layer filtering."""

from fastapi.testclient import TestClient
from sqlalchemy import text


def _bootstrap_tenant(client: TestClient, platform_admin: dict, name: str, email: str) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": name,
            "admin_name": "Admin",
            "admin_email": email,
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


def _build_full_tenant_dataset(
    client: TestClient, platform_admin: dict, name: str, email: str
) -> dict:
    """Creates one of everything: project, test case (+version+steps), test
    run (+run case+execution steps), and a defect — so every tenant-scoped
    table in the schema has at least one row to attempt to leak."""
    bootstrap = _bootstrap_tenant(client, platform_admin, name, email)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, email, "AdminPassw0rd!")

    project = client.post(
        "/api/v1/projects",
        json={
            "name": f"{name} Project",
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000",
            "region": "NA",
        },
    ).json()["data"]

    case = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": f"{name} Test Case",
            "priority": "High",
            "steps": [{"action": "Do X", "expected": "Y happens"}],
        },
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": f"{name} Run", "run_type": "Smoke", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "fail"})

    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": steps[0]["id"], "severity": "Critical"}
    ).json()["data"]

    return {
        "tenant_id": tenant_id,
        "project": project,
        "case": case,
        "run": run,
        "run_case_id": run_case_id,
        "step": steps[0],
        "defect": defect,
    }


def test_cross_tenant_isolation_across_every_module_via_api(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_a = _build_full_tenant_dataset(client, platform_admin, "Tenant Alpha", "admin@alpha.com")

    tenant_b_client = TestClient(client.app)
    tenant_b = _build_full_tenant_dataset(
        tenant_b_client, platform_admin, "Tenant Beta", "admin@beta.com"
    )
    assert tenant_a["tenant_id"] != tenant_b["tenant_id"]

    # Tenant B's authenticated admin tries to reach every one of Tenant A's
    # objects by id directly -- every single one must come back as if it
    # doesn't exist (404/403), never as Tenant A's actual data.
    probes = [
        ("GET", f"/api/v1/projects/{tenant_a['project']['id']}"),
        ("GET", f"/api/v1/test-cases/{tenant_a['case']['id']}"),
        ("GET", f"/api/v1/test-cases/{tenant_a['case']['id']}/versions"),
        ("GET", f"/api/v1/test-runs/{tenant_a['run']['id']}"),
        ("GET", f"/api/v1/test-run-cases/{tenant_a['run_case_id']}/steps"),
        ("GET", f"/api/v1/defects/{tenant_a['defect']['id']}"),
    ]
    for method, path in probes:
        response = tenant_b_client.request(method, path)
        assert response.status_code in (
            403,
            404,
        ), f"{method} {path} leaked: {response.status_code} {response.text}"

    # List endpoints must never include the other tenant's rows either.
    project_ids = {p["id"] for p in tenant_b_client.get("/api/v1/projects").json()["data"]}
    assert tenant_a["project"]["id"] not in project_ids

    defect_ids = {d["id"] for d in tenant_b_client.get("/api/v1/defects").json()["data"]}
    assert tenant_a["defect"]["id"] not in defect_ids


def test_cross_tenant_isolation_at_the_database_layer(
    client: TestClient, platform_admin: dict, owner_engine
) -> None:
    """Bypasses the API/service layer entirely: connects as the actual
    least-privilege app role and proves RLS itself -- not application code
    -- is what blocks cross-tenant reads."""
    from app.core.db import SessionLocal, set_tenant_context

    tenant_a = _build_full_tenant_dataset(client, platform_admin, "Tenant Gamma", "admin@gamma.com")
    tenant_b_client = TestClient(client.app)
    tenant_b = _build_full_tenant_dataset(
        tenant_b_client, platform_admin, "Tenant Delta", "admin@delta.com"
    )

    db = SessionLocal()
    try:
        set_tenant_context(db, tenant_b["tenant_id"])

        tenant_scoped_tables_and_ids = [
            ("projects", tenant_a["project"]["id"]),
            ("test_cases", tenant_a["case"]["id"]),
            ("test_runs", tenant_a["run"]["id"]),
            ("execution_steps", tenant_a["step"]["id"]),
            ("defects", tenant_a["defect"]["id"]),
        ]
        for table, row_id in tenant_scoped_tables_and_ids:
            count = db.execute(
                text(f"SELECT count(*) FROM {table} WHERE id = :id"), {"id": row_id}
            ).scalar_one()
            assert (
                count == 0
            ), f"RLS leak: {table} row {row_id} (Tenant Gamma) visible under Tenant Delta context"

        # Sanity check: the same queries DO find the rows under the correct
        # tenant context, proving this isn't just a broken/no-op query.
        set_tenant_context(db, tenant_a["tenant_id"])
        for table, row_id in tenant_scoped_tables_and_ids:
            count = db.execute(
                text(f"SELECT count(*) FROM {table} WHERE id = :id"), {"id": row_id}
            ).scalar_one()
            assert (
                count == 1
            ), f"Sanity check failed: {table} row {row_id} not visible under its own tenant"
    finally:
        db.close()


def test_no_tenant_context_denies_all_tenant_scoped_reads() -> None:
    """A session that never calls set_tenant_context (e.g. a bug that skips
    it) must see zero rows across tenant-scoped tables -- default-deny, not
    default-allow (this is what migration 567fa7545de9's NULLIF fix
    protects)."""
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        for table in ["projects", "test_cases", "test_runs", "execution_steps", "defects", "users"]:
            count = db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
            assert (
                count == 0
            ), f"{table} returned rows with no tenant context set -- RLS default-deny is broken"
    finally:
        db.close()
