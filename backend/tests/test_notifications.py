"""Phase 9 (AI/SaaS vision roadmap): real notifications (GAP-74, PV-9.2),
replacing the NotificationBell.tsx placeholder. Three bounded trigger
events -- comment mention, test case assignment, defect closure -- each
in-app always, and emailed too in "real" SMTP delivery mode (ADR-051,
mirroring MFA's ADR-032 simulated/real pattern)."""

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


def _create_test_case(client: TestClient, project_id: str, title: str, **extra) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": title,
            "priority": "High",
            "steps": [{"action": "A", "expected": "B"}],
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _setup_admin_and_project(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def test_mention_notifies_the_mentioned_user(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify Settlement")

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "Can you look at this?", "mentioned_user_ids": [tester_id]},
    )

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    notifications = tester_client.get("/api/v1/notifications").json()["data"]
    assert len(notifications) == 1
    assert notifications[0]["type"] == "mention"
    assert notifications[0]["entity_type"] == "test_case"
    assert notifications[0]["entity_id"] == case["id"]
    assert notifications[0]["read_at"] is None


def test_mentioning_yourself_does_not_self_notify(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify Settlement")
    admin_id = client.get("/api/v1/auth/me").json()["data"]["user_id"]

    client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "note to self", "mentioned_user_ids": [admin_id]},
    )

    notifications = client.get("/api/v1/notifications").json()["data"]
    assert notifications == []


def test_assigning_a_test_case_notifies_the_assignee(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    case = _create_test_case(client, project_id, "Verify Settlement", assignee_id=tester_id)

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    notifications = tester_client.get("/api/v1/notifications").json()["data"]
    assert len(notifications) == 1
    assert notifications[0]["type"] == "test_case_assigned"
    assert notifications[0]["entity_id"] == case["id"]


def test_reassigning_a_test_case_on_update_notifies_new_assignee(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    case = _create_test_case(client, project_id, "Verify Settlement")

    client.patch(f"/api/v1/test-cases/{case['id']}", json={"assignee_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    notifications = tester_client.get("/api/v1/notifications").json()["data"]
    assert len(notifications) == 1
    assert notifications[0]["type"] == "test_case_assigned"


def test_assigning_a_test_case_to_yourself_does_not_self_notify(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    admin_id = client.get("/api/v1/auth/me").json()["data"]["user_id"]

    client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={
            "title": "Verify Settlement",
            "priority": "High",
            "assignee_id": admin_id,
            "steps": [{"action": "A", "expected": "B"}],
        },
    )

    assert client.get("/api/v1/notifications").json()["data"] == []


def test_closing_a_defect_notifies_the_reporter(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    defect = tester_client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": "Payout bug", "severity": "High"},
    ).json()["data"]

    for status in ["Open", "Fixed", "Verified"]:
        client.patch(f"/api/v1/defects/{defect['id']}/status", json={"status": status})
    client.patch(
        f"/api/v1/defects/{defect['id']}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )

    notifications = tester_client.get("/api/v1/notifications").json()["data"]
    assert len(notifications) == 1
    assert notifications[0]["type"] == "defect_closed"
    assert notifications[0]["entity_id"] == defect["id"]


def test_closing_your_own_reported_defect_does_not_self_notify(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    defect = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": "Payout bug", "severity": "High"},
    ).json()["data"]

    for status in ["Open", "Fixed", "Verified"]:
        client.patch(f"/api/v1/defects/{defect['id']}/status", json={"status": status})
    client.patch(
        f"/api/v1/defects/{defect['id']}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )

    assert client.get("/api/v1/notifications").json()["data"] == []


def test_unread_count_and_mark_read(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    case = _create_test_case(client, project_id, "Verify Settlement")
    client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "hi", "mentioned_user_ids": [tester_id]},
    )

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    assert tester_client.get("/api/v1/notifications/unread-count").json()["data"]["count"] == 1

    notification_id = tester_client.get("/api/v1/notifications").json()["data"][0]["id"]
    marked = tester_client.patch(f"/api/v1/notifications/{notification_id}/read")
    assert marked.status_code == 200, marked.text
    assert marked.json()["data"]["read_at"] is not None

    assert tester_client.get("/api/v1/notifications/unread-count").json()["data"]["count"] == 0


def test_mark_all_read(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    for i in range(3):
        case = _create_test_case(client, project_id, f"Verify Settlement {i}")
        client.post(
            f"/api/v1/test-cases/{case['id']}/comments",
            json={"body": "hi", "mentioned_user_ids": [tester_id]},
        )

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert tester_client.get("/api/v1/notifications/unread-count").json()["data"]["count"] == 3

    marked = tester_client.post("/api/v1/notifications/mark-all-read")
    assert marked.status_code == 200, marked.text
    assert marked.json()["data"]["marked_count"] == 3
    assert tester_client.get("/api/v1/notifications/unread-count").json()["data"]["count"] == 0


def test_a_user_cannot_see_another_users_notifications(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    _create_user(client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!")
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    case = _create_test_case(client, project_id, "Verify Settlement")
    client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "hi", "mentioned_user_ids": [tester_id]},
    )

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")
    assert manager_client.get("/api/v1/notifications").json()["data"] == []

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    notification_id = tester_client.get("/api/v1/notifications").json()["data"][0]["id"]

    # A notification is scoped to its recipient -- another user (even the
    # original author) can't mark someone else's notification read.
    forbidden = manager_client.patch(f"/api/v1/notifications/{notification_id}/read")
    assert forbidden.status_code == 404


def test_real_delivery_mode_without_smtp_fails_loudly(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    """ADR-051 (mirroring ADR-032): 'real' mode must not silently swallow
    a missing SMTP configuration."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "notification_email_delivery_mode", "real")

    _, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    case = _create_test_case(client, project_id, "Verify Settlement")

    response = client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "hi", "mentioned_user_ids": [tester_id]},
    )
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "configuration_error"


def test_real_delivery_mode_sends_email_via_smtp(
    client: TestClient, platform_admin: dict, monkeypatch
) -> None:
    from app.core.config import get_settings
    from app.services import notification_service

    settings = get_settings()
    monkeypatch.setattr(settings, "notification_email_delivery_mode", "real")
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_username", "")

    sent_messages: list[dict] = []

    class _FakeSMTP:
        def __init__(self, host, port, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def starttls(self):
            pass

        def login(self, username, password):
            pass

        def send_message(self, message):
            sent_messages.append({"to": message["To"], "subject": message["Subject"]})

    monkeypatch.setattr(notification_service.smtplib, "SMTP", _FakeSMTP)

    _, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})
    case = _create_test_case(client, project_id, "Verify Settlement")

    response = client.post(
        f"/api/v1/test-cases/{case['id']}/comments",
        json={"body": "hi", "mentioned_user_ids": [tester_id]},
    )
    assert response.status_code == 200, response.text
    assert len(sent_messages) == 1
    assert sent_messages[0]["to"] == "tester@horizon.com"
