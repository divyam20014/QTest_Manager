"""BRD gap Phase 3 (ADR-071): Excel exports, quality-metrics report, and the
Phase 2 verification gaps (auto-finish from CI ingestion, concurrent final
verdicts)."""

import io
import re
import zipfile
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app.core.xlsx_report import XLSX_MEDIA_TYPE, SheetSpec, build_workbook, safe_cell
from tests.test_execution import (
    _create_approved_case,
    _create_user,
    _login_and_verify,
    _setup_admin_project_and_case,
)


def _xlsx_strings(contents: bytes) -> tuple[list[str], list[str]]:
    """(sheet names, every shared string) from a workbook, no extra deps."""
    with zipfile.ZipFile(io.BytesIO(contents)) as zf:
        workbook = zf.read("xl/workbook.xml").decode()
        shared = (
            zf.read("xl/sharedStrings.xml").decode()
            if "xl/sharedStrings.xml" in zf.namelist()
            else ""
        )
    names = re.findall(r'<sheet name="([^"]*)"', workbook)
    strings = re.findall(r"<t[^>]*>([^<]*)</t>", shared)
    return names, strings


def _make_run(client: TestClient, project_id: str, case_ids: list[str], name: str = "P3 Run"):
    response = client.post(
        f"/api/v1/projects/{project_id}/test-runs",
        json={"name": name, "run_type": "Regression", "test_case_ids": case_ids},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _steps(client: TestClient, run_case_id: str) -> list[dict]:
    return client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]


def _pass_all_steps(client: TestClient, run_case_id: str) -> None:
    for step in _steps(client, run_case_id):
        response = client.post(
            f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"}
        )
        assert response.status_code == 200, response.text


# -- xlsx helper -------------------------------------------------------------


def test_safe_cell_neutralises_formula_starters() -> None:
    assert safe_cell("=SUM(A1:A2)") == "'=SUM(A1:A2)"
    assert safe_cell("+1+1") == "'+1+1"
    assert safe_cell("-2") == "'-2"
    assert safe_cell("@cmd") == "'@cmd"
    assert safe_cell("\tTab") == "'\tTab"
    assert safe_cell("Plain text") == "Plain text"
    assert safe_cell("") == ""


def test_build_workbook_guards_injection_and_sheet_names() -> None:
    contents = build_workbook(
        [
            SheetSpec("A/B:[bad]?", ["Title"], [('=HYPERLINK("http://x")',), ("ok",)]),
            SheetSpec("A/B:[bad]?", ["Title"], [(5,)]),
        ]
    )
    names, strings = _xlsx_strings(contents)
    assert len(names) == 2 and len(set(n.lower() for n in names)) == 2
    assert all(len(n) <= 31 and not set("[]:*?/\\") & set(n) for n in names)
    assert "'=HYPERLINK(\"http://x\")" in strings
    assert "=HYPERLINK(\"http://x\")" not in strings


# -- Excel exports -----------------------------------------------------------


def test_report_exports_return_real_workbooks(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    _pass_all_steps(client, run["cases"][0]["id"])

    aggregate = client.get(
        "/api/v1/reports/aggregate/export.xlsx",
        params={"metric": "run_status", "group_by": "project", "project_id": project["id"]},
    )
    assert aggregate.status_code == 200, aggregate.text
    assert aggregate.headers["content-type"].startswith(XLSX_MEDIA_TYPE)
    assert "report_run_status.xlsx" in aggregate.headers["content-disposition"]
    names, strings = _xlsx_strings(aggregate.content)
    assert names == ["Report", "Data"]
    assert "passed" in strings and "Apex Motor Claims" in strings

    compliance = client.get("/api/v1/reports/compliance-export.xlsx")
    assert compliance.status_code == 200, compliance.text
    names, strings = _xlsx_strings(compliance.content)
    assert "Compliance Summary" in names and "Quality Metrics" in names
    assert "Apex Motor Claims" in strings

    traceability = client.get(
        "/api/v1/reports/traceability-matrix/export.xlsx", params={"project_id": project["id"]}
    )
    assert traceability.status_code == 200, traceability.text
    assert _xlsx_strings(traceability.content)[0] == ["Traceability"]

    cases = client.get(f"/api/v1/projects/{project['id']}/test-cases/export.xlsx")
    assert cases.status_code == 200, cases.text
    names, strings = _xlsx_strings(cases.content)
    assert names == ["Test Cases"]
    assert "Verify Total Loss Settlement" in strings

    quality = client.get("/api/v1/reports/quality-metrics/export.xlsx")
    assert quality.status_code == 200, quality.text
    assert _xlsx_strings(quality.content)[0] == ["Quality Metrics", "Cycle Time by Project"]


def test_test_case_export_neutralises_formula_titles(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, _ = _setup_admin_project_and_case(client, platform_admin)
    _create_approved_case(client, project["id"], "=cmd|' /C calc'!A0")
    response = client.get(f"/api/v1/projects/{project['id']}/test-cases/export.xlsx")
    assert response.status_code == 200
    _, strings = _xlsx_strings(response.content)
    assert not any(s.startswith("=cmd") for s in strings)
    assert any(s.startswith("'=cmd") for s in strings)


def test_tester_cannot_export_compliance_but_can_export_reports(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, _ = _setup_admin_project_and_case(client, platform_admin)
    tester_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    client.post(f"/api/v1/projects/{project['id']}/members", json={"user_id": tester_id})
    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    assert tester.get("/api/v1/reports/compliance-export.xlsx").status_code == 403
    ok = tester.get(
        "/api/v1/reports/aggregate/export.xlsx",
        params={"metric": "run_status", "group_by": "project"},
    )
    assert ok.status_code == 200, ok.text


def test_exports_are_tenant_scoped(client: TestClient, platform_admin: dict) -> None:
    _, project, _ = _setup_admin_project_and_case(client, platform_admin)
    other = TestClient(client.app)
    response = other.post(
        "/api/v1/platform/tenants",
        headers=platform_admin["headers"],
        json={
            "tenant_name": "Other Mutual",
            "admin_name": "Admin B",
            "admin_email": "admin@other.com",
            "admin_password": "AdminPassw0rd!",
        },
    )
    other_tenant = response.json()["data"]["tenant"]["id"]
    _login_and_verify(other, other_tenant, "admin@other.com", "AdminPassw0rd!")
    denied = other.get(f"/api/v1/projects/{project['id']}/test-cases/export.xlsx")
    assert denied.status_code in (403, 404)


# -- Quality metrics ---------------------------------------------------------


def test_quality_metrics_empty_tenant_reports_no_data_not_zero(
    client: TestClient, platform_admin: dict
) -> None:
    _setup_admin_project_and_case(client, platform_admin)
    data = client.get("/api/v1/reports/quality-metrics").json()["data"]
    assert data["period_days"] == 30
    assert data["step_defect_precision_percentage"] is None
    assert data["execution_defect_count"] == 0
    assert data["average_cycle_time_hours"] is None
    assert data["finished_run_count"] == 0
    assert data["step_pass_percentage"] is None
    # One approved case exists, so review-gate coverage is a real 100%.
    assert data["total_test_cases"] == 1
    assert data["review_gate_coverage_percentage"] == 100.0


def test_quality_metrics_compute_from_real_data(client: TestClient, platform_admin: dict) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    client.post(
        f"/api/v1/projects/{project['id']}/test-cases",
        json={
            "title": "Draft only case",
            "priority": "Low",
            "steps": [{"action": "a", "expected": "b"}],
        },
    )
    run = _make_run(client, project["id"], [case["id"]])
    run_case_id = run["cases"][0]["id"]
    steps = _steps(client, run_case_id)
    # Fail step 1 -> defect from step; pass the rest.
    client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict",
        json={"verdict": "fail", "actual_result": "Observed a failure"},
    )
    from_step = client.post(
        "/api/v1/defects", json={"execution_step_id": steps[0]["id"], "severity": "High"}
    )
    assert from_step.status_code == 200, from_step.text
    # A standalone defect never counts as execution-raised.
    client.post(
        "/api/v1/defects",
        json={"project_id": project["id"], "title": "Standalone defect", "severity": "Low"},
    )
    for step in steps[1:]:
        client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
    # Re-verdict the failed step to pass: the case passes and the run auto-finishes.
    client.post(f"/api/v1/execution-steps/{steps[0]['id']}/verdict", json={"verdict": "pass"})
    assert client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["finished_at"] is not None

    data = client.get("/api/v1/reports/quality-metrics", params={"days": 30}).json()["data"]
    assert data["execution_defect_count"] == 1
    assert data["step_linked_defect_count"] == 1
    assert data["step_defect_precision_percentage"] == 100.0
    assert data["finished_run_count"] == 1
    assert data["average_cycle_time_hours"] is not None
    assert data["cycle_time_by_project"][0]["project_name"] == "Apex Motor Claims"
    assert data["step_sample_size"] >= 3
    assert data["step_pass_percentage"] is not None
    assert data["total_test_cases"] == 2
    assert data["approved_test_cases"] == 1
    assert data["review_gate_coverage_percentage"] == 50.0

    # run_type filter: no Sanity runs exist, so cycle time has no data.
    sanity = client.get("/api/v1/reports/quality-metrics", params={"run_type": "Sanity"}).json()
    assert sanity["data"]["average_cycle_time_hours"] is None
    # Validation.
    assert client.get("/api/v1/reports/quality-metrics", params={"days": 0}).status_code == 422
    assert (
        client.get("/api/v1/reports/quality-metrics", params={"run_type": "x"}).status_code == 422
    )


def test_quality_metrics_exclude_soft_deleted_runs_and_defects(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    run = _make_run(client, project["id"], [case["id"]])
    steps = _steps(client, run["cases"][0]["id"])
    client.post(
        f"/api/v1/execution-steps/{steps[0]['id']}/verdict",
        json={"verdict": "fail", "actual_result": "Observed a failure"},
    )
    defect = client.post(
        "/api/v1/defects", json={"execution_step_id": steps[0]["id"], "severity": "High"}
    ).json()["data"]
    assert (
        client.get("/api/v1/reports/quality-metrics").json()["data"]["execution_defect_count"] == 1
    )
    assert client.delete(f"/api/v1/defects/{defect['id']}").status_code == 200
    after = client.get("/api/v1/reports/quality-metrics").json()["data"]
    assert after["execution_defect_count"] == 0
    assert after["step_defect_precision_percentage"] is None


def test_quality_metrics_scope_and_permission(client: TestClient, platform_admin: dict) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    _make_run(client, project["id"], [case["id"]])
    outsider_id = _create_user(
        client, "tester@horizon.com", "Tester One", "tester", "TesterPassw0rd!"
    )
    assert outsider_id
    tester = TestClient(client.app)
    _login_and_verify(tester, tenant_id, "tester@horizon.com", "TesterPassw0rd!")
    # A Tester who is not a member of the project sees no data from it.
    data = tester.get("/api/v1/reports/quality-metrics").json()["data"]
    assert data["total_test_cases"] == 0
    assert data["review_gate_coverage_percentage"] is None
    unauth = TestClient(client.app).get("/api/v1/reports/quality-metrics")
    assert unauth.status_code == 401


# -- Phase 2 verification gaps -------------------------------------------------


def test_ci_ingestion_auto_finishes_run_and_audits_it(
    client: TestClient, platform_admin: dict
) -> None:
    tenant_id, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    run = _make_run(client, project["id"], [case["id"], case2["id"]])
    token = client.post("/api/v1/service-tokens", json={"name": "CI"}).json()["data"]
    headers = {"Authorization": f"Bearer {token['raw_value']}"}
    url = f"/api/v1/ci/{tenant_id}/webhooks/test-results"
    first, second = run["cases"][0]["id"], run["cases"][1]["id"]

    one = client.post(
        url, headers=headers, json={"results": [{"test_run_case_id": first, "status": "passed"}]}
    )
    assert one.status_code == 200 and one.json()["data"]["accepted_count"] == 1
    assert client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]["finished_at"] is None

    two = client.post(
        url, headers=headers, json={"results": [{"test_run_case_id": second, "status": "passed"}]}
    )
    assert two.json()["data"]["accepted_count"] == 1
    done = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert done["finished_at"] is not None

    logs = client.get("/api/v1/audit-logs", params={"action": "testrun.finished", "limit": 50})
    events = [e for e in logs.json()["data"] if e["entity_id"] == run["id"]]
    assert len(events) == 1
    assert events[0]["metadata"].get("auto") is True
    assert events[0].get("service_token_id") == token["token"]["id"]

    # A late CI delivery for the now-finished run is rejected per row, not double-finished.
    late = client.post(
        url, headers=headers, json={"results": [{"test_run_case_id": first, "status": "failed"}]}
    )
    assert late.json()["data"]["rejected_count"] == 1
    logs2 = client.get("/api/v1/audit-logs", params={"action": "testrun.finished", "limit": 50})
    assert len([e for e in logs2.json()["data"] if e["entity_id"] == run["id"]]) == 1


def test_two_final_verdicts_at_once_finish_the_run_exactly_once(
    client: TestClient, platform_admin: dict
) -> None:
    _, project, case = _setup_admin_project_and_case(client, platform_admin)
    case2 = _create_approved_case(client, project["id"], "Verify Salvage Valuation")
    run = _make_run(client, project["id"], [case["id"], case2["id"]])
    first, second = run["cases"][0]["id"], run["cases"][1]["id"]

    # Leave exactly one open step on each case, then land both final verdicts together.
    pending: list[str] = []
    for run_case_id in (first, second):
        steps = _steps(client, run_case_id)
        for step in steps[:-1]:
            client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})
        pending.append(steps[-1]["id"])

    def _final(step_id: str) -> int:
        thread_client = TestClient(client.app)
        thread_client.cookies.update(client.cookies)
        return thread_client.post(
            f"/api/v1/execution-steps/{step_id}/verdict", json={"verdict": "pass"}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = [f.result() for f in [pool.submit(_final, s) for s in pending]]
    assert statuses == [200, 200]

    done = client.get(f"/api/v1/test-runs/{run['id']}").json()["data"]
    assert done["finished_at"] is not None
    logs = client.get("/api/v1/audit-logs", params={"action": "testrun.finished", "limit": 50})
    events = [e for e in logs.json()["data"] if e["entity_id"] == run["id"]]
    assert len(events) == 1
    assert client.post(f"/api/v1/test-runs/{run['id']}/finish").status_code == 409
