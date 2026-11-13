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


def _sample_steps() -> list[dict]:
    return [
        {"action": "Input Policy Number", "expected": "ACV displayed"},
        {"action": "Apply $500 deductible", "expected": "Payout = ACV - 500"},
    ]


def _create_approved_case(client: TestClient, project_id: str, title: str) -> dict:
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    return client.post(f"/api/v1/test-cases/{case['id']}/approve").json()["data"]


def _full_scenario(client: TestClient, platform_admin: dict) -> tuple[str, dict]:
    """One passed step, one failed step (-> an open defect), active run."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client, "Apex Motor Claims", domain="Motor")
    case = _create_approved_case(client, project["id"], "Verify Total Loss Settlement")

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={
            "name": "Sprint 42 Motor Regression",
            "run_type": "Regression",
            "test_case_ids": [case["id"]],
        },
    ).json()["data"]
    run_case_id = run["cases"][0]["id"]
    steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"})
    client.post(f"/api/v1/execution-steps/{steps[1]['id']}/verdict", json={"verdict": "fail"})
    client.post(
        "/api/v1/defects", json={"execution_step_id": steps[1]["id"], "severity": "Critical"}
    )
    return tenant_id, project


def test_dashboard_summary_reflects_tenant_data(client: TestClient, platform_admin: dict) -> None:
    _full_scenario(client, platform_admin)

    summary = client.get("/api/v1/dashboard/summary").json()["data"]
    assert summary["projects"]["total"] == 1
    assert summary["test_cases"]["total"] == 1
    assert summary["test_cases"]["approved_ratio"] == 1.0
    assert summary["test_runs"]["active"] == 1
    assert summary["test_runs"]["step_pass_percentage"] == 0.5
    assert summary["defects"]["open_by_severity"]["Critical"] == 1


def test_domain_distribution_groups_by_domain(client: TestClient, platform_admin: dict) -> None:
    _full_scenario(client, platform_admin)
    _create_project(client, "Health Claims Floater", domain="Health")

    distribution = client.get("/api/v1/dashboard/domain-distribution").json()["data"]
    by_domain = {entry["domain"]: entry for entry in distribution}
    assert set(by_domain.keys()) == {"Motor", "Health", "Travel", "Life", "Property"}
    assert by_domain["Motor"]["project_count"] == 1
    assert by_domain["Motor"]["test_case_count"] == 1
    assert by_domain["Motor"]["approved_percentage"] == 100.0
    assert by_domain["Motor"]["open_defect_count"] == 1
    assert by_domain["Health"]["project_count"] == 1
    assert by_domain["Health"]["test_case_count"] == 0
    assert by_domain["Travel"]["project_count"] == 0


def test_activity_stream_returns_recent_audit_events(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)

    stream = client.get("/api/v1/dashboard/activity-stream").json()["data"]
    assert len(stream) <= 10
    assert len(stream) > 0
    assert stream[0]["created_at"] >= stream[-1]["created_at"]
    actions = {entry["action"] for entry in stream}
    assert "defect.created" in actions
    assert any(entry["user_name"] == "Admin A" for entry in stream)


def test_activity_stream_excludes_auth_events_for_every_role(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project = _full_scenario(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    # The login above itself generated auth.login_attempted/auth.mfa_verified
    # for the tester, and _full_scenario's login generated the same for the
    # admin -- both must be universally excluded, not just narrowed by role.

    admin_stream = client.get("/api/v1/dashboard/activity-stream").json()["data"]
    tester_stream = tester_client.get("/api/v1/dashboard/activity-stream").json()["data"]
    for stream in (admin_stream, tester_stream):
        actions = {entry["action"] for entry in stream}
        entity_types = {entry["entity_type"] for entry in stream}
        assert not any(a.startswith("auth.") for a in actions)
        assert "session" not in entity_types


def test_tester_activity_feed_restricted_to_own_and_accessible_projects(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a = _full_scenario(client, platform_admin)
    project_b = _create_project(client, "Unrelated Health Claims", domain="Health")
    case_b = _create_approved_case(client, project_b["id"], "Unrelated Case")

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_a['id']}/members", json={"user_id": tester_id})
    # Deliberately NOT added as a member of project_b.

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    # Tester acts in their own accessible project (project_a's case was
    # created by _full_scenario) -- generate a fresh, attributable action.
    case_a_id = client.get(f"/api/v1/projects/{project_a['id']}/test-cases").json()["data"][
        "items"
    ][0]["id"]
    comment_response = tester_client.post(
        f"/api/v1/test-cases/{case_a_id}/comments", json={"body": "Looks good to me"}
    )
    assert comment_response.status_code == 200, comment_response.text

    tester_stream = tester_client.get("/api/v1/dashboard/activity-stream").json()["data"]
    tester_entity_ids = {entry["entity_id"] for entry in tester_stream}
    assert case_a_id in tester_entity_ids
    # The admin's action on project_b's case must not leak into the
    # tester's feed -- they have no access to project_b at all.
    assert case_b["id"] not in tester_entity_ids

    # The admin (tenant-wide visibility) must still see both.
    admin_stream = client.get("/api/v1/dashboard/activity-stream").json()["data"]
    admin_entity_ids = {entry["entity_id"] for entry in admin_stream}
    assert case_a_id in admin_entity_ids
    assert case_b["id"] in admin_entity_ids


def test_tester_sees_own_past_action_after_losing_project_access(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project_a = _full_scenario(client, platform_admin)
    project_b = _create_project(client, "Temp Access Claims", domain="Health")
    case_b = _create_approved_case(client, project_b["id"], "Temp Access Case")

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project_b['id']}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    comment_response = tester_client.post(
        f"/api/v1/test-cases/{case_b['id']}/comments", json={"body": "Reviewed while I had access"}
    )
    assert comment_response.status_code == 200, comment_response.text

    # Now revoke the tester's membership on project_b entirely.
    remove_response = client.delete(f"/api/v1/projects/{project_b['id']}/members/{tester_id}")
    assert remove_response.status_code == 200, remove_response.text

    tester_stream = tester_client.get("/api/v1/dashboard/activity-stream").json()["data"]
    own_action = next(
        (e for e in tester_stream if e["entity_id"] == case_b["id"]), None
    )
    assert own_action is not None, "tester should still see their own past action"
    assert own_action["action"] == "comment.created"


def test_tester_cannot_see_tenant_wide_administrative_activity(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project = _full_scenario(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    # A tenant-wide administrative action with no project at all.
    definition_response = client.post(
        "/api/v1/custom-fields/definitions",
        json={
            "entity_type": "test_case",
            "field_key": "regulatory_flag",
            "label": "Regulatory Flag",
            "field_type": "boolean",
        },
    )
    assert definition_response.status_code == 200, definition_response.text

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    tester_stream = tester_client.get("/api/v1/dashboard/activity-stream").json()["data"]
    admin_stream = client.get("/api/v1/dashboard/activity-stream").json()["data"]

    assert not any(e["entity_type"] == "custom_field_definition" for e in tester_stream)
    assert any(e["entity_type"] == "custom_field_definition" for e in admin_stream)


def test_aggregate_report_by_project_and_domain(client: TestClient, platform_admin: dict) -> None:
    _full_scenario(client, platform_admin)

    by_project = client.get(
        "/api/v1/reports/aggregate", params={"metric": "run_status", "group_by": "project"}
    ).json()["data"]
    assert by_project["metric"] == "run_status"
    values = {row["value"]: row["count"] for row in by_project["rows"]}
    assert values.get("failed", 0) == 1  # one step failed -> whole case is failed (ADR-024)

    by_domain = client.get(
        "/api/v1/reports/aggregate", params={"metric": "defect_severity", "group_by": "domain"}
    ).json()["data"]
    motor_rows = [r for r in by_domain["rows"] if r["group_label"] == "Motor"]
    assert any(r["value"] == "Critical" and r["count"] == 1 for r in motor_rows)


def test_aggregate_report_by_assignee_unassigned_fallback(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)

    by_assignee = client.get(
        "/api/v1/reports/aggregate", params={"metric": "priority", "group_by": "assignee"}
    ).json()["data"]
    assert any(row["group_label"] == "Unassigned" for row in by_assignee["rows"])


def test_tester_scoped_to_assigned_projects_for_dashboard_and_reports(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, visible_project = _full_scenario(client, platform_admin)
    _create_project(client, "Hidden Project", domain="Life")

    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{visible_project['id']}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    summary = tester_client.get("/api/v1/dashboard/summary").json()["data"]
    assert summary["projects"]["total"] == 1

    distribution = tester_client.get("/api/v1/dashboard/domain-distribution").json()["data"]
    by_domain = {e["domain"]: e for e in distribution}
    assert by_domain["Life"]["project_count"] == 0  # hidden project not visible to tester


def test_tester_cannot_export_compliance_report(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project = _full_scenario(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})

    tester_client = TestClient(client.app)
    _login_and_verify(tester_client, tenant_id, "tester@horizon.com", "TesterPassw0rd!")

    response = tester_client.get("/api/v1/reports/compliance-export")
    assert response.status_code == 403


def test_compliance_export_csv_has_header_and_project_rows(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)

    response = client.get("/api/v1/reports/compliance-export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    text = response.text
    assert "QTestHub Compliance Summary" in text
    assert "Horizon Mutual" in text
    assert "Admin A" in text
    assert "Apex Motor Claims" in text


def test_dashboard_summary_includes_active_approved_and_critical_counts(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)
    # A second, Completed project should not count toward "active".
    completed = _create_project(client, "Finished Project", domain="Health")
    client.patch(f"/api/v1/projects/{completed['id']}", json={"status": "Completed"})

    summary = client.get("/api/v1/dashboard/summary").json()["data"]
    assert summary["projects"]["total"] == 2
    assert summary["projects"]["active"] == 1
    assert summary["test_cases"]["approved_count"] == 1
    assert summary["defects"]["critical_count"] == 1


def test_domain_distribution_includes_pass_percentage(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)

    distribution = client.get("/api/v1/dashboard/domain-distribution").json()["data"]
    by_domain = {entry["domain"]: entry for entry in distribution}
    # One pass + one fail step seeded by _full_scenario -> 50%.
    assert by_domain["Motor"]["pass_percentage"] == 50.0
    assert by_domain["Health"]["pass_percentage"] == 0.0


def test_test_case_status_metric(client: TestClient, platform_admin: dict) -> None:
    _full_scenario(client, platform_admin)

    report = client.get(
        "/api/v1/reports/aggregate", params={"metric": "test_case_status", "group_by": "project"}
    ).json()["data"]
    values = {row["value"]: row["count"] for row in report["rows"]}
    assert values.get("approved", 0) == 1


def test_aggregate_report_project_filter(client: TestClient, platform_admin: dict) -> None:
    _full_scenario(client, platform_admin)
    _create_project(client, "Unrelated Project", domain="Health")

    all_rows = client.get(
        "/api/v1/reports/aggregate", params={"metric": "priority", "group_by": "project"}
    ).json()["data"]["rows"]
    assert len(all_rows) == 1  # only the project with a test case has rows at all

    none_rows = client.get(
        "/api/v1/reports/aggregate",
        params={
            "metric": "priority",
            "group_by": "project",
            "project_id": "00000000-0000-0000-0000-000000000000",
        },
    ).json()["data"]["rows"]
    assert len(none_rows) == 0


def test_aggregate_report_priority_filter_excludes_other_priorities(
    client: TestClient, platform_admin: dict
) -> None:
    _, project = _full_scenario(client, platform_admin)
    # _full_scenario's case is priority "High" (see _create_approved_case).

    matching = client.get(
        "/api/v1/reports/aggregate",
        params={"metric": "defect_severity", "group_by": "project", "priority": "High"},
    ).json()["data"]["rows"]
    assert sum(r["count"] for r in matching) == 1

    non_matching = client.get(
        "/api/v1/reports/aggregate",
        params={"metric": "defect_severity", "group_by": "project", "priority": "Low"},
    ).json()["data"]["rows"]
    assert sum(r["count"] for r in non_matching) == 0


def test_aggregate_report_domain_and_assignee_filters(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)
    _create_project(client, "Health Only Project", domain="Health")

    health_only = client.get(
        "/api/v1/reports/aggregate",
        params={"metric": "priority", "group_by": "project", "domain": "Health"},
    ).json()["data"]["rows"]
    assert len(health_only) == 0  # Health project has no test cases

    motor_only = client.get(
        "/api/v1/reports/aggregate",
        params={"metric": "priority", "group_by": "project", "domain": "Motor"},
    ).json()["data"]["rows"]
    assert len(motor_only) == 1


def test_execution_trend_reflects_todays_verdicts(client: TestClient, platform_admin: dict) -> None:
    _full_scenario(client, platform_admin)

    trend = client.get("/api/v1/reports/execution-trend").json()["data"]
    assert len(trend["points"]) == 1
    today = trend["points"][0]
    assert today["pass_count"] == 1
    assert today["fail_count"] == 1
    assert today["ignore_count"] == 0


def test_compliance_detail_reflects_known_dataset(client: TestClient, platform_admin: dict) -> None:
    _full_scenario(client, platform_admin)

    report = client.get("/api/v1/reports/compliance-detail").json()["data"]
    assert report["tenant_name"] == "Horizon Mutual"
    assert report["reporting_officer_name"] == "Admin A"
    assert len(report["projects"]) == 1
    section = report["projects"][0]
    assert section["name"] == "Apex Motor Claims"
    assert section["total_test_cases"] == 1
    assert section["approved_test_cases"] == 1
    assert section["open_defects"] == 1
    assert section["critical_defects"] == 1
    assert len(section["test_cases"]) == 1
    assert len(section["defects"]) == 1


def test_compliance_detail_includes_requirement_coverage_and_defect_aging(
    client: TestClient, platform_admin: dict
) -> None:
    """Pass D: compliance report deepened with requirements coverage (reuses
    the RTM computation) and defect aging/SLA compliance (reuses Phase 6's
    existing age_days/sla_breached computation) -- no requirements were
    linked in this scenario, so coverage is correctly 0%, and the one open
    Critical defect is correctly bucketed."""
    _full_scenario(client, platform_admin)

    report = client.get("/api/v1/reports/compliance-detail").json()["data"]
    section = report["projects"][0]
    assert section["requirement_total"] == 0
    assert section["requirement_covered"] == 0
    assert section["requirement_coverage_percentage"] == 0.0
    assert section["defect_aging"]["total_open"] == 1
    critical_bucket = next(
        b for b in section["defect_aging"]["buckets"] if b["severity"] == "Critical"
    )
    assert critical_bucket["open_count"] == 1


def test_compliance_detail_trend_is_none_without_a_period(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)
    report = client.get("/api/v1/reports/compliance-detail").json()["data"]
    assert report["trend"] is None


def test_compliance_detail_trend_computed_with_a_period(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)
    report = client.get(
        "/api/v1/reports/compliance-detail",
        params={"period_from": "2026-01-01T00:00:00Z", "period_to": "2026-12-31T23:59:59Z"},
    ).json()["data"]
    assert report["trend"] is not None
    assert report["trend"]["test_cases_created_current"] == 1
    assert report["trend"]["defects_opened_current"] == 1
    assert report["trend"]["test_cases_created_prior"] == 0


def test_compliance_csv_includes_period_and_detail_tables(
    client: TestClient, platform_admin: dict
) -> None:
    _full_scenario(client, platform_admin)

    response = client.get(
        "/api/v1/reports/compliance-export",
        params={"period_from": "2026-01-01T00:00:00Z", "period_to": "2026-12-31T23:59:59Z"},
    )
    assert response.status_code == 200
    text = response.text
    assert "Reporting Period" in text
    assert "2026-01-01" in text
    assert "Apex Motor Claims -- Test Cases" in text
    assert "Verify Total Loss Settlement" in text
    assert "Apex Motor Claims -- Defects" in text
