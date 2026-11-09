# Performance Test Report — QTestHub

**Engagement:** Principal QA Architect end-to-end testing pass — performance/NFR validation.
**Scope:** BRD-stated targets — step toggle response < 50ms, search/filter response < 100ms, CSV import up to 2,000 rows, dashboard aggregation performance, realistic concurrent usage.
**Tooling decision:** lightweight `pytest`-based timing using `time.perf_counter()` against the real ASGI app, **not** a dedicated load-testing tool (k6/Locust) — explicitly chosen by the user for this pass, consistent with the existing test suite's style and with no new dependency added.
**New file:** `backend/tests/test_performance.py` (5 tests, all pass). Numbers below are from a clean, isolated run (`pytest tests/test_performance.py -s -q`, no other process touching the shared test database).

---

## Critical methodology caveat — read before interpreting any number below

`TestClient` bridges to the FastAPI app **in-process** via httpx's ASGI transport. There is **no real TCP/HTTP stack, no network, no browser, no reverse proxy** in this measurement. Every number below is "time inside the Python process to run the route handler plus the real ORM/Postgres round trip" — a genuine signal of **server-side processing cost**, but it is a **lower bound**, not an equivalent, for what a user's browser would actually experience (which adds real network RTT, TLS handshake amortization, browser request-queuing, and React re-render time on top). These numbers cannot by themselves prove or disprove a browser-observed "<50ms" perceived-latency target — they can only prove whether the **backend** is fast enough to make that target achievable, and surface any backend-side regression. A full verdict on the BRD's UI-perceived-latency targets requires browser-based measurement (DevTools Performance panel or a real HTTP load tool) as a follow-up, which was not in scope for this pass.

All numbers below are **real, measured values from an actual run on this development machine**, not estimates. Per the brief's instruction, nothing is marked as passing a target it did not actually meet.

---

## 1. Step toggle response (target: < 50ms)

| Endpoint | Median | p95 | n | vs. 50ms target |
|---|---|---|---|---|
| `POST /execution-steps/{id}/open` | 53.79ms | 56.40ms | 10 | **Marginally over** |
| `POST /execution-steps/{id}/verdict` | 73.73ms | 79.93ms | 10 | **Over** |

**Finding:** both endpoints exceed the 50ms target as measured server-side (ORM query + hash-chained audit-log write + response serialization, no network). The `/verdict` endpoint is slower than `/open` because it does more work per call — it recomputes and persists the parent run-case's rollup status under a `SELECT...FOR UPDATE` row lock (the fix for GAP-49's concurrency bug) in addition to writing the step verdict and an audit event. This is a genuine, measured result, not a methodology artifact — the timed region was specifically isolated to contain only the single `POST` call per iteration, with all run/case/step setup performed before the clock starts.

**Context:** the BRD's "<50ms" target almost certainly describes *perceived UI latency* for a toggle interaction, which this application's architecture is designed to satisfy via **optimistic UI updates** on the frontend (per `docs/ARCHITECTURE_DECISIONS.md`'s offline-first design intent) — the user sees an instant visual toggle while the ~54–74ms server round-trip happens in the background and reconciles if it fails. This measurement validates the server-side component only; it does not by itself confirm or deny whether the end-to-end perceived latency target is met, since that depends on frontend behavior not exercised by this backend-only test.

## 2. Search/filter response (target: < 100ms)

Seeded dataset: 30 projects, 150 test cases on one project.

| Endpoint | Median | p95 | n | vs. 100ms target |
|---|---|---|---|---|
| `GET /projects?search=...` | 63.92ms | 75.90ms | 10 | **Within target** |
| `GET /projects/{id}/test-cases?search=&priority=` | 162.21ms | 188.22ms | 10 | **Over target** |
| `GET /audit-logs?action=...` | 43.07ms | 50.00ms | 10 | **Within target** |

**Finding:** the test-case search+filter endpoint (combined text search with a priority filter, against 150 rows) is the one search/filter endpoint that measurably exceeds the 100ms target. This is worth investigating — likely candidates are a missing index on the search/filter combination or the query plan for the combined `ILIKE` + equality filter; this report does not diagnose root cause further, as that would require `EXPLAIN ANALYZE` against the query, which was out of scope for this testing-only pass.

## 3. CSV import up to 2,000 rows

**Two different measurements exist in this codebase, intentionally:**

- **Service-layer-only** (pre-existing, `test_csv_import.py::test_bulk_import_2000_rows_under_2_5_seconds`): bypasses `TestClient`'s ASGI-bridge overhead entirely by calling `csv_import_service.import_test_cases` directly against a DB session. Budget: **2.5 seconds**.
- **Real HTTP round trip** (new, `test_performance.py::test_csv_import_2000_rows_http_round_trip_timing`): goes through the actual `POST /test-cases/import` endpoint via `TestClient`, including the ASGI bridge, multipart file upload parsing, and the full FastAPI dependency chain. Measured: **2.775 seconds** (single clean run).

**Important finding — the pre-existing 2.5s service-layer budget is not reliably met on this development machine.** Re-running `test_bulk_import_2000_rows_under_2_5_seconds` four times in direct isolation (no other process touching the test database) produced: **2.70s (FAIL), 3.17s (FAIL), 2.59s (FAIL), <2.5s (PASS)**. This is genuine measured variance, not test flakiness in the sense of a bug in the test itself — the underlying import operation's wall-clock time on this machine hovers right at, and frequently above, the 2.5-second budget. This had previously been dismissed as "confirmed flaky, passes cleanly in isolation" in an earlier module's documentation (`docs/IMPLEMENTATION_STATUS.md`, Test Case Management hardening pass) — **that characterization no longer holds under this engagement's repeated isolated measurement; 3 of 4 isolated runs failed the budget.** This is reported as a real, current NFR risk, not explained away.

**Possible contributing factors** (not confirmed, noted for a follow-up investigation): this development machine runs the application's own Docker stack (db/api/web containers) concurrently with the test suite against the same physical Postgres server (shared CPU/memory), which could plausibly slow down a CPU/IO-bound bulk-insert benchmark; the budget may also simply need re-baselining against this hardware, or the import path may have accumulated overhead (e.g. per-row audit event writes, duplicate-detection lookups) since the 2.5s figure was originally set. No fix was attempted in this pass — performance tuning is out of this testing-only engagement's scope — but this is flagged as the most actionable finding in this report.

## 4. Dashboard aggregation performance under realistic volume

Seeded dataset: 200 approved test cases, a run against 50 of them (20 fully executed with pass verdicts), 30 defects.

| Endpoint | Median | p95 | n |
|---|---|---|---|
| `GET /dashboard/summary` | 49.44ms | 54.14ms | 10 |
| `GET /dashboard/domain-distribution` | 55.49ms | 58.79ms | 10 |
| `GET /reports/aggregate?metric=priority&group_by=project` | 36.58ms | 43.49ms | 10 |

**Finding: all three comfortably under 60ms** at this data volume. No BRD-stated explicit target exists for dashboard aggregation specifically (the brief says "validate dashboard aggregation performance" without a number), so these are reported as a baseline, not a pass/fail against a stated figure. 200 test cases / 50 run-cases / 30 defects is a realistic single-project volume for this application's target market (mid-size insurance test teams); a much larger tenant-wide volume (thousands of test cases across many projects) was not measured in this pass.

## 5. Concurrent usage

20 concurrent `GET /dashboard/summary` requests via `ThreadPoolExecutor` (20 threads, each with its own `TestClient` sharing the authenticated session's cookies):

**Result: 0.742s total wall-clock, 27.0 req/s, 20/20 succeeded with no errors or data corruption.**

**Scope limitation, stated explicitly:** this is Python threads driving the same in-process ASGI app, not real concurrent network connections through a production ASGI server (Uvicorn/Gunicorn with multiple workers) under real load. It demonstrates **correctness under concurrent access** (no crashes, no corrupted responses, no deadlocks) and a coarse throughput signal, not a production-representative load test. A genuine load test would require a real HTTP server process and an external load generator (e.g. k6), which the user explicitly chose not to add for this pass.

---

## Summary

| BRD target | Measured | Verdict |
|---|---|---|
| Step toggle < 50ms | open: 53.79ms median / verdict: 73.73ms median | **Over target** (server-side only; see §1 caveat on optimistic UI) |
| Search/filter < 100ms | 43–64ms on 2 of 3 endpoints; **162ms on test-case search+filter** | **Mostly within target, one exceedance** |
| CSV import 2,000 rows | 2.59–3.17s across repeated isolated runs vs. 2.5s budget; 3/4 runs failed | **Marginal / frequently over budget on this machine** |
| Dashboard aggregation at volume | 37–55ms at 200 cases / 50 run-cases / 30 defects | **No stated target; comfortably fast at this volume** |
| Realistic concurrent usage | 20 concurrent requests, 27 req/s, 0 errors | **Correct, but not a production-representative load test** |

**Per the brief's instruction to report actual results only: this pass did not achieve a clean pass on 2 of the 4 named BRD performance targets (step toggle, CSV import) as measured, and found one previously-undocumented search/filter latency exceedance.** None of these are attributed to this session's own changes — they reflect genuine, newly-measured backend behavior that had not previously been validated against real timing (the audit confirmed zero performance/load tests existed anywhere in the codebase before this pass). These are reported as outstanding risks for follow-up investigation and tuning, not fixed in this testing-only engagement.
