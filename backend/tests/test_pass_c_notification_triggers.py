"""Pass C (deferred item #4, bug #19): three new bounded notification
trigger types extending Phase 9's pattern -- run-case assignment, test-run
completion, and defect SLA breach (via the worker's periodic sweep, since
a breach happens purely by time passing, not by any mutation).

A real bug was found writing these tests' live-verification counterpart:
`NotificationOut`'s Pydantic Literal types were never updated alongside
the DB CHECK constraint, so every notification of these new types 500'd
on serialization. These tests exist specifically so that regression can't
recur silently."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient

from app.services import defect_service
from tests.test_notifications import (
    _create_test_case,
    _create_user,
    _login_and_verify,
    _setup_admin_and_project,
)


def test_run_case_assignment_notifies_the_assignee(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    case = _create_test_case(client, project_id, "Verify Settlement")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")

    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Regression Pack", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]

    client.patch(f"/api/v1/test-run-cases/{run_case_id}/assign", json={"assigned_to": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    notifications = tester_client.get("/api/v1/notifications").json()["data"]
    assert len(notifications) == 1
    assert notifications[0]["type"] == "run_case_assigned"
    assert notifications[0]["entity_type"] == "test_run"
    assert notifications[0]["entity_id"] == run["id"]


def test_unassigning_a_run_case_does_not_notify(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify Settlement")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")
    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Regression Pack", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]

    response = client.patch(
        f"/api/v1/test-run-cases/{run_case_id}/assign", json={"assigned_to": None}
    )
    assert response.status_code == 200, response.text

    assert client.get("/api/v1/notifications").json()["data"] == []


def test_assigning_a_run_case_to_yourself_does_not_self_notify(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    admin_id = client.get("/api/v1/auth/me").json()["data"]["user_id"]
    case = _create_test_case(client, project_id, "Verify Settlement")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")
    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Regression Pack", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]

    client.patch(f"/api/v1/test-run-cases/{run_case_id}/assign", json={"assigned_to": admin_id})

    assert client.get("/api/v1/notifications").json()["data"] == []


def test_finishing_a_test_run_notifies_its_creator(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    manager_id = _create_user(
        client, "manager@horizon.com", "Manager One", "manager", "ManagerPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": manager_id})
    case = _create_test_case(client, project_id, "Verify Settlement")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")

    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Regression Pack", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]

    manager_client = TestClient(client.app)
    _login_and_verify(manager_client, tenant_id, "manager@horizon.com", "ManagerPassw0rd!")
    response = manager_client.post(f"/api/v1/test-runs/{run['id']}/finish")
    assert response.status_code == 200, response.text

    # The run's own creator (the admin who built it, not the manager who
    # finished it) should be notified -- a genuinely different recipient.
    notifications = client.get("/api/v1/notifications").json()["data"]
    assert len(notifications) == 1
    assert notifications[0]["type"] == "test_run_completed"
    assert notifications[0]["entity_type"] == "test_run"
    assert notifications[0]["entity_id"] == run["id"]


def test_finishing_your_own_test_run_does_not_self_notify(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    case = _create_test_case(client, project_id, "Verify Settlement")
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    client.post(f"/api/v1/test-cases/{case['id']}/approve")
    run = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": "Regression Pack", "run_type": "Regression", "test_case_ids": [case["id"]]},
    ).json()["data"]

    client.post(f"/api/v1/test-runs/{run['id']}/finish")

    assert client.get("/api/v1/notifications").json()["data"] == []


def test_sla_breach_sweep_notifies_reporter_and_assignee_once(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_id}/members", json={"user_id": tester_id})

    defect = client.post(
        "/api/v1/defects",
        json={
            "project_id": project_id,
            "title": "Critical bug needs SLA tracking",
            "description": "desc",
            "severity": "Critical",
            "priority": "High",
            "assigned_to": tester_id,
        },
    ).json()["data"]

    # Critical severity's SLA budget is 2 days (see
    # defect_service.SLA_DAYS_BY_SEVERITY) -- back-date past it directly,
    # the same way the real worker would eventually observe a genuine
    # breach purely from time passing.
    from app.core.db import set_tenant_context
    from app.models.defect import Defect

    set_tenant_context(db_session, str(tenant_id))
    row = db_session.get(Defect, UUID(defect["id"]))
    row.created_at = datetime.now(UTC) - timedelta(days=5)
    db_session.commit()

    sent = defect_service.sweep_sla_breaches(db_session)
    assert sent == 2  # reporter (admin) + assignee (tester)

    admin_notifications = client.get("/api/v1/notifications").json()["data"]
    assert len(admin_notifications) == 1
    assert admin_notifications[0]["type"] == "defect_sla_breach"
    assert admin_notifications[0]["entity_type"] == "defect"
    assert admin_notifications[0]["entity_id"] == defect["id"]

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    tester_notifications = tester_client.get("/api/v1/notifications").json()["data"]
    assert len(tester_notifications) == 1
    assert tester_notifications[0]["type"] == "defect_sla_breach"

    # Re-sweeping must not re-notify -- `sla_breach_notified_at` guards it.
    assert defect_service.sweep_sla_breaches(db_session) == 0


def test_sla_breach_sweep_is_isolated_per_tenant(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    defect = client.post(
        "/api/v1/defects",
        json={
            "project_id": project_id,
            "title": "Critical bug needs SLA tracking",
            "description": "desc",
            "severity": "Critical",
            "priority": "High",
        },
    ).json()["data"]

    from app.core.db import set_tenant_context
    from app.models.defect import Defect

    set_tenant_context(db_session, str(tenant_id))
    row = db_session.get(Defect, UUID(defect["id"]))
    row.created_at = datetime.now(UTC) - timedelta(days=5)
    db_session.commit()

    # A second, unrelated tenant exists too (the platform admin fixture's
    # bootstrap tenant) -- the sweep iterates every approved tenant, and
    # must never leak this tenant's breach notification into another's.
    other_bootstrap = client.post(
        "/api/v1/platform/tenants",
        auth=(platform_admin["email"], platform_admin["password"]),
        json={
            "tenant_name": "Other Carrier",
            "admin_name": "Other Admin",
            "admin_email": "admin@othercarrier.com",
            "admin_password": "AdminPassw0rd!",
        },
    ).json()["data"]
    other_client = TestClient(client.app)
    _login_and_verify(
        other_client, other_bootstrap["tenant"]["id"], "admin@othercarrier.com", "AdminPassw0rd!"
    )

    defect_service.sweep_sla_breaches(db_session)

    assert other_client.get("/api/v1/notifications").json()["data"] == []
    assert len(client.get("/api/v1/notifications").json()["data"]) == 1
