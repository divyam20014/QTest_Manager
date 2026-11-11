"""ADR-059: tenant-definable custom roles, superseding ADR-014/GAP-05."""

from fastapi.testclient import TestClient


def _bootstrap_tenant(client: TestClient, platform_admin: dict) -> dict:
    response = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Granite Insurance",
            "admin_name": "Admin A",
            "admin_email": "admin@granite.com",
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


def _bootstrap_and_login(client: TestClient, platform_admin: dict) -> str:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@granite.com", "AdminPassw0rd!")
    return tenant_id


def test_create_role_tenant_isolation(client: TestClient, platform_admin: dict) -> None:
    _bootstrap_and_login(client, platform_admin)
    other_client = TestClient(client.app)
    other_bootstrap = _bootstrap_tenant(other_client, platform_admin)
    _login_and_verify(
        other_client, other_bootstrap["tenant"]["id"], "admin@granite.com", "AdminPassw0rd!"
    )

    create_response = client.post(
        "/api/v1/roles", json={"name": "QA Lead", "permission_codes": ["testcase.create"]}
    )
    assert create_response.status_code == 200, create_response.text

    # Other tenant must never see this tenant's custom role.
    other_roles = other_client.get("/api/v1/roles").json()["data"]
    assert all(r["name"] != "QA Lead" for r in other_roles)

    # Both tenants see the 3 system roles.
    own_roles = client.get("/api/v1/roles").json()["data"]
    system_names = {r["name"] for r in own_roles if r["is_system"]}
    assert {"Admin", "Manager", "Tester"} <= system_names


def test_list_permissions_returns_only_real_enforced_codes(
    client: TestClient, platform_admin: dict
) -> None:
    _bootstrap_and_login(client, platform_admin)
    perms = client.get("/api/v1/roles/permissions").json()["data"]
    codes = {p["code"] for p in perms}
    assert "testcase.create" in codes
    assert "project.view.all" in codes
    assert "user.manage" in codes


def test_custom_role_permission_boundary_enforced_end_to_end(
    client: TestClient, platform_admin: dict
) -> None:
    """A role granted only testcase.create (not testcase.edit) can create a
    test case but not edit someone else's, and not approve it either."""
    tenant_id = _bootstrap_and_login(client, platform_admin)

    role = client.post(
        "/api/v1/roles",
        json={"name": "Case Author", "permission_codes": ["testcase.create", "testrun.create"]},
    ).json()["data"]

    user_response = client.post(
        "/api/v1/users",
        json={
            "email": "author@granite.com",
            "name": "Case Author",
            "role_id": role["id"],
            "password": "AuthorPassw0rd!",
        },
    )
    assert user_response.status_code == 200, user_response.text
    author_id = user_response.json()["data"]["id"]

    project = client.post(
        "/api/v1/projects",
        json={
            "name": "Granite Claims",
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "450000.00",
            "region": "North America",
        },
    ).json()["data"]
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": author_id})

    author_client = TestClient(client.app)
    _login_and_verify(author_client, tenant_id, "author@granite.com", "AuthorPassw0rd!")

    create_response = author_client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "Verify FNOL submission",
            "priority": "High",
            "steps": [{"action": "Submit FNOL", "expected": "Claim created"}],
        },
    )
    assert create_response.status_code == 200, create_response.text
    case_id = create_response.json()["data"]["id"]

    # Lacks testcase.edit -- cannot edit.
    edit_response = author_client.patch(
        f"/api/v1/test-cases/{case_id}",
        json={"title": "Changed title", "priority": "High", "steps": []},
    )
    assert edit_response.status_code == 403, edit_response.text

    # Lacks testcase.edit -- cannot submit for review either.
    submit_response = author_client.post(f"/api/v1/test-cases/{case_id}/submit-review")
    assert submit_response.status_code == 403, submit_response.text


def test_system_role_cannot_be_edited_or_deactivated(
    client: TestClient, platform_admin: dict
) -> None:
    _bootstrap_and_login(client, platform_admin)
    roles = client.get("/api/v1/roles").json()["data"]
    tester_role = next(r for r in roles if r["name"] == "Tester")

    edit_response = client.patch(f"/api/v1/roles/{tester_role['id']}", json={"name": "Renamed"})
    assert edit_response.status_code == 403, edit_response.text

    deactivate_response = client.delete(f"/api/v1/roles/{tester_role['id']}")
    assert deactivate_response.status_code == 403, deactivate_response.text


def test_deactivating_role_in_use_is_blocked(client: TestClient, platform_admin: dict) -> None:
    _bootstrap_and_login(client, platform_admin)
    role = client.post(
        "/api/v1/roles", json={"name": "Observer", "permission_codes": ["report.view"]}
    ).json()["data"]
    client.post(
        "/api/v1/users",
        json={
            "email": "observer@granite.com",
            "name": "Observer One",
            "role_id": role["id"],
            "password": "ObserverPassw0rd!",
        },
    )

    deactivate_response = client.delete(f"/api/v1/roles/{role['id']}")
    assert deactivate_response.status_code == 409, deactivate_response.text
    assert "1 active user" in deactivate_response.json()["error"]["message"]


def test_custom_role_with_project_view_all_gets_tenant_wide_access(
    client: TestClient, platform_admin: dict
) -> None:
    """A custom role holding project.view.all behaves like today's
    Manager for every pre-existing project-visibility check, without being
    assigned to the project."""
    tenant_id = _bootstrap_and_login(client, platform_admin)

    role = client.post(
        "/api/v1/roles",
        json={
            "name": "Global Viewer",
            "permission_codes": ["project.view.all", "report.view"],
        },
    ).json()["data"]
    user_response = client.post(
        "/api/v1/users",
        json={
            "email": "viewer@granite.com",
            "name": "Global Viewer",
            "role_id": role["id"],
            "password": "ViewerPassw0rd!",
        },
    )
    assert user_response.status_code == 200, user_response.text

    project = client.post(
        "/api/v1/projects",
        json={
            "name": "Unassigned Project",
            "domain": "Health",
            "priority": "Medium",
            "manager_name": "Jane Manager",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "100000.00",
            "region": "EMEA",
        },
    ).json()["data"]
    # Deliberately not added as a project member.

    viewer_client = TestClient(client.app)
    _login_and_verify(viewer_client, tenant_id, "viewer@granite.com", "ViewerPassw0rd!")

    get_response = viewer_client.get(f"/api/v1/projects/{project['id']}")
    assert get_response.status_code == 200, get_response.text
