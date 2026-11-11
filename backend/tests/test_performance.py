"""Performance/NFR validation against the BRD's stated targets.

Methodology note (applies to every timing test in this file): `TestClient`
bridges to the ASGI app in-process via httpx's ASGI transport -- there is no
real TCP/HTTP stack, no network, no browser, no reverse proxy. Every number
measured here is "time inside the Python process to run the route handler
plus ORM/DB round trip," not end-user-perceived latency. That is a lower
bound on real latency, not an equivalent measurement -- it cannot by itself
prove a browser-observed "<50ms" or "<100ms" target, but it is the only
latency signal obtainable without standing up a real HTTP server + load
generator (which the user explicitly chose not to add for this pass). Real
network latency should be measured separately (e.g. browser devtools /
an external HTTP load tool) before treating these as a final verdict.

Every test prints its actual measured numbers via `-s` so they survive
into the pytest output used for Performance_Test_Report.md -- none of
these silently pass without a human-readable measurement attached.
"""

import statistics
import time
from concurrent.futures import ThreadPoolExecutor

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


def _create_project(client: TestClient, name: str) -> dict:
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


def _sample_steps() -> list[dict]:
    return [
        {"action": "Input Policy Number", "expected": "ACV displayed"},
        {"action": "Apply $500 deductible", "expected": "Payout = ACV - 500"},
        {"action": "Confirm settlement letter", "expected": "Letter generated"},
    ]


def _create_approved_case(client: TestClient, project_id: str, title: str) -> dict:
    case = client.post(
        f"/api/v1/projects/{project_id}/test-cases",
        json={"title": title, "priority": "High", "steps": _sample_steps()},
    ).json()["data"]
    client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
    approve_response = client.post(f"/api/v1/test-cases/{case['id']}/approve")
    return approve_response.json()["data"]


def _setup_admin_project_and_case(
    client: TestClient, platform_admin: dict
) -> tuple[str, dict, dict]:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client, "Apex Motor Claims")
    case = _create_approved_case(client, project["id"], "Verify Total Loss Settlement")
    return tenant_id, project, case


def _timed(fn, iterations: int = 10) -> tuple[list[float], list]:
    """Runs `fn()` `iterations` times, returning (elapsed_ms_per_call, results)."""
    samples: list[float] = []
    results = []
    for _ in range(iterations):
        start = time.perf_counter()
        results.append(fn())
        samples.append((time.perf_counter() - start) * 1000)
    return samples, results


def _percentile(samples: list[float], pct: float) -> float:
    ordered = sorted(samples)
    idx = min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))
    return ordered[idx]


def _report(label: str, samples: list[float], target_ms: float | None = None) -> None:
    median = statistics.median(samples)
    p95 = _percentile(samples, 95)
    worst = max(samples)
    target_note = f" (BRD target: <{target_ms}ms, in-process measurement only)" if target_ms else ""
    print(
        f"\n[PERF] {label}: median={median:.2f}ms p95={p95:.2f}ms max={worst:.2f}ms "
        f"n={len(samples)}{target_note}"
    )


# ---------------------------------------------------------------------------
# 1. Step toggle response (BRD target: <50ms, perceived/UI latency)
# ---------------------------------------------------------------------------


def test_step_open_and_verdict_in_process_latency(client: TestClient, platform_admin: dict) -> None:
    """Measures in-process handler time (ORM + hash-chained audit write
    included) for the two hottest execution-console actions, ISOLATING the
    single POST call inside the timed region -- all run/run-case/step setup
    happens before the clock starts, so the measurement reflects only the
    endpoint's own handler time, not fixture creation overhead. Each
    iteration uses a fresh run-case/step so `open` always hits the real
    "first open" code path rather than the idempotent-repeat path."""
    _, project, case = _setup_admin_project_and_case(client, platform_admin)

    def _make_step() -> str:
        run = client.post(
            f"/api/v1/projects/{project['id']}/test-runs",
            json={"name": "Perf Run", "run_type": "Regression", "test_case_ids": [case["id"]]},
        ).json()["data"]
        run_case_id = run["cases"][0]["id"]
        steps = client.get(f"/api/v1/test-run-cases/{run_case_id}/steps").json()["data"]
        return steps[0]["id"]

    open_step_ids = [_make_step() for _ in range(10)]
    open_samples, opened_ids = _timed(
        lambda: client.post(f"/api/v1/execution-steps/{open_step_ids.pop()}/open")
    )
    for r in opened_ids:
        assert r.status_code == 200, r.text
    _report("POST /execution-steps/{id}/open", open_samples, target_ms=50)

    verdict_step_ids = [_make_step() for _ in range(10)]
    for step_id in verdict_step_ids:
        client.post(f"/api/v1/execution-steps/{step_id}/open")

    verdict_samples, verdict_results = _timed(
        lambda: client.post(
            f"/api/v1/execution-steps/{verdict_step_ids.pop()}/verdict", json={"verdict": "pass"}
        )
    )
    for r in verdict_results:
        assert r.status_code == 200, r.text
    _report("POST /execution-steps/{id}/verdict", verdict_samples, target_ms=50)

    # Sanity ceiling only -- catches catastrophic regressions, not the real
    # sub-50ms UX target (see module docstring).
    assert statistics.median(open_samples) < 2000
    assert statistics.median(verdict_samples) < 2000


# ---------------------------------------------------------------------------
# 2. Search/filter response (BRD target: <100ms)
# ---------------------------------------------------------------------------


def test_search_filter_latency_against_seeded_dataset(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")

    domains = ["Motor", "Health", "Travel", "Life", "Property"]
    projects = []
    for i in range(30):
        resp = client.post(
            "/api/v1/projects",
            json={
                "name": f"Perf Project {i:03d}",
                "domain": domains[i % len(domains)],
                "priority": "High",
                "manager_name": "Jane Manager",
                "start_date": "2026-01-01",
                "end_date": "2026-12-31",
                "budget": "450000.00",
                "region": "North America",
            },
        )
        assert resp.status_code == 200, resp.text
        projects.append(resp.json()["data"])

    main_project = projects[0]
    for i in range(150):
        client.post(
            f"/api/v1/projects/{main_project['id']}/test-cases",
            json={
                "title": f"Perf Test Case {i:04d} Verify Settlement",
                "priority": ["Low", "Medium", "High", "Critical"][i % 4],
                "steps": _sample_steps(),
            },
        )

    project_search_samples, project_results = _timed(
        lambda: client.get("/api/v1/projects", params={"search": "Perf Project 01"}), iterations=10
    )
    for r in project_results:
        assert r.status_code == 200
    _report("GET /projects?search=", project_search_samples, target_ms=100)

    tc_search_samples, tc_results = _timed(
        lambda: client.get(
            f"/api/v1/projects/{main_project['id']}/test-cases",
            params={"search": "Verify", "priority": "High"},
        ),
        iterations=10,
    )
    for r in tc_results:
        assert r.status_code == 200
    _report("GET /projects/{id}/test-cases?search=&priority=", tc_search_samples, target_ms=100)

    audit_samples, audit_results = _timed(
        lambda: client.get("/api/v1/audit-logs", params={"action": "testcase.created"}),
        iterations=10,
    )
    for r in audit_results:
        assert r.status_code == 200
    _report("GET /audit-logs?action=", audit_samples, target_ms=100)

    assert statistics.median(project_search_samples) < 2000
    assert statistics.median(tc_search_samples) < 2000
    assert statistics.median(audit_samples) < 2000


# ---------------------------------------------------------------------------
# 3. CSV import up to 2,000 rows -- real HTTP round trip timing
# ---------------------------------------------------------------------------


def _generate_bulk_csv(project_name: str, n: int) -> str:
    lines = [
        "Title,Module,Sub Module,Project Name,Priority,Status,Description,Scenario Id,"
        "Scenario Description,Prerequisite,Test Data,Assignee Email,Steps"
    ]
    for i in range(n):
        lines.append(
            f'"Bulk Perf Test Case {i:05d}","Perf","","{project_name}","Medium","Draft",'
            f'"Perf test row {i}.","","","","",,'
            f'"Perform action {i}|Expect outcome {i};Second step {i}|Second outcome {i}"'
        )
    return "\n".join(lines) + "\n"


def test_csv_import_2000_rows_http_round_trip_timing(
    client: TestClient, platform_admin: dict
) -> None:
    """Real end-to-end HTTP timing (not the service-layer-only measurement
    in test_csv_import.py, which deliberately bypasses TestClient's ASGI
    bridge overhead). This number includes that bridge overhead, so it is
    strictly worse than true server-side processing time -- see module
    docstring."""
    import io

    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    _create_project(client, "Bulk Perf Project")

    csv_text = _generate_bulk_csv("Bulk Perf Project", 2000)
    files = {"file": ("import.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv")}

    start = time.perf_counter()
    response = client.post("/api/v1/test-cases/import", files=files)
    elapsed = time.perf_counter() - start

    assert response.status_code == 200, response.text
    report = response.json()["data"]
    assert report["created_count"] == 2000

    print(f"\n[PERF] POST /test-cases/import (2000 rows, real HTTP round trip): {elapsed:.3f}s")
    # Generous ceiling to catch regressions; the service-layer test already
    # enforces the real 2.5s NFR budget without TestClient's fixed overhead.
    assert elapsed < 15.0


# ---------------------------------------------------------------------------
# 4. Dashboard aggregation performance under realistic volume
# ---------------------------------------------------------------------------


def test_dashboard_and_reporting_latency_under_volume(
    client: TestClient, platform_admin: dict
) -> None:
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    project = _create_project(client, "Volume Project")

    case_ids = []
    for i in range(200):
        case = client.post(
            f"/api/v1/projects/{project['id']}/test-cases",
            json={
                "title": f"Volume Test Case {i:04d}",
                "priority": ["Low", "Medium", "High", "Critical"][i % 4],
                "steps": _sample_steps(),
            },
        ).json()["data"]
        client.post(f"/api/v1/test-cases/{case['id']}/submit-review")
        client.post(f"/api/v1/test-cases/{case['id']}/approve")
        case_ids.append(case["id"])

    run = client.post(
        f"/api/v1/projects/{project['id']}/test-runs",
        json={"name": "Volume Run", "run_type": "Regression", "test_case_ids": case_ids[:50]},
    ).json()["data"]
    for run_case in run["cases"][:20]:
        steps = client.get(f"/api/v1/test-run-cases/{run_case['id']}/steps").json()["data"]
        for step in steps:
            client.post(f"/api/v1/execution-steps/{step['id']}/open")
            client.post(f"/api/v1/execution-steps/{step['id']}/verdict", json={"verdict": "pass"})

    for i in range(30):
        resp = client.post(
            "/api/v1/defects",
            json={
                "project_id": project["id"],
                "title": f"Volume Defect {i:03d}",
                "severity": ["Low", "Medium", "High", "Critical"][i % 4],
            },
        )
        assert resp.status_code == 200, resp.text

    summary_samples, summary_results = _timed(
        lambda: client.get("/api/v1/dashboard/summary"), iterations=10
    )
    for r in summary_results:
        assert r.status_code == 200, r.text
    _report("GET /dashboard/summary (200 cases/50 runs/30 defects)", summary_samples)

    domain_samples, domain_results = _timed(
        lambda: client.get("/api/v1/dashboard/domain-distribution"), iterations=10
    )
    for r in domain_results:
        assert r.status_code == 200
    _report("GET /dashboard/domain-distribution", domain_samples)

    aggregate_samples, aggregate_results = _timed(
        lambda: client.get(
            "/api/v1/reports/aggregate", params={"metric": "priority", "group_by": "project"}
        ),
        iterations=10,
    )
    for r in aggregate_results:
        assert r.status_code == 200
    _report("GET /reports/aggregate?metric=priority&group_by=project", aggregate_samples)

    assert statistics.median(summary_samples) < 5000
    assert statistics.median(domain_samples) < 5000
    assert statistics.median(aggregate_samples) < 5000


# ---------------------------------------------------------------------------
# 5. Concurrent usage / basic throughput
# ---------------------------------------------------------------------------


def test_concurrent_read_throughput(client: TestClient, platform_admin: dict) -> None:
    """Fires N concurrent GET requests at a read endpoint and measures
    wall-clock throughput. This is a correctness-under-concurrency +
    coarse throughput signal using Python threads against the same
    in-process app, not a real multi-connection network load test."""
    bootstrap = _bootstrap_tenant(client, platform_admin)
    tenant_id = bootstrap["tenant"]["id"]
    _login_and_verify(client, tenant_id, "admin@horizon.com", "AdminPassw0rd!")
    _create_project(client, "Concurrency Project")

    def _get_summary() -> int:
        thread_client = TestClient(client.app)
        thread_client.cookies.update(client.cookies)
        return thread_client.get("/api/v1/dashboard/summary").status_code

    concurrency = 20
    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        statuses = list(pool.map(lambda _: _get_summary(), range(concurrency)))
    elapsed = time.perf_counter() - start

    assert all(s == 200 for s in statuses), statuses
    throughput = concurrency / elapsed
    print(
        f"\n[PERF] {concurrency} concurrent GET /dashboard/summary: "
        f"{elapsed:.3f}s total, {throughput:.1f} req/s, "
        f"{statuses.count(200)}/{concurrency} succeeded"
    )
    assert elapsed < 30.0
