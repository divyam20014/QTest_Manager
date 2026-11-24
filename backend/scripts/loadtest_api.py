"""Latency baseline for the key API endpoints under the seed_loadtest dataset. NOT part of pytest.

Logs in (password + simulated-MFA debug code) as the seeded Admin / Manager / Tester, then times each
endpoint at concurrency 1 and concurrency 20 and prints a markdown table (p50 / p95 / max ms,
response size, errors). Only httpx + stdlib. Run from any machine that can reach the API:

    python backend/scripts/loadtest_api.py --tenant-id <uuid> --roles admin,tester \
        --out scratchpad/perf_baseline.md [--n1 20 --n20 40] [--only search]

Read-only: GETs only (the CSV/XLSX exports are GETs as well). Needs MFA_DELIVERY_MODE=simulated.
"""

import argparse
import asyncio
import statistics
import subprocess
import time

import httpx

PASSWORD = "LoadTest#Perf2024xyz"
USERS = {
    "admin": "lt-admin@loadtest-perf.com",
    "manager": "lt-manager@loadtest-perf.com",
    "tester": "lt-tester@loadtest-perf.com",
}


def _parse() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--base", default="http://localhost:8000/api/v1")
    p.add_argument("--tenant-id", required=True)
    p.add_argument("--roles", default="admin,tester")
    p.add_argument("--n1", type=int, default=20, help="requests at concurrency 1")
    p.add_argument("--n20", type=int, default=40, help="requests at concurrency 20")
    p.add_argument("--only", default="", help="substring filter on endpoint names")
    p.add_argument("--skip", default="", help="comma separated name substrings to skip")
    p.add_argument("--out", default="")
    p.add_argument("--api-container", default="", help="docker container name for mem snapshots")
    return p.parse_args()


async def login(base: str, tenant_id: str, role: str) -> httpx.AsyncClient:
    c = httpx.AsyncClient(base_url=base, timeout=120, limits=httpx.Limits(max_connections=40))
    r = await c.post(
        "/auth/login", json={"tenant_id": tenant_id, "email": USERS[role], "password": PASSWORD}
    )
    r.raise_for_status()
    code = r.json()["data"]["debug_code"]
    r = await c.post("/auth/mfa/verify", json={"code": code})
    r.raise_for_status()
    return c


def endpoints(pid: str, role: str) -> list[tuple[str, str, dict, bool]]:
    """(name, path, params, heavy). heavy ones run at low N and c=1 only."""
    e = [
        ("test-cases list (default)", "/test-cases", {}, False),
        ("test-cases list page_size=100", "/test-cases", {"page_size": 100}, False),
        ("test-cases search 'payment'", "/test-cases", {"search": "payment"}, False),
        ("test-cases search 'case 12345'", "/test-cases", {"search": "case 12345"}, False),
        ("test-cases status=approved", "/test-cases", {"status": "approved"}, False),
        ("test-cases deep page 500 (ps=100)", "/test-cases", {"page": 500, "page_size": 100}, False),
        ("test-cases sort=-title", "/test-cases", {"sort": "-title"}, False),
        ("test-cases sort=priority", "/test-cases", {"sort": "priority"}, False),
        ("project test-cases (default)", f"/projects/{pid}/test-cases", {}, False),
        ("project test-cases deep page 50", f"/projects/{pid}/test-cases", {"page": 50, "page_size": 100}, False),
        ("test-runs list", "/test-runs", {}, False),
        ("test-runs list search 'Run 12'", "/test-runs", {"search": "Run 12"}, False),
        ("test-runs status=finished", "/test-runs", {"status": "finished"}, False),
        ("project test-runs", f"/projects/{pid}/test-runs", {}, False),
        ("defects list (paged 20)", "/defects", {"page_size": 20}, False),
        ("defects list status=Open", "/defects", {"page_size": 20, "status": "Open"}, False),
        ("defects search 'payment'", "/defects", {"page_size": 20, "search": "payment"}, False),
        ("defects deep page 2000", "/defects", {"page_size": 20, "page": 2000}, False),
        ("defects status-counts", "/defects/status-counts", {}, False),
        ("defects plain list (project, no page_size)", "/defects", {"project_id": pid}, False),
        ("projects list", "/projects", {}, False),
        ("dashboard summary", "/dashboard/summary", {}, False),
        ("dashboard summary (project)", "/dashboard/summary", {"project_id": pid}, False),
        ("dashboard domain-distribution", "/dashboard/domain-distribution", {}, False),
        ("dashboard activity-stream", "/dashboard/activity-stream", {}, False),
        ("report aggregate run_status/project", "/reports/aggregate", {"metric": "run_status", "group_by": "project"}, False),
        ("report aggregate priority/domain", "/reports/aggregate", {"metric": "priority", "group_by": "domain"}, False),
        ("report aggregate defect_status/assignee", "/reports/aggregate", {"metric": "defect_status", "group_by": "assignee"}, False),
        ("report execution-trend", "/reports/execution-trend", {}, False),
        ("report defect-trend", "/reports/defect-trend", {}, False),
        ("report defect-aging", "/reports/defect-aging", {}, False),
        ("report defect-reopen-summary", "/reports/defect-reopen-summary", {}, False),
        ("report release-readiness (project)", "/reports/release-readiness", {"project_id": pid}, False),
        ("report workload (project)", "/reports/workload", {"project_id": pid}, False),
        *[
            (f"report {name} (project)", f"/reports/{name}", {"project_id": pid}, False)
            for name in (
                "project-test-status",
                "module-coverage",
                "tester-performance",
                "overdue-run-cases",
                "upcoming-milestones",
            )
        ],
        ("my-work run-cases (project)", "/my-work/run-cases", {"project_id": pid}, False),
        ("project dashboard layout", f"/projects/{pid}/dashboard", {}, False),
        ("report flaky-tests (project)", "/reports/flaky-tests", {"project_id": pid}, False),
        ("report quality-metrics", "/reports/quality-metrics", {}, False),
        ("report defect-leakage", "/reports/defect-leakage", {}, False),
        ("report traceability-matrix (project)", "/reports/traceability-matrix", {"project_id": pid}, False),
        ("requirements list (project)", f"/projects/{pid}/requirements", {}, False),
        ("requirements coverage (project)", f"/projects/{pid}/requirements/coverage", {}, False),
        ("notifications list", "/notifications", {}, False),
        ("notifications unread-count", "/notifications/unread-count", {}, False),
        ("global search 'payment'", "/search", {"q": "payment"}, False),
        ("global search 'REQ-12'", "/search", {"q": "REQ-12"}, False),
    ]
    if role in ("admin", "manager"):
        e += [
            ("audit-logs list", "/audit-logs", {}, False),
            ("audit-logs filter action+entity", "/audit-logs", {"action": "defect.status_changed", "entity_type": "defect"}, False),
            ("audit-logs deep offset 100000", "/audit-logs", {"offset": 100000}, False),
            ("audit verify-chain (500k rows)", "/audit-logs/verify-chain", {}, True),
            ("audit export", "/audit-logs/export", {}, True),
        ]
    e += [
        ("EXPORT project test-cases CSV", f"/projects/{pid}/test-cases/export.csv", {}, True),
        ("EXPORT aggregate XLSX", "/reports/aggregate/export.xlsx", {"metric": "run_status", "group_by": "project"}, True),
        ("EXPORT compliance XLSX", "/reports/compliance-export.xlsx", {}, True),
    ]
    return e


async def timed(c: httpx.AsyncClient, path: str, params: dict, sem: asyncio.Semaphore):
    async with sem:
        t = time.perf_counter()
        try:
            r = await c.get(path, params=params)
            return (time.perf_counter() - t) * 1000, r.status_code, len(r.content)
        except Exception as exc:  # noqa: BLE001
            return (time.perf_counter() - t) * 1000, type(exc).__name__, 0


def pct(v: list[float], q: float) -> float:
    s = sorted(v)
    return s[min(len(s) - 1, int(len(s) * q))]


async def measure(c, path, params, n, conc):
    sem = asyncio.Semaphore(conc)
    res = await asyncio.gather(*[timed(c, path, params, sem) for _ in range(n)])
    ok = [r for r in res if r[1] == 200]
    errs = sorted({str(r[1]) for r in res if r[1] != 200})
    lat = [r[0] for r in ok] or [0.0]
    size = ok[0][2] if ok else 0
    return {
        "p50": statistics.median(lat),
        "p95": pct(lat, 0.95),
        "max": max(lat),
        "size": size,
        "errs": ",".join(errs),
        "nerr": len(res) - len(ok),
    }


def mem(container: str) -> str:
    if not container:
        return ""
    try:
        out = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", container],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        return out.split("/")[0].strip()
    except Exception:  # noqa: BLE001
        return "?"


async def run_role(args, role: str) -> list[str]:
    c = await login(args.base, args.tenant_id, role)
    r = await c.get("/projects")
    pid = r.json()["data"]["items"][0]["id"]
    lines = [
        f"### Role: {role}",
        "",
        "| Endpoint | c=1 p50 ms | c=1 p95 | c=1 max | c=20 p50 ms | c=20 p95 | c=20 max | size KB | errors |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for name, path, params, heavy in endpoints(pid, role):
        if args.only and args.only not in name:
            continue
        if args.skip and any(k and k in name for k in args.skip.split(",")):
            continue
        m0 = mem(args.api_container) if heavy else ""
        await measure(c, path, params, 1, 1)  # warm-up (not counted)
        a = await measure(c, path, params, 3 if heavy else args.n1, 1)
        if heavy:
            b = {"p50": float("nan"), "p95": float("nan"), "max": float("nan"), "errs": "", "nerr": 0}
            note = f" mem {m0}->{mem(args.api_container)}" if args.api_container else ""
        else:
            b = await measure(c, path, params, args.n20, 20)
            note = ""
        errs = (a["errs"] + "," + b["errs"]).strip(",")
        print(f"{role:7} {name:45} c1 p50={a['p50']:8.1f} c20 p50={b['p50']:8.1f} {errs}", flush=True)
        lines.append(
            f"| {name} | {a['p50']:.0f} | {a['p95']:.0f} | {a['max']:.0f} | "
            f"{b['p50']:.0f} | {b['p95']:.0f} | {b['max']:.0f} | {a['size'] / 1024:.1f} | {errs}{note} |"
        )
    await c.aclose()
    return lines + [""]


async def main() -> None:
    args = _parse()
    out = [
        "# API performance baseline",
        "",
        f"tenant {args.tenant_id}; c=1: {args.n1} reqs (heavy/export: 3), c=20: {args.n20} reqs at "
        "concurrency 20; one warm-up request excluded; ms. Exports/verify-chain run at c=1 only.",
        "",
    ]
    for role in args.roles.split(","):
        out += await run_role(args, role.strip())
    text = "\n".join(out)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
    print(text[-300:])


if __name__ == "__main__":
    asyncio.run(main())
