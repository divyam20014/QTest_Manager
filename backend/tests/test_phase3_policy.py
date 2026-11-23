"""RBAC/PBAC/ABAC plan, Phase 3: project_membership (as `require_resource_permission`,
reusing Phase 1's project-role override for resource-id-keyed routes) and
resource_not_locked (blocks editing a Closed defect via the generic PATCH).

Mirrors the fixture/helper pattern established in test_project_role_scoping.py
(Phase 1).
"""

from fastapi.testclient import TestClient


def _bootstrap_tenant(client: TestClient, platform_admin: dict, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": tenant_name,
            "admin_name": "Admin A",
            "admin_email": f"admin@{tenant_name.lower().replace(' ', '')}.example.com",
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


def _create_user(client: TestClient, email: str, name: str, role: str, password: str) -> str:
    response = client.post(
        "/api/v1/users", json={"email": email, "name": name, "role": role, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _create_project(client: TestClient, name: str, domain: str = "Motor") -> dict:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "domain": domain,
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


def _role_id_by_code(client: TestClient, code: str) -> str:
    roles = client.get("/api/v1/roles").json()["data"]
    match = next(r for r in roles if r["code"] == code)
    return match["id"]


def _create_test_case(client: TestClient, project_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": [{"action": "a", "expected": "b"}]},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_resource_id_keyed_route_still_denies_tester_without_override(
    client: TestClient, platform_admin: dict
) -> None:
    """Regression: `require_resource_permission` must behave exactly like
    the plain `require_permission` it replaced when there's no project-role
    override -- a tester (lacking testcase.approve tenant-wide) is still
    denied approving a test case."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "Northfield Casualty")
    tenant_id = bootstrap["tenant"]["id"]
    admin_email = "admin@northfieldcasualty.example.com"
    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")
    project = _create_project(client, "Northfield Claims")
    tester_id = _create_user(
        client, "tester@northfieldcasualty.example.com", "Tess Tester", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    case = _create_test_case(client, project["id"], "Baseline case")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")

    _login_and_verify(client, tenant_id, "tester@northfieldcasualty.example.com", "TesterPassw0rd!")
    resp = client.post(f"/api/v1/test-cases/{case['id']}/approve")
    assert resp.status_code == 403, resp.text

    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")


def test_project_role_override_grants_approval_on_resource_id_keyed_route(
    client: TestClient, platform_admin: dict
) -> None:
    """The real Phase 3 gap this closes: a project-scoped role override
    (Phase 1) now actually takes effect on a resource-id-keyed route
    (`/test-cases/{id}/approve`), not just on `project_id`-path routes."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "Riverbend Mutual")
    tenant_id = bootstrap["tenant"]["id"]
    admin_email = "admin@riverbendmutual.example.com"
    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")
    project = _create_project(client, "Riverbend Claims")
    tester_id = _create_user(
        client, "tester@riverbendmutual.example.com", "Tess Tester", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    case = _create_test_case(client, project["id"], "Case pending approval")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")

    manager_role_id = _role_id_by_code(client, "manager")
    set_resp = client.patch(
        f"/api/v1/projects/{project['id']}/members/{tester_id}/role",
        json={"role_id": manager_role_id},
    )
    assert set_resp.status_code == 200, set_resp.text

    _login_and_verify(client, tenant_id, "tester@riverbendmutual.example.com", "TesterPassw0rd!")
    resp = client.post(f"/api/v1/test-cases/{case['id']}/approve")
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["status"] == "approved"

    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")


def test_project_role_override_does_not_leak_to_test_case_in_other_project(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin, "Cascade Reinsurance")
    tenant_id = bootstrap["tenant"]["id"]
    admin_email = "admin@cascadereinsurance.example.com"
    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")
    project_a = _create_project(client, "Cascade Claims")
    project_b = _create_project(client, "Cascade Property", domain="Property")
    tester_id = _create_user(
        client, "tester@cascadereinsurance.example.com", "Tess Tester", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_a['id']}/members", json={"user_id": tester_id})
    client.post(f"/api/v1/projects/{project_b['id']}/members", json={"user_id": tester_id})

    manager_role_id = _role_id_by_code(client, "manager")
    client.patch(
        f"/api/v1/projects/{project_a['id']}/members/{tester_id}/role",
        json={"role_id": manager_role_id},
    )

    case_b = _create_test_case(client, project_b["id"], "Case in non-overridden project")
    client.post(f"/api/v1/test-cases/{case_b['id']}/submit-review")

    _login_and_verify(client, tenant_id, "tester@cascadereinsurance.example.com", "TesterPassw0rd!")
    resp = client.post(f"/api/v1/test-cases/{case_b['id']}/approve")
    assert resp.status_code == 403, resp.text

    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")


def _close_defect(client: TestClient, defect_id: str) -> None:
    for status in ("Open", "Fixed", "Verified"):
        resp = client.patch(f"/api/v1/defects/{defect_id}/status", json={"status": status})
        assert resp.status_code == 200, resp.text
    resp = client.patch(
        f"/api/v1/defects/{defect_id}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )
    assert resp.status_code == 200, resp.text


def test_resource_not_locked_blocks_editing_a_closed_defect(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin, "Summit Harbor Insurance")
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(
        client, tenant_id, "admin@summitharborinsurance.example.com", "AdminPassw0rd!"
    )
    project = _create_project(client, "Summit Harbor Claims")
    create_resp = client.post(
        "/api/v1/defects",
        json={"project_id": project["id"], "title": "Premium miscalculation", "severity": "High"},
    )
    assert create_resp.status_code == 200, create_resp.text
    defect = create_resp.json()["data"]

    # Unlocked: a plain edit succeeds.
    edit_resp = client.patch(f"/api/v1/defects/{defect['id']}", json={"title": "Updated title"})
    assert edit_resp.status_code == 200, edit_resp.text

    _close_defect(client, defect["id"])

    # Locked: the generic edit route is now blocked by resource_not_locked.
    blocked_resp = client.patch(
        f"/api/v1/defects/{defect['id']}", json={"title": "Should not apply"}
    )
    assert blocked_resp.status_code == 403, blocked_resp.text


def test_resource_not_locked_does_not_block_the_reopen_endpoint(
    client: TestClient, platform_admin: dict
) -> None:
    """The lock must not make a Closed defect permanently stuck -- the
    dedicated reopen/status endpoints are deliberately NOT wired to this
    rule, since they're the sanctioned way to change a locked resource's
    state."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "Vantage Point Casualty")
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(
        client, tenant_id, "admin@vantagepointcasualty.example.com", "AdminPassw0rd!"
    )
    project = _create_project(client, "Vantage Point Claims")
    create_resp = client.post(
        "/api/v1/defects",
        json={"project_id": project["id"], "title": "NCB discount bug", "severity": "Critical"},
    )
    defect = create_resp.json()["data"]
    _close_defect(client, defect["id"])

    reopen_resp = client.post(f"/api/v1/defects/{defect['id']}/reopen")
    assert reopen_resp.status_code == 200, reopen_resp.text
    assert reopen_resp.json()["data"]["status"] == "Reopened"  # ADR-118

    # And once reopened, the generic edit route works again.
    edit_resp = client.patch(
        f"/api/v1/defects/{defect['id']}", json={"title": "Edited after reopen"}
    )
    assert edit_resp.status_code == 200, edit_resp.text
