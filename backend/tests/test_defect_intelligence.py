"""Phase 6 (AI/SaaS vision roadmap): Defect Intelligence additive analytics
(GAP-77, PV-6.2/6.4/6.5) -- root cause categorization, aging/SLA-breach
tracking, and defect trend analytics. All additive: no existing defect
behavior changes, nothing here is required at creation time."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import set_tenant_context
from app.models.defect import Defect


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


def _setup_admin_and_project(client: TestClient, platform_admin: dict) -> tuple[str, str]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client)
    return tenant_id, project["id"]


def _create_defect(
    client: TestClient, project_id: str, title: str = "Standalone bug", severity: str = "Medium"
) -> dict:
    response = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": title, "severity": severity},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _backdate_defect(db_session, tenant_id: str, defect_id: str, days_ago: int) -> None:
    set_tenant_context(db_session, tenant_id)
    row = db_session.execute(select(Defect).where(Defect.id == UUID(defect_id))).scalar_one()
    row.created_at = datetime.now(UTC) - timedelta(days=days_ago)
    db_session.commit()


def test_setting_and_clearing_root_cause(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    defect = _create_defect(client, project_id)
    assert defect["root_cause"] is None

    set_response = client.patch(
        f"/api/v1/defects/{defect['id']}/root-cause", json={"root_cause": "code_defect"}
    )
    assert set_response.status_code == 200, set_response.text
    assert set_response.json()["data"]["root_cause"] == "code_defect"

    cleared = client.patch(f"/api/v1/defects/{defect['id']}/root-cause", json={"root_cause": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["data"]["root_cause"] is None


def test_invalid_root_cause_is_rejected(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    defect = _create_defect(client, project_id)

    response = client.patch(
        f"/api/v1/defects/{defect['id']}/root-cause", json={"root_cause": "not_a_real_category"}
    )
    assert response.status_code == 422


def test_root_cause_change_is_audit_logged(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    defect = _create_defect(client, project_id)
    client.patch(f"/api/v1/defects/{defect['id']}/root-cause", json={"root_cause": "design_flaw"})

    logs = client.get(
        "/api/v1/audit-logs", params={"action": "defect.root_cause_set"}
    ).json()["data"]
    assert len(logs) == 1
    assert logs[0]["metadata"] == {"from": None, "to": "design_flaw"}


def test_new_defect_has_zero_age_and_no_breach(client: TestClient, platform_admin: dict) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    defect = _create_defect(client, project_id, severity="Low")
    assert defect["age_days"] == 0
    assert defect["sla_breached"] is False


def test_sla_breach_is_computed_from_severity_threshold(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    # Critical SLA budget is 2 days (defect_service.SLA_DAYS_BY_SEVERITY).
    defect = _create_defect(client, project_id, severity="Critical")
    _backdate_defect(db_session, tenant_id, defect["id"], days_ago=5)

    refetched = client.get(f"/api/v1/defects/{defect['id']}").json()["data"]
    assert refetched["age_days"] >= 5
    assert refetched["sla_breached"] is True


def test_defect_aging_summary_buckets_open_defects_by_severity(
    client: TestClient, platform_admin: dict, db_session
) -> None:
    tenant_id, project_id = _setup_admin_and_project(client, platform_admin)
    breached = _create_defect(client, project_id, title="Old critical bug", severity="Critical")
    _backdate_defect(db_session, tenant_id, breached["id"], days_ago=5)
    _create_defect(client, project_id, title="Fresh low bug", severity="Low")

    summary = client.get("/api/v1/reports/defect-aging").json()["data"]
    assert summary["total_open"] == 2
    assert summary["total_breached"] == 1
    critical_bucket = next(b for b in summary["buckets"] if b["severity"] == "Critical")
    assert critical_bucket["open_count"] == 1
    assert critical_bucket["breached_count"] == 1
    low_bucket = next(b for b in summary["buckets"] if b["severity"] == "Low")
    assert low_bucket["open_count"] == 1
    assert low_bucket["breached_count"] == 0


def test_defect_aging_summary_excludes_closed_defects(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    defect = _create_defect(client, project_id, severity="Critical")
    for status in ["Open", "Fixed", "Verified"]:
        client.patch(f"/api/v1/defects/{defect['id']}/status", json={"status": status})
    client.patch(
        f"/api/v1/defects/{defect['id']}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )

    summary = client.get("/api/v1/reports/defect-aging").json()["data"]
    assert summary["total_open"] == 0


def test_defect_trend_counts_opened_and_closed_today(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    opened_only = _create_defect(client, project_id, title="Still open")
    to_close = _create_defect(client, project_id, title="Will be closed")
    for status in ["Open", "Fixed", "Verified"]:
        client.patch(f"/api/v1/defects/{to_close['id']}/status", json={"status": status})
    client.patch(
        f"/api/v1/defects/{to_close['id']}/status",
        json={"status": "Closed", "verification_confirmed": True},
    )

    trend = client.get("/api/v1/reports/defect-trend", params={"days": 7}).json()["data"]
    today = datetime.now(UTC).date().isoformat()
    today_point = next(p for p in trend["points"] if p["date"] == today)
    assert today_point["opened_count"] == 2
    assert today_point["closed_count"] == 1
    assert opened_only["status"] == "New"


def test_aggregate_report_groups_by_root_cause_including_uncategorized(
    client: TestClient, platform_admin: dict
) -> None:
    _, project_id = _setup_admin_and_project(client, platform_admin)
    categorized = _create_defect(client, project_id, title="Categorized bug")
    _create_defect(client, project_id, title="Uncategorized bug")
    client.patch(
        f"/api/v1/defects/{categorized['id']}/root-cause", json={"root_cause": "code_defect"}
    )

    report = client.get(
        "/api/v1/reports/aggregate", params={"metric": "defect_root_cause", "group_by": "project"}
    ).json()["data"]
    values = {row["value"]: row["count"] for row in report["rows"]}
    assert values.get("code_defect") == 1
    assert values.get("uncategorized") == 1
