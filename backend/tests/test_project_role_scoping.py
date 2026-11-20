"""RBAC Phase 1: project-scoped role overrides on `project_members.role_id`.

Covers: (a) no-override behavior is unchanged from before this feature
existed (regression), (b) an override grants that role's permissions only
within that one project, (c) a user can hold different effective roles on
two different projects simultaneously, (d) clearing an override reverts to
the tenant-wide role immediately.
"""

from fastapi.testclient import TestClient


def _bootstrap_tenant(
    client: TestClient, platform_admin: dict, tenant_name: str = "Zenith Cover"
) -> dict:
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


def _setup_tenant_with_tester(
    client: TestClient, platform_admin: dict, tenant_name: str
) -> tuple[str, dict, str]:
    """Returns (tenant_id, project, tester_user_id); leaves `client` logged
    in as the tenant admin, with the tester already added as a project
    member with no role override (the default)."""
    bootstrap = _bootstrap_tenant(client, platform_admin, tenant_name)
    tenant_id = bootstrap["tenant"]["id"]
    admin_email = f"admin@{tenant_name.lower().replace(' ', '')}.example.com"
    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")
    project = _create_project(client, f"{tenant_name} Claims")
    tester_id = _create_user(
        client,
        f"tester@{tenant_name.lower().replace(' ', '')}.example.com",
        "Tess Tester",
        "tester",
        "TesterPassw0rd!",
    )
    add_resp = client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    assert add_resp.status_code == 200, add_resp.text
    return tenant_id, project, tester_id


def test_no_override_behaves_identically_to_before(
    client: TestClient, platform_admin: dict
) -> None:
    """Regression: a tester with no project-role override cannot create a
    test case needing a permission their tenant-wide role lacks (here:
    none needed, testcase.create is already in the tester permission set --
    the real regression check is requirement.manage, which testers lack)."""
    tenant_id, project, tester_id = _setup_tenant_with_tester(
        client, platform_admin, "Meridian Shield"
    )
    admin_email = "admin@meridianshield.example.com"
    _login_and_verify(client, tenant_id, "tester@meridianshield.example.com", "TesterPassw0rd!")

    # testcase.create: tester already holds this tenant-wide -- unchanged.
    resp = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "Baseline case",
            "priority": "High",
            "steps": [{"action": "a", "expected": "b"}],
        },
    )
    assert resp.status_code == 200, resp.text

    # requirement.manage: tester lacks this tenant-wide, and has no
    # override, so it must still be denied -- this is the actual regression
    # proof for "no override changes nothing".
    resp = client.post(
        f"/api/v1/projects/{project['id']}/requirements",
        json={"title": "Req without override", "priority": "High"},
    )
    assert resp.status_code == 403, resp.text

    _login_and_verify(
        client, tenant_id, admin_email, "AdminPassw0rd!"
    )  # restore admin session for teardown cleanliness


def test_project_override_grants_permission_only_within_that_project(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, tester_id = _setup_tenant_with_tester(
        client, platform_admin, "Coastal Trust"
    )
    manager_role_id = _role_id_by_code(client, "manager")

    set_resp = client.patch(
        f"/api/v1/projects/{project['id']}/members/{tester_id}/role",
        json={"role_id": manager_role_id},
    )
    assert set_resp.status_code == 200, set_resp.text

    _login_and_verify(client, tenant_id, "tester@coastaltrust.example.com", "TesterPassw0rd!")

    # requirement.manage is a manager-tier permission the tester lacked
    # tenant-wide -- the project override should now grant it, scoped to
    # this project's own creation endpoint.
    resp = client.post(
        f"/api/v1/projects/{project['id']}/requirements",
        json={"title": "Req via override", "priority": "High"},
    )
    assert resp.status_code == 200, resp.text


def test_override_does_not_leak_to_a_second_project(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a, tester_id = _setup_tenant_with_tester(
        client, platform_admin, "Harbor Mutual"
    )
    admin_email = "admin@harbormutual.example.com"
    manager_role_id = _role_id_by_code(client, "manager")

    client.patch(
        f"/api/v1/projects/{project_a['id']}/members/{tester_id}/role",
        json={"role_id": manager_role_id},
    )

    project_b = _create_project(client, "Harbor Mutual Property", domain="Property")
    client.post(f"/api/v1/projects/{project_b['id']}/members", json={"user_id": tester_id})

    _login_and_verify(client, tenant_id, "tester@harbormutual.example.com", "TesterPassw0rd!")

    # Project A: overridden to manager -> requirement.manage granted.
    resp_a = client.post(
        f"/api/v1/projects/{project_a['id']}/requirements",
        json={"title": "Req in overridden project", "priority": "High"},
    )
    assert resp_a.status_code == 200, resp_a.text

    # Project B: no override on this project -> still plain tester, denied.
    resp_b = client.post(
        f"/api/v1/projects/{project_b['id']}/requirements",
        json={"title": "Req in plain project", "priority": "High"},
    )
    assert resp_b.status_code == 403, resp_b.text

    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")


def test_clearing_override_reverts_to_tenant_role_immediately(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, tester_id = _setup_tenant_with_tester(
        client, platform_admin, "Summit Assurance"
    )
    admin_email = "admin@summitassurance.example.com"
    manager_role_id = _role_id_by_code(client, "manager")

    client.patch(
        f"/api/v1/projects/{project['id']}/members/{tester_id}/role",
        json={"role_id": manager_role_id},
    )

    # Clear the override before the tester ever logs in.
    clear_resp = client.patch(
        f"/api/v1/projects/{project['id']}/members/{tester_id}/role",
        json={"role_id": None},
    )
    assert clear_resp.status_code == 200, clear_resp.text

    _login_and_verify(client, tenant_id, "tester@summitassurance.example.com", "TesterPassw0rd!")
    resp = client.post(
        f"/api/v1/projects/{project['id']}/requirements",
        json={"title": "Req after clearing override", "priority": "High"},
    )
    assert resp.status_code == 403, resp.text

    _login_and_verify(client, tenant_id, admin_email, "AdminPassw0rd!")


def test_list_members_shows_tenant_and_project_role_names(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, tester_id = _setup_tenant_with_tester(
        client, platform_admin, "Lighthouse Indemnity"
    )
    manager_role_id = _role_id_by_code(client, "manager")

    members = client.get(f"/api/v1/projects/{project['id']}/members").json()["data"]
    tester_row = next(m for m in members if m["user_id"] == tester_id)
    assert tester_row["tenant_role_name"] == "Tester"
    assert tester_row["project_role_id"] is None
    assert tester_row["project_role_name"] is None

    client.patch(
        f"/api/v1/projects/{project['id']}/members/{tester_id}/role",
        json={"role_id": manager_role_id},
    )
    members = client.get(f"/api/v1/projects/{project['id']}/members").json()["data"]
    tester_row = next(m for m in members if m["user_id"] == tester_id)
    assert tester_row["project_role_id"] == manager_role_id
    assert tester_row["project_role_name"] == "Manager"


def test_manager_can_assign_project_role_without_user_manage_permission(
    client: TestClient, platform_admin: dict
) -> None:
    """A Manager legitimately manages project membership (project.members.
    manage) but lacks tenant-wide user.manage -- confirms the lighter
    /roles/assignable gate (and the member-role endpoints, gated on
    project.members.manage) work for a Manager, not just an Admin."""
    bootstrap = _bootstrap_tenant(client, platform_admin, "Pinnacle Re")
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@pinnaclere.example.com", "AdminPassw0rd!")
    project = _create_project(client, "Pinnacle Re Claims")
    manager_id = _create_user(
        client, "manager@pinnaclere.example.com", "Mo Manager", "manager", "ManagerPassw0rd!"
    )
    tester_id = _create_user(
        client, "tester@pinnaclere.example.com", "Tess Tester", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": manager_id})
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    _login_and_verify(client, tenant_id, "manager@pinnaclere.example.com", "ManagerPassw0rd!")

    assignable = client.get("/api/v1/roles/assignable")
    assert assignable.status_code == 200, assignable.text
    tester_role_id = next(r["id"] for r in assignable.json()["data"] if r["code"] == "tester")

    set_resp = client.patch(
        f"/api/v1/projects/{project['id']}/members/{tester_id}/role",
        json={"role_id": tester_role_id},
    )
    assert set_resp.status_code == 200, set_resp.text
