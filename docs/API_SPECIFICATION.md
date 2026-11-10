# API Specification — Planning-Phase Inventory

Scope note: this is the endpoint inventory agreed at planning time to validate module boundaries and the DB schema against real access patterns. Exact request/response bodies are finalized per-phase (in step with Pydantic schemas) and reflected here as each module is implemented — this file is a living document, not a frozen contract.

## Conventions
- Base path: `/api/v1`.
- Auth: HTTP-only session cookie, set by `/auth/login` after MFA verification.
- Response envelope: `{ "data": ..., "error": null }` on success, `{ "data": null, "error": { "code": "...", "message": "..." } }` on failure. No fake/mocked success responses (engineering principle).
- All list endpoints are tenant-scoped automatically via session context; `tenant_id` is never a request parameter.
- Pagination: `?page=&page_size=` on all list endpoints, `{ "items": [...], "total": N }` under `data`.

## Operational endpoints (no auth, no tenant context)
| Method | Path | Purpose |
|---|---|---|
| GET | /health | Liveness only — always returns `{"status":"ok"}` if the process is up. |
| GET | /ready | Readiness — does a real `SELECT 1` against the database; 503 if unreachable (SAAS-GAP-16). Used by the `api` service's Docker healthcheck. |

## Platform Administration (no tenant context)
| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | /platform/tenants | Create tenant + first Admin user (ADR-008) | platform_owner |
| GET | /platform/tenants | List tenants | platform_owner |
| PATCH | /platform/tenants/{id}/status | approve/suspend tenant | platform_owner |

## Authentication (FR-AUTH)
| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | /auth/login | tenant_id+email+password → MFA challenge issued (ADR-017); rate-limited 10/min per client IP (ADR-030, GAP-16); rejects non-`approved` tenants with 403 (ADR-032) | any |
| POST | /auth/mfa/verify | 6-digit code → session cookie issued; rate-limited 10/min per client IP (ADR-030) | any (interim handshake) |
| POST | /auth/logout | revoke session | authenticated |
| GET | /auth/me | current user/role/tenant | authenticated |

## User Management (FR-ADM-001)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /users | list tenant users | admin, manager (ADR-028) |
| POST | /users | provision user | admin |
| PATCH | /users/{id} | edit profile/role | admin |
| DELETE | /users/{id} | deactivate (blocked if last admin) | admin |
| POST | /users/{id}/reset-password | admin-initiated password reset; revokes all of that user's existing sessions (ADR-032) | admin |
| POST | /users/{id}/gdpr-erase | pseudonymize PII (ADR-009) | admin |
| GET | /users/me/history | self-service account history (creation, profile/role edits, password resets, own login/MFA events) (ADR-039) | all (scoped to caller's own account) |

## Project Management (FR-PROJ)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects | list (scoped to assigned for Tester); supports `search`/`domain`/`status`/`priority`/`sort`/`page`/`page_size`, returns `{items, total}` incl. per-project metrics (ADR-033) | all |
| POST | /projects | create; accepts optional `Idempotency-Key` header to dedupe a retried/duplicated request (ADR-040) | admin, manager |
| GET | /projects/{id} | detail | assigned/all per role |
| PATCH | /projects/{id} | update; response includes `version` (incremented per update); optional `expected_version` in the request body enables opt-in optimistic-concurrency (409 on a stale version, ADR-040) | admin, manager (assigned) |
| DELETE | /projects/{id} | delete (blocked if active runs exist) | admin, manager (assigned) |
| POST | /projects/{id}/members | assign user | admin, manager |
| DELETE | /projects/{id}/members/{userId} | unassign | admin, manager |

## Test Case Management & Versioning (FR-TC)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-cases | list; supports `search`/`priority`/`status`/`assignee_id`/`sort`/`page`/`page_size`, returns `{items, total}` (ADR-034) | all (assigned) |
| POST | /projects/{id}/test-cases | create (status=draft, version 1); accepts optional `Idempotency-Key` header (ADR-040) | all (assigned) |
| GET | /test-cases/{id} | detail incl. current version+steps | all (assigned) |
| GET | /test-cases/{id}/versions | version history (ADR-003) | all (assigned) |
| GET | /test-cases/{id}/versions/compare?from=&to= | per-step + title/description diff between two versions (ADR-034) | all (assigned) |
| PATCH | /test-cases/{id} | edit → creates new version if approved | all (assigned, own drafts for tester delete rule) |
| POST | /test-cases/{id}/submit-review | draft → ready_for_review | tester/manager/admin |
| POST | /test-cases/{id}/approve | → approved | manager, admin |
| POST | /test-cases/{id}/deprecate | → deprecated (terminal; ADR-034) | manager, admin |
| DELETE | /test-cases/{id} | delete (tester: own drafts only) | role-gated per matrix |
| GET | /test-cases/{id}/attachments | list attachments (ADR-012, GAP-15) | all (assigned) |
| POST | /test-cases/{id}/attachments | upload (multipart, 10MB cap, file-type allowlist per ADR-034, plus magic-byte/content-signature validation per ADR-040) | testcase.edit (admin/manager/tester) |
| GET | /attachments/{id}/download | download file bytes | all (assigned to the owning test case's project) |
| DELETE | /attachments/{id} | delete | testcase.edit (admin/manager/tester) |

## CSV Import/Export (FR-TC-002, ADR-021)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-cases/export.csv | export one project's test cases | all (assigned) |
| GET | /test-cases/import/template.csv | sample template | all |
| POST | /test-cases/import | tenant-wide, synchronous validate+commit; each row names its own project (ADR-021); enforces a 2,000-row cap, 5MB/`.csv`-only file validation, and per-project duplicate-title detection (ADR-035) | all (per-row: Admin/Manager tenant-wide, Tester must be assigned to that row's project) |

## Test Execution (FR-EXEC)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-runs | list runs for a project (lightweight summary, no per-case rollups) | all (assigned) |
| POST | /projects/{id}/test-runs | create run, bundle cases (pins versions) | all (assigned) |
| GET | /test-runs/{id} | run detail + case rollups | all (assigned) |
| PATCH | /test-runs/{id} | edit name/run_type; blocked once execution has started or run is finished (ADR-036) | all (assigned) |
| POST | /test-runs/{id}/cases | add approved test cases to an existing, unfinished run (ADR-036) | all (assigned) |
| DELETE | /test-runs/{id}/cases/{id} | remove a case; blocked if any of its steps are already opened (ADR-036) | all (assigned) |
| PATCH | /test-run-cases/{id}/assign | assign execution responsibility (ADR-036) | all (assigned) |
| POST | /test-runs/{id}/pause | pause a run; blocks further step open/verdict until resumed (ADR-036) | manager, admin |
| POST | /test-runs/{id}/resume | resume a paused run (ADR-036) | manager, admin |
| POST | /test-runs/{id}/finish | set finished_at, lock | manager, admin |
| GET | /test-run-cases/{id}/context | run/project/case display context for the Execution Console (ADR-036) | all (assigned) |
| GET | /test-run-cases/{id}/steps | step list + current verdicts/timings | all (assigned) |
| POST | /execution-steps/{id}/open | mark step opened (starts timer); idempotent, rejects if run finished/paused | all (assigned) |
| POST | /execution-steps/{id}/verdict | pass\|fail\|ignore, closes timer, computes duration_ms; row-locked against concurrent sibling-step verdicts (ADR-036) | all (assigned) |

## Defect Management (FR-DEF)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /defects | filter by project/status/severity/test_run_id/test_case_id/reported_by/created_from/created_to (ADR-037) | all (scoped) |
| POST | /defects | create (standalone, in-run, or from execution_steps.id); accepts optional `Idempotency-Key` header (ADR-040) | all |
| GET | /defects/{id} | detail incl. links, execution evidence, test case version + traceability chain (ADR-037) | all (scoped) |
| GET | /defects/{id}/history | status-change/creation history from audit_logs (ADR-037) | all (scoped) |
| PATCH | /defects/{id}/status | state machine transition; Closed requires `verification_confirmed: true` (ADR-037) | role-gated (tester cannot close) |
| POST | /defects/{id}/links | add defect_link (incl. link-to-existing from a failed step, ADR-037) | all |

## Reporting & Dashboard (FR-REP, FR-DASH)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /dashboard/summary | KPI cards incl. active projects, approved test case count, critical defect count (ADR-038) | all (scoped) |
| GET | /dashboard/domain-distribution | FR-DASH-002 chart data, now incl. per-domain pass percentage (ADR-038) | all (scoped) |
| GET | /dashboard/activity-stream | last 10 actions | all (scoped) |
| GET | /reports/aggregate | multi-axis pivot (metric, groupBy); metric now incl. `test_case_status`; accepts `project_id`/`domain`/`assignee_id`/`date_from`/`date_to`/`priority`/`status` filters (ADR-038) | all (scoped; restricted for tester) |
| GET | /reports/execution-trend | daily pass/fail/ignore step-verdict counts over a trailing window (`days`, default 30), optional `project_id` (ADR-038) | all (scoped) |
| GET | /reports/compliance-detail | structured JSON compliance report (summary + per-project detailed test case/defect tables), optional `period_from`/`period_to` — backs the browser print/PDF view (ADR-038) | manager, admin |
| GET | /reports/compliance-export | CSV compliance summary, now incl. a Reporting Period header row and per-project detailed test case/defect tables, optional `period_from`/`period_to` (ADR-038) | manager, admin |

## Administration & Audit (FR-ADM-002)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /audit-logs | filterable (action, entity_type, entity_id, user_id, date_from, date_to), paginated (max 200/page), full record incl. metadata/prev_hash (ADR-029, ADR-039), read-only | admin (`audit.view`) |
| GET | /audit-logs/export | CSV export of the full (unpaginated, capped at 50k rows) filtered audit trail — same filters as the list endpoint (ADR-039) | admin (`audit.view`) |
| GET | /audit-logs/verify-chain | re-walks and recomputes the full hash chain server-side; returns valid/checked_count/broken_at_id (ADR-029) | admin (`audit.view`) |
| GET | /settings | tenant config (currency, timezone, MFA mode) | admin |
| PATCH | /settings | update tenant config | admin |
