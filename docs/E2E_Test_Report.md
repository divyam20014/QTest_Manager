# End-to-End Test Report — QTestHub

**Engagement:** Principal QA Architect end-to-end testing pass.
**Scope:** 14 named functional areas, reliability testing (browser refresh, network interruption, backend/DB restart, duplicate requests, concurrent updates, transaction rollback), and full regression of all automated tests.
**Methodology:** backend automated tests (`pytest` against the real ASGI app + a real Postgres test database with RLS), frontend automated tests (`vitest`), and browser-driven end-to-end tests (`Playwright`, against the real Docker Compose stack — db/api/web containers, real browser, real HTTP).

---

## 1. Functional area coverage (14 areas)

| # | Area | Status | Backend tests | Frontend/E2E |
|---|---|---|---|---|
| 1 | Authentication | Strong | 9 (`test_auth_flow.py`) + 6 (`test_auth_hardening.py`) + 1 (`test_rate_limiting.py`) | covered incidentally in journey specs |
| 2 | MFA | Adequate | 2 dedicated + exercised in nearly every auth test via `_login_and_verify` helper | same |
| 3 | Tenant isolation | Strong | 3 (`test_rls_isolation.py`, incl. DB-layer RLS) + 1 | — |
| 4 | RBAC | Adequate (scattered) | ~15–18 role-boundary tests across modules + 56 new systematic route-sweep cases (`test_security_hardening.py`) | 2 (Tester-forbidden checks in journey specs) |
| 5 | Project management | Strong | 15 (`test_projects.py`) | 2 (`journey1-project-management.spec.ts`) |
| 6 | Test case authoring | Strong | 16 (`test_test_cases.py`) | 1 (`journey2-testcase-authoring.spec.ts`) |
| 7 | Versioning | Adequate | 4 (within `test_test_cases.py`) | covered in journey2 (fork-on-edit) |
| 8 | CSV import/export | Strong | 17 (`test_csv_import.py`) + 1 new HTTP-timing test | — |
| 9 | Test execution | Strong | 20 (`test_execution.py`) | 1 (`journey3-test-execution.spec.ts`) + 1 new (`reliability.spec.ts`) |
| 10 | Step timing | Adequate | 2 (correctness of duration calculation, not endpoint latency — see `Performance_Test_Report.md` for timing) | — |
| 11 | Defect management | Strong | 17 (`test_defects.py`) | 2 (`journey4-defect-lifecycle.spec.ts`) |
| 12 | Traceability | Adequate (cross-cutting) | covered inside `test_defects.py`/`test_execution.py` (e.g. `test_defect_from_failed_step_auto_derives_traceability`) | — |
| 13 | Reporting | Strong | 17 (`test_reporting.py`) | — |
| 14 | Audit logging | Strong | 8 (`test_audit_api.py`) + 3 (`test_audit_integrity.py`, incl. real DB-level DELETE-rejection test) | — |

**13 of 14 areas have substantial, direct automated coverage.** RBAC and Traceability are covered but distributed opportunistically across feature-module test files rather than as a single dedicated suite — the new 56-route systematic sweep (§3 below) closes most of the practical gap for RBAC; Traceability's underlying links are each individually tested but no single test asserts the full case→run→step→defect chain in one assertion.

## 2. Security testing — see `Security_Test_Report.md`

Full detail in the dedicated report. Summary: 73 new tests, all pass. One confirmed finding (file upload content-sniffing gap, documented not fixed). No SQL injection surface, no privilege escalation, no IDOR, no unauthorized-access gap found.

## 3. Performance testing — see `Performance_Test_Report.md`

Full detail in the dedicated report. Summary: 5 new tests, all pass as tests (i.e. none crashed or errored), but **2 of 4 BRD performance targets were not met as measured** (step-toggle endpoints run 54–74ms server-side vs. a 50ms target; the CSV 2,000-row import budget of 2.5s failed in 3 of 4 isolated re-runs on this development machine, ranging 2.59–3.17s). One previously-undocumented search/filter latency exceedance found (test-case search+filter at 162ms vs. 100ms target). Reported honestly per the brief's instruction — not retroactively excused.

## 4. Reliability testing

**New file:** `backend/tests/test_reliability.py` (4 tests, all pass) + `frontend/e2e/reliability.spec.ts` (1 test, passes against the real Docker stack).

| Area | Status | Evidence |
|---|---|---|
| Browser refresh during execution | **PASS, live-verified** | `reliability.spec.ts`: opens a step (server-side timer starts), reloads the browser mid-execution, confirms the Execution Console fully rehydrates from the server — same step still current, step-completion count correct, elapsed timer resumed from the server's original `opened_at` (not reset to 0), and execution continues successfully post-reload. |
| Network interruption handling | **UNTESTED / NOT IMPLEMENTED** | Confirmed by reading `frontend/src/api/client.ts`: no retry logic, no offline queue, no `navigator.onLine` handling exists anywhere in the frontend. A failed fetch surfaces as a plain API error to the user. Building retry/offline-queue infrastructure is new application behavior, out of scope for this testing-only pass — documented honestly as a gap, not built. |
| Backend restart resilience | **UNTESTED** | Cannot be meaningfully exercised inside `pytest` against the in-process `TestClient` — there is no real process to restart. Would require infrastructure-level chaos testing against the real Docker `api` container (e.g. `docker restart` mid-request), which was not performed in this pass. Explicitly flagged as untested rather than assumed safe, per the brief's instruction. |
| Database restart resilience | **UNTESTED** | Same reasoning as above, against the `db` container. Not performed. |
| Duplicate request handling (idempotency) | **FINDING, documented** | `test_duplicate_defect_submission_creates_two_records`: double-submitting an identical `POST /defects` payload creates **two separate records**. No idempotency-key mechanism exists anywhere in the codebase (`defect_service.py`, `project_service.py` reviewed directly). This is the actual, current behavior — not fixed in this pass (building an idempotency-key system is new application infrastructure, out of scope). The one place genuine idempotency already exists — `POST /execution-steps/{id}/open` returning the same `opened_at` on repeat — was already tested pre-existing (`test_opening_a_step_twice_does_not_reset_the_timer`), not duplicated here. |
| Concurrent update handling | **PASS + 1 new FINDING** | Two pre-existing, well-tested row-lock fixes for *aggregate recomputation* races (MFA attempt-count, run-case status rollup — GAP-17/GAP-49). This pass added `test_concurrent_project_updates_last_write_wins_and_silently_drops_the_other` (two concurrent `PATCH /projects/{id}` touching *different* fields — both survive correctly, no corruption) and `test_concurrent_same_field_project_update_is_a_lost_update` (two concurrent `PATCH`es touching the *same* field — **confirmed silent lost update**: no `SELECT...FOR UPDATE`, no optimistic-concurrency version check, no 409 conflict response; the loser's write is silently discarded with no error surfaced to either caller, though the final stored value is always one of the two submitted values, never corrupted data). This is a genuinely new finding, distinct from the two previously-fixed races (which both guard a server-recomputed aggregate, not a plain field edit) — not fixed in this pass, see Outstanding Risks below. |
| Transaction rollback / atomicity | **PASS, documents real design** | `test_csv_import_commits_valid_rows_even_when_other_rows_in_the_same_batch_fail`: confirmed via direct code read of `csv_import_service.py` and a live test — CSV import is **not** an atomic single-transaction batch; per-row validation happens first, so a batch with some invalid rows still correctly persists every valid row while rejecting only the bad ones. This is intentional, sensible design (no silent all-or-nothing failure hiding partial success from the user), confirmed rather than assumed. |

**Operational note, not a code defect:** while running the reliability and performance test suites in parallel during this engagement, both encountered `OperationalError`/dropped-connection errors caused by `backend/tests/conftest.py`'s session-scoped fixture dropping/recreating the shared `qtesthub_test` database — this collides when multiple `pytest` processes run concurrently against it, since there is no per-worker database isolation (e.g. for `pytest-xdist`). All numbers in this and the performance report come from clean, isolated re-runs after confirming no concurrent pytest process was active. This is a **test-infrastructure limitation worth fixing** if this suite is ever run with real test-level parallelism, not an application defect.

## 5. Regression — full suite results

Run after all new tests were added, in isolation (no concurrent pytest processes):

**Backend: `pytest -q` → 223 total tests collected (141 pre-existing + 73 new security + 4 new reliability + 5 new performance).**
- One failure on a full-suite run: `test_csv_import.py::test_bulk_import_2000_rows_under_2_5_seconds` — confirmed via 4 isolated re-runs to be a genuine, marginal NFR miss on this development machine (2.59s, 3.17s, 2.59s, and one pass under 2.5s), **not** a regression caused by any change in this pass (no application code was modified during this engagement — only new test files were added). Full detail and analysis in `Performance_Test_Report.md` §3.
- `ruff check app tests`: clean. `mypy app`: clean (`Success: no issues found in 60 source files`).

**Frontend:**
- `vitest run`: 1/1 passing.
- `npm run typecheck`: clean.
- `npm run lint` (oxlint): clean, 3 pre-existing benign warnings unrelated to this pass (`react-hooks(exhaustive-deps)` in `ExecutionConsole.tsx`, `react(only-export-components)` in `auth.tsx`/`button.tsx`) — unchanged from before this engagement.
- `npm run build`: succeeds.
- **Playwright E2E, against the real Docker stack: 10/10 passing** (9 pre-existing journeys/smoke/accessibility specs + 1 new `reliability.spec.ts`).

## Summary

No application code (`backend/app/`, `frontend/src/`) was modified during this engagement — this was a testing-only pass, as instructed. 82 new automated tests were added (73 security + 4 reliability + 5 performance) across 3 new backend test files and 1 new Playwright spec, all passing in isolation. Full regression confirms no change introduced a new failure; the one failing test in a full-suite run (`test_bulk_import_2000_rows_under_2_5_seconds`) is a pre-existing test whose budget this engagement's own repeated isolated measurement now shows is genuinely marginal on this machine — reported honestly rather than dismissed, per the brief's explicit instruction.
