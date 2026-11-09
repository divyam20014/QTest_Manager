# API Specification — Planning-Phase Inventory

Scope note: this is the endpoint inventory agreed at planning time to validate module boundaries and the DB schema against real access patterns. Exact request/response bodies are finalized per-phase (in step with Pydantic schemas) and reflected here as each module is implemented — this file is a living document, not a frozen contract.

## Conventions
- Base path: `/api/v1`.
- Auth: HTTP-only session cookie, set by `/auth/login` after MFA verification.
- Response envelope: `{ "data": ..., "error": null }` on success, `{ "data": null, "error": { "code": "...", "message": "..." } }` on failure. No fake/mocked success responses (engineering principle).
- All list endpoints are tenant-scoped automatically via session context; `tenant_id` is never a request parameter.
- Pagination: `?page=&page_size=` on all list endpoints, `{ "items": [...], "total": N }` under `data`.

## Platform Administration (no tenant context)
| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | /platform/tenants | Create tenant + first Admin user (ADR-008) | platform_owner |
| GET | /platform/tenants | List tenants | platform_owner |
| PATCH | /platform/tenants/{id}/status | approve/suspend tenant | platform_owner |

## Authentication (FR-AUTH)
| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | /auth/login | tenant_id+email+password → MFA challenge issued (ADR-017); rate-limited 10/min per client IP (ADR-030, GAP-16) | any |
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
| POST | /users/{id}/gdpr-erase | pseudonymize PII (ADR-009) | admin |

## Project Management (FR-PROJ)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects | list (scoped to assigned for Tester) | all |
| POST | /projects | create | admin, manager |
| GET | /projects/{id} | detail | assigned/all per role |
| PATCH | /projects/{id} | update | admin, manager (assigned) |
| DELETE | /projects/{id} | delete (blocked if active runs exist) | admin, manager (assigned) |
| POST | /projects/{id}/members | assign user | admin, manager |
| DELETE | /projects/{id}/members/{userId} | unassign | admin, manager |

## Test Case Management & Versioning (FR-TC)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-cases | list | all (assigned) |
| POST | /projects/{id}/test-cases | create (status=draft, version 1) | all (assigned) |
| GET | /test-cases/{id} | detail incl. current version+steps | all (assigned) |
| GET | /test-cases/{id}/versions | version history (ADR-003) | all (assigned) |
| PATCH | /test-cases/{id} | edit → creates new version if approved | all (assigned, own drafts for tester delete rule) |
| POST | /test-cases/{id}/submit-review | draft → ready_for_review | tester/manager/admin |
| POST | /test-cases/{id}/approve | → approved | manager, admin |
| DELETE | /test-cases/{id} | delete (tester: own drafts only) | role-gated per matrix |
| GET | /test-cases/{id}/attachments | list attachments (ADR-012, GAP-15) | all (assigned) |
| POST | /test-cases/{id}/attachments | upload (multipart, 10MB cap) | testcase.edit (admin/manager/tester) |
| GET | /attachments/{id}/download | download file bytes | all (assigned to the owning test case's project) |
| DELETE | /attachments/{id} | delete | testcase.edit (admin/manager/tester) |

## CSV Import/Export (FR-TC-002, ADR-021)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-cases/export.csv | export one project's test cases | all (assigned) |
| GET | /test-cases/import/template.csv | sample template | all |
| POST | /test-cases/import | tenant-wide, synchronous validate+commit; each row names its own project (ADR-021) | all (per-row: Admin/Manager tenant-wide, Tester must be assigned to that row's project) |

## Test Execution (FR-EXEC)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-runs | list runs for a project (lightweight summary, no per-case rollups) | all (assigned) |
| POST | /projects/{id}/test-runs | create run, bundle cases (pins versions) | all (assigned) |
| GET | /test-runs/{id} | run detail + case rollups | all (assigned) |
| POST | /test-runs/{id}/finish | set finished_at, lock | manager, admin |
| GET | /test-run-cases/{id}/steps | step list + current verdicts/timings | all (assigned) |
| POST | /execution-steps/{id}/open | mark step opened (starts timer) | all (assigned) |
| POST | /execution-steps/{id}/verdict | pass\|fail\|ignore, closes timer, computes duration_ms | all (assigned) |

## Defect Management (FR-DEF)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /defects | filter by project/status/severity | all (scoped) |
| POST | /defects | create (standalone or from execution_steps.id) | all |
| GET | /defects/{id} | detail incl. links + traceability chain | all (scoped) |
| PATCH | /defects/{id}/status | state machine transition | role-gated (tester cannot close) |
| POST | /defects/{id}/links | add defect_link | all |

## Reporting & Dashboard (FR-REP, FR-DASH)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /dashboard/summary | KPI cards | all (scoped) |
| GET | /dashboard/domain-distribution | FR-DASH-002 chart data | all (scoped) |
| GET | /dashboard/activity-stream | last 10 actions | all (scoped) |
| GET | /reports/aggregate | multi-axis pivot (metric, groupBy) | manager, admin (restricted for tester) |
| GET | /reports/compliance-export | PDF/CSV compliance summary | manager, admin |

## Administration & Audit (FR-ADM-002)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /audit-logs | filterable (action, entity_type, user_id), paginated (max 200/page), read-only (ADR-029) | admin (`audit.view`) |
| GET | /audit-logs/verify-chain | re-walks and recomputes the full hash chain server-side; returns valid/checked_count/broken_at_id (ADR-029) | admin (`audit.view`) |
| GET | /settings | tenant config (currency, timezone, MFA mode) | admin |
| PATCH | /settings | update tenant config | admin |
