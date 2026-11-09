# Requirement Traceability Matrix (RTM)

Status values: `Not Started`, `In Progress`, `Implemented (unverified)`, `Done (tested end-to-end)`. A row is only `Done` when UI + backend + DB persistence + RBAC + tenant isolation + automated tests all pass (per completion criteria) — never marked complete merely because UI exists.

| BR ID | Requirement | FR Spec | Backend Module | Frontend Module | DB Entity | API Endpoint | Test Coverage | Status |
|---|---|---|---|---|---|---|---|---|
| BR-01 | Multi-tenant logical isolation | FR-AUTH-001 | Authentication, core/tenancy | App shell | tenants, RLS on all tenant tables | all (session-derived tenant) | `test_cross_tenant_isolation_on_user_list` (real Postgres, real RLS) | Done (backend; no frontend yet) |
| BR-02 | Role-Based Access Control | FR-AUTH-002 | User Management, core/auth | Auth, route guards | users, roles, permissions | /auth/*, /users | `test_full_bootstrap_login_and_me`, `test_wrong_password_is_generic_error`, `test_mfa_lockout_after_three_attempts` | Done (backend; no frontend yet) |
| BR-03 | Portfolio domain breakdown | FR-DASH-002 | Dashboard | Dashboard.tsx | projects, test_cases | /dashboard/domain-distribution | domain chart calc test | Not Started |
| BR-04 | Insurance project budget & dates | FR-PROJ-001 | Project Management | Projects.tsx | projects | /projects | form validation + timeline test | Not Started |
| BR-05 | Step-by-step test case authoring | FR-TC-001 | Test Case Mgmt, Versioning | TestCases.tsx | test_cases, test_case_versions, test_case_version_steps | /test-cases | step CRUD + versioning test | Not Started |
| BR-06 | CSV bulk import with step parsing | FR-TC-002 | CSV Import/Export | TestCases.tsx (import modal) | test_cases, test_case_versions | /projects/{id}/test-cases/import | parser stress test (2,000 rows) | Not Started |
| BR-07 | Two-tier test case approval | FR-TC-003 | Test Case Mgmt | TestCases.tsx | test_cases.status | /test-cases/{id}/approve | RBAC approval gating test | Not Started |
| BR-08 | Interactive run execution runtime | FR-EXEC-001 | Test Execution | TestRuns.tsx | test_runs, test_run_cases | /projects/{id}/test-runs | run state machine test | Not Started |
| BR-09 | Execution timing instrumentation | FR-EXEC-002 | Test Execution | TestRuns.tsx (console) | execution_steps.duration_ms | /execution-steps/{id}/open, /verdict | millisecond timer recording test | Not Started |
| BR-10 | In-run atomic step-defect linking | FR-EXEC-003 | Test Execution, Defect Mgmt | TestRuns.tsx, Defects.tsx | execution_steps, defects, defect_links | POST /defects (from execution_steps.id) | step-defect sync test | Not Started |
| BR-11 | Defect lifecycle tracking | FR-DEF-001 | Defect Management | Defects.tsx | defects | /defects/{id}/status | state transition validation test | Not Started |
| BR-12 | Multi-axis BI charts & export | FR-REP-001 | Reporting | Reporting.tsx | cross-module read | /reports/aggregate | pivot aggregation test | Not Started |
| BR-13 | Immutable compliance audit logging | FR-ADM-002 | Audit Management | Admin.tsx | audit_logs | /audit-logs | hash chain written on every auth/user mutation in `test_auth_flow.py`; insert-only grant verified live in Phase 1 | Partial (write path done; no `/audit-logs` read endpoint or UI yet) |

## Planning-phase-only items (not in original BR list, added by architecture review)
| ID | Requirement | ADR | Status |
|---|---|---|---|
| BR-14 | Platform tenant bootstrap (first admin provisioning) | ADR-008 | Done |
| BR-15 | Test case version pinning on execution | ADR-003 | Not Started |
| BR-16 | GDPR pseudonymization flow | ADR-009 | Done |
| BR-17 | MFA challenge lifecycle (real/simulated) | ADR-011 | Done |
| BR-18 | Attachment storage (filesystem + metadata) | ADR-012 | Not Started |
| BR-19 | Login requires explicit tenant_id (email is tenant-scoped, not global) | ADR-017 | Done |

## Current overall status
Phase 0: architecture, schema, module boundaries, and ambiguity resolution — **Done**.
Phase 1: repo scaffolding (Docker Compose, FastAPI/Alembic skeleton, Vite skeleton) — **Done**.
Phase 2: Platform Administration + Authentication + User Management — **Done** (backend only; no frontend screens yet — those land when the Test Management UI work begins, per the phase plan in `IMPLEMENTATION_STATUS.md`).
All other BR rows are `Not Started` until their corresponding phase begins.
