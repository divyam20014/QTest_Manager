"""Post-gap-closure pass (ADR-059): machine-to-machine auth plane + CI/CD
result ingestion (PV-5, GAP-73). Service tokens (create/list/revoke,
tenant-admin-only), the CI webhook's own bearer auth (a wholly separate
scheme from the session cookie), scope enforcement, rate limiting, and
mapping an incoming result onto the existing per-step execution model."""

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


def _create_approved_case(client: TestClient, project_id: str, title: str) -> dict:
    steps = [
        {"action": "Input Policy Number", "expected": "ACV displayed"},
        {"action": "Apply $500 deductible", "expected": "Payout = ACV - 500"},
    ]
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": steps},
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    return client.post(f"/api/v1/test-cases/{case['id']}/approve").json()["data"]


def _setup_tenant_with_run(client: TestClient, platform_admin: dict) -> tuple[str, dict, dict]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    case = _create_approved_case(client, project["id"], "Verify Total Loss Settlement")
    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "CI Regression", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]
    return tenant_id, project, run


# -- Service token management (tenant-admin) ------------------------------


def test_create_service_token_requires_integration_manage_permission(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, _, _ = _setup_tenant_with_run(client, platform_admin)

    client.post(
        "/api/v1/users",
        json={
            "email": "tester@horizon.com",
            "name": "Tester",
            "role": "tester",
            "password": "TesterPassw0rd!",
        },
    )
    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    response = tester_client.post("/api/v1/service-tokens", json={"name": "CI token"})
    assert response.status_code == 403


def test_create_list_and_revoke_service_token(client: TestClient, platform_admin: dict) -> None:
    _setup_tenant_with_run(client, platform_admin)

    created = client.post("/api/v1/service-tokens", json={"name": "GitHub Actions"})
    assert created.status_code == 200, created.text
    body = created.json()["data"]
    assert body["raw_value"]
    token_id = body["token"]["id"]

    listed = client.get("/api/v1/service-tokens").json()["data"]
    assert any(t["id"] == token_id for t in listed)

    revoked = client.delete(f"/api/v1/service-tokens/{token_id}")
    assert revoked.status_code == 200, revoked.text


def test_revoked_service_token_can_no_longer_authenticate(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, run = _setup_tenant_with_run(client, platform_admin)
    created = client.post("/api/v1/service-tokens", json={"name": "GitHub Actions"}).json()["data"]
    raw_token = created["raw_value"]
    client.delete(f"/api/v1/service-tokens/{created['token']['id']}")

    run_case_id = run["cases"][0]["id"]
    response = client.post(
        f"/api/v1/ci/{tenant_id}/webhooks/test-results",
        headers={"Authorization": f"Bearer {raw_token}"},
        json={"results": [{"test_run_case_id": run_case_id, "status": "passed"}]},
    )
    assert response.status_code == 401


# -- CI webhook ingestion (bearer-token authenticated) --------------------


def test_webhook_rejects_missing_or_wrong_bearer_token(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, run = _setup_tenant_with_run(client, platform_admin)
    run_case_id = run["cases"][0]["id"]

    no_auth = client.post(
        f"/api/v1/ci/{tenant_id}/webhooks/test-results",
        json={"results": [{"test_run_case_id": run_case_id, "status": "passed"}]},
    )
    assert no_auth.status_code == 401

    wrong_token = client.post(
        f"/api/v1/ci/{tenant_id}/webhooks/test-results",
        headers={"Authorization": "Bearer not-a-real-token"},
        json={"results": [{"test_run_case_id": run_case_id, "status": "passed"}]},
    )
    assert wrong_token.status_code == 401


def test_webhook_marks_all_unverdicted_steps_with_the_reported_status(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, run = _setup_tenant_with_run(client, platform_admin)
    raw_token = client.post("/api/v1/service-tokens", json={"name": "GitHub Actions"}).json()[
        "data"
    ]["raw_value"]
    run_case_id = run["cases"][0]["id"]

    response = client.post(
        f"/api/v1/ci/{tenant_id}/webhooks/test-results",
        headers={"Authorization": f"Bearer {raw_token}"},
        json={"results": [{"test_run_case_id": run_case_id, "status": "failed"}]},
    )
    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert body["accepted_count"] == 1
    assert body["rejected_count"] == 0

    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    assert all(s["verdict"] == "fail" for s in steps)

    run_case = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["cases"][0]
    assert run_case["status"] == "failed"


def test_webhook_attributes_the_result_to_the_service_token_in_the_audit_log(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, run = _setup_tenant_with_run(client, platform_admin)
    created = client.post("/api/v1/service-tokens", json={"name": "GitHub Actions"}).json()["data"]
    raw_token, token_id = created["raw_value"], created["token"]["id"]
    run_case_id = run["cases"][0]["id"]

    client.post(
        f"/api/v1/ci/{tenant_id}/webhooks/test-results",
        headers={"Authorization": f"Bearer {raw_token}"},
        json={"results": [{"test_run_case_id": run_case_id, "status": "passed"}]},
    )

    logs = client.get(
        "/api/v1/audit-logs", params={"entity_type": "test_run_case", "entity_id": run_case_id}
    ).json()["data"]
    matching = [row for row in logs if row["action"] == "executionstep.verdict_recorded_via_ci"]
    assert matching
    assert matching[0]["service_token_id"] == token_id
    assert matching[0]["user_id"] is None


def test_webhook_rejects_an_unknown_test_run_case_without_sinking_the_batch(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, run = _setup_tenant_with_run(client, platform_admin)
    raw_token = client.post("/api/v1/service-tokens", json={"name": "GitHub Actions"}).json()[
        "data"
    ]["raw_value"]
    good_run_case_id = run["cases"][0]["id"]
    bad_run_case_id = "00000000-0000-0000-0000-000000000000"

    response = client.post(
        f"/api/v1/ci/{tenant_id}/webhooks/test-results",
        headers={"Authorization": f"Bearer {raw_token}"},
        json={
            "results": [
                {"test_run_case_id": bad_run_case_id, "status": "passed"},
                {"test_run_case_id": good_run_case_id, "status": "passed"},
            ]
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert body["accepted_count"] == 1
    assert body["rejected_count"] == 1


def test_webhook_cannot_be_used_against_another_tenants_run_case(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_a_id, project_a, run_a = _setup_tenant_with_run(client, platform_admin)
    raw_token_a = client.post("/api/v1/service-tokens", json={"name": "GitHub Actions"}).json()[
        "data"
    ]["raw_value"]

    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(other_client, platform_admin, name="Other Insurer")
    tenant_b_id = other_bootstrap["tenant"]["id"]
    _login_and_verify(other_client, tenant_b_id, "admin@horizon.com", "AdminPassw0rd!")
    project_b = _create_project(other_client, name="Other Project")
    case_b = _create_approved_case(other_client, project_b["id"], "Other Tenant Case")
    run_b = other_client.post(
        f"/api/v1/projects/{project_b['id']}/test-runs",
        json={"name": "Other Run", "run_type": "Regression", "test_case_ids": [case_b["id"]]},
    ).json()["data"]
    run_case_b_id = run_b["cases"][0]["id"]

    # Tenant A's token, posted to tenant A's own URL, naming tenant B's
    # run case -- RLS means tenant A's connection can't even see that row.
    response = client.post(
        f"/api/v1/ci/{tenant_a_id}/webhooks/test-results",
        headers={"Authorization": f"Bearer {raw_token_a}"},
        json={"results": [{"test_run_case_id": run_case_b_id, "status": "passed"}]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["rejected_count"] == 1

    # And tenant A's token is never valid against tenant B's URL at all.
    cross_tenant = client.post(
        f"/api/v1/ci/{tenant_b_id}/webhooks/test-results",
        headers={"Authorization": f"Bearer {raw_token_a}"},
        json={"results": [{"test_run_case_id": run_case_b_id, "status": "passed"}]},
    )
    assert cross_tenant.status_code == 401
