"""Phase 8 (AI/SaaS vision roadmap): Comments on entities (GAP-74, PV-9.1),
reusing the Attachment polymorphic owner_type pattern (ADR-049/ADR-050) --
same test_case/defect/execution_step owner types, same per-owner-type
access-check dispatch, no new permission."""

from fastapi.testclient import TestClient


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


def _create_user(client: TestClient, email: str, name: str, role: str, password: str) -> str:
    response = client.post(
        "/api/v1/users", json={"email": email, "name": name, "role": role, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _create_project(client: TestClient, name: str = "Apex Motor Claims") -> dict:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "domain": "Motor",
            "priority": "High",
            "manager_name": "Jane",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "budget": "1000",
            "region": "NA",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup_case(client: TestClient, platform_admin: dict) -> tuple[str, str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    case = client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "Verify Settlement",
            "priority": "High",
            "steps": [{"action": "A", "expected": "B"}],
        },
    ).json()["data"]
    return tenant_id, project["id"], case["id"]


def _create_defect(client: TestClient, project_id: str, title: str = "Standalone bug") -> dict:
    response = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": title, "severity": "Medium"},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup_execution_step(client: TestClient, platform_admin: dict) -> tuple[str, str, str]:
    tenant_id, project_id, case_id = _setup_case(client, platform_admin)
    client.post(f"/api/v1/test-cases/{case_id}/submit-review")
    client.post(f"/api/v1/test-cases/{case_id}/approve")

    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={
            "name": "Sprint 42 Motor Regression",
            "run_type": "Regression",
            "test_case_ids": [case_id],
        },
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    return tenant_id, project_id, steps[0]["id"]


def test_create_and_list_comment_on_test_case(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)

    create = client.post(
        f"/api/v1/test-cases/{case_id}/comments", json={"body": "Looks good to me."}
    )
    assert create.status_code == 200, create.text
    comment = create.json()["data"]
    assert comment["body"] == "Looks good to me."
    assert comment["author_name"] == "Admin A"
    assert comment["mentioned_users"] == []

    listing = client.get(f"/api/v1/test-cases/{case_id}/comments").json()["data"]
    assert len(listing) == 1
    assert listing[0]["id"] == comment["id"]


def test_comment_with_mentions_resolves_mentioned_users(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id, case_id = _setup_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    response = client.post(
        f"/api/v1/test-cases/{case_id}/comments",
        json={"body": "Can you take a look, @Tester One?", "mentioned_user_ids": [tester_id]},
    )
    assert response.status_code == 200, response.text
    mentioned = response.json()["data"]["mentioned_users"]
    assert len(mentioned) == 1
    assert mentioned[0]["id"] == tester_id
    assert mentioned[0]["name"] == "Tester One"


def test_mentioning_an_unknown_user_is_rejected(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)
    fake_id = "00000000-0000-0000-0000-000000000000"

    response = client.post(
        f"/api/v1/test-cases/{case_id}/comments",
        json={"body": "cc someone", "mentioned_user_ids": [fake_id]},
    )
    assert response.status_code == 422


def test_empty_comment_body_rejected(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)
    response = client.post(f"/api/v1/test-cases/{case_id}/comments", json={"body": ""})
    assert response.status_code == 422


def test_author_can_delete_own_comment(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)
    comment = client.post(
        f"/api/v1/test-cases/{case_id}/comments", json={"body": "to be deleted"}
    ).json()["data"]

    delete_response = client.delete(f"/api/v1/comments/{comment['id']}")
    assert delete_response.status_code == 200, delete_response.text

    listing = client.get(f"/api/v1/test-cases/{case_id}/comments").json()["data"]
    assert listing == []


def test_non_author_tester_cannot_delete_but_manager_can(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id, case_id = _setup_case(client, platform_admin)
    comment = client.post(
        f"/api/v1/test-cases/{case_id}/comments", json={"body": "admin's comment"}
    ).json()["data"]

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    forbidden = tester_client.delete(f"/api/v1/comments/{comment['id']}")
    assert forbidden.status_code == 403

    _create_user(client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!")
    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")

    # A Manager who did not author the comment may still delete it
    # (moderation), unlike the Tester above.
    allowed = manager_client.delete(f"/api/v1/comments/{comment['id']}")
    assert allowed.status_code == 200, allowed.text


def test_tester_not_assigned_to_project_cannot_access_comments(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id, case_id = _setup_case(client, platform_admin)
    client.post(f"/api/v1/test-cases/{case_id}/comments", json={"body": "hello"})

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    forbidden = tester_client.get(f"/api/v1/test-cases/{case_id}/comments")
    assert forbidden.status_code == 403

    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    allowed = tester_client.get(f"/api/v1/test-cases/{case_id}/comments")
    assert allowed.status_code == 200


def test_comment_on_defect(client: TestClient, platform_admin: dict) -> None:
    _, project_id, _ = _setup_case(client, platform_admin)
    defect = _create_defect(client, project_id)

    create = client.post(
        f"/api/v1/defects/{defect['id']}/comments", json={"body": "Repro steps attached."}
    )
    assert create.status_code == 200, create.text

    listing = client.get(f"/api/v1/defects/{defect['id']}/comments").json()["data"]
    assert len(listing) == 1


def test_comment_on_execution_step(client: TestClient, platform_admin: dict) -> None:
    _, _, step_id = _setup_execution_step(client, platform_admin)

    create = client.post(
        f"/api/v1/execution-steps/{step_id}/comments", json={"body": "Flaky on retry."}
    )
    assert create.status_code == 200, create.text

    listing = client.get(f"/api/v1/execution-steps/{step_id}/comments").json()["data"]
    assert len(listing) == 1


def test_comment_creation_is_audit_logged(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)
    client.post(f"/api/v1/test-cases/{case_id}/comments", json={"body": "audited comment"})

    logs = client.get("/api/v1/audit-logs", params={"action": "comment.created"}).json()["data"]
    assert len(logs) == 1
    assert logs[0]["entity_type"] == "test_case"
    assert logs[0]["entity_id"] == case_id


def test_comments_are_tenant_isolated(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)
    client.post(f"/api/v1/test-cases/{case_id}/comments", json={"body": "tenant A only"})

    other_client = TestClient(client.app)
    other_bootstrap = other_client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Summit Casualty",
            "admin_name": "Admin B",
            "admin_email": "admin@horizon.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    _login_and_verify(
        other_client, other_bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!"
    )

    cross_tenant_get = other_client.get(f"/api/v1/test-cases/{case_id}/comments")
    assert cross_tenant_get.status_code == 404
