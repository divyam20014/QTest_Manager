"""GAP-15: test case attachments (ADR-012 -- bytes on disk, metadata in
PostgreSQL)."""

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


def _setup_case(client: TestClient, platform_admin: dict) -> tuple[str, str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

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
            "steps": [{"action": "A", "expected": "B"}],
        },
    ).json()["data"]
    return tenant_id, project["id"], case["id"]


def test_upload_list_download_attachment(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)

    upload = client.post(
        f"/api/v1/test-cases/{case_id}/attachments",
        files={"file": ("evidence.txt", b"screenshot evidence bytes", "text/plain")},
    )
    assert upload.status_code == 200, upload.text
    attachment = upload.json()["data"]
    assert attachment["file_name"] == "evidence.txt"
    assert attachment["size_bytes"] == len(b"screenshot evidence bytes")
    assert attachment["uploaded_by_name"] == "Admin A"

    listing = client.get(f"/api/v1/test-cases/{case_id}/attachments").json()["data"]
    assert len(listing) == 1
    assert listing[0]["id"] == attachment["id"]

    download = client.get(f"/api/v1/attachments/{attachment['id']}/download")
    assert download.status_code == 200
    assert download.content == b"screenshot evidence bytes"


def test_attachment_exceeding_size_limit_rejected(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)

    oversized = b"x" * (10 * 1024 * 1024 + 1)
    response = client.post(
        f"/api/v1/test-cases/{case_id}/attachments",
        files={"file": ("big.bin", oversized, "application/octet-stream")},
    )
    assert response.status_code == 422
    assert "exceeds" in response.json()["error"]["message"]


def test_empty_attachment_rejected(client: TestClient, platform_admin: dict) -> None:
    _, _, case_id = _setup_case(client, platform_admin)

    response = client.post(
        f"/api/v1/test-cases/{case_id}/attachments",
        files={"file": ("empty.txt", b"", "text/plain")},
    )
    assert response.status_code == 422


def test_delete_attachment_removes_it_from_listing(
    client: TestClient, platform_admin: dict
) -> None:
    _, _, case_id = _setup_case(client, platform_admin)
    attachment = client.post(
        f"/api/v1/test-cases/{case_id}/attachments",
        files={"file": ("evidence.txt", b"bytes", "text/plain")},
    ).json()["data"]

    delete_response = client.delete(f"/api/v1/attachments/{attachment['id']}")
    assert delete_response.status_code == 200

    listing = client.get(f"/api/v1/test-cases/{case_id}/attachments").json()["data"]
    assert listing == []

    not_found = client.get(f"/api/v1/attachments/{attachment['id']}/download")
    assert not_found.status_code == 404


def test_tester_not_assigned_to_project_cannot_access_attachments(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id, case_id = _setup_case(client, platform_admin)
    client.post(
        f"/api/v1/test-cases/{case_id}/attachments",
        files={"file": ("evidence.txt", b"bytes", "text/plain")},
    )

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    forbidden = tester_client.get(f"/api/v1/test-cases/{case_id}/attachments")
    assert forbidden.status_code == 403

    # Once assigned, the unassigned-tester restriction lifts.
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    allowed = tester_client.get(f"/api/v1/test-cases/{case_id}/attachments")
    assert allowed.status_code == 200
