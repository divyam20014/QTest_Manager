# Requirement Traceability Matrix (RTM)

Status values: `Not Started`, `In Progress`, `Implemented (unverified)`, `Done (tested end-to-end)`. A row is only `Done` when UI + backend + DB persistence + RBAC + tenant isolation + automated tests all pass (per completion criteria) — never marked complete merely because UI exists.

| BR ID | Requirement | FR Spec | Backend Module | Frontend Module | DB Entity | API Endpoint | Test Coverage | Status |
|---|---|---|---|---|---|---|---|---|
| BR-01 | Multi-tenant logical isolation | FR-AUTH-001 | Authentication, core/tenancy | App shell | tenants, RLS on all tenant tables | all (session-derived tenant) | `test_cross_tenant_isolation_on_user_list` (real Postgres, real RLS) | Done (backend; no frontend yet) |
| BR-02 | Role-Based Access Control | FR-AUTH-002 | User Management, core/auth | Auth, route guards | users, roles, permissions | /auth/*, /users | `test_full_bootstrap_login_and_me`, `test_wrong_password_is_generic_error`, `test_mfa_lockout_after_three_attempts` | Done (backend; no frontend yet) |
| BR-03 | Portfolio domain breakdown | FR-DASH-002 | Dashboard | Dashboard.tsx | projects, test_cases | /dashboard/domain-distribution | `test_domain_distribution_groups_by_domain` | Done (backend; no frontend yet) |
| BR-04 | Insurance project budget & dates | FR-PROJ-001 | Project Management | Projects.tsx | projects | /projects | `test_admin_creates_project_and_sees_default_currency`, `test_duplicate_project_name_case_insensitive_rejected`, `test_invalid_date_range_rejected` | Done (backend; no frontend yet) |
| BR-05 | Step-by-step test case authoring | FR-TC-001 | Test Case Mgmt, Versioning | TestCases.tsx | test_cases, test_case_versions, test_case_version_steps | /test-cases | `test_create_test_case_starts_as_draft_version_one`, `test_at_least_one_step_required`, `test_editing_approved_case_forks_version_and_reverts_to_draft` | Done (backend; no frontend yet) |
| BR-06 | CSV bulk import with step parsing | FR-TC-002 | CSV Import/Export | TestCases.tsx (import modal) | test_cases, test_case_versions | /test-cases/import (ADR-021, tenant-wide) | `test_valid_rows_import_successfully`, `test_invalid_rows_reported_without_blocking_valid_rows`, `test_bulk_import_2000_rows_under_2_5_seconds` | Done (backend; no frontend yet) |
| BR-07 | Two-tier test case approval | FR-TC-003 | Test Case Mgmt | TestCases.tsx | test_cases.status | /test-cases/{id}/approve | `test_full_approval_workflow`, `test_tester_cannot_approve`, `test_cannot_approve_from_draft_directly` | Done (backend; no frontend yet) |
| BR-08 | Interactive run execution runtime | FR-EXEC-001 | Test Execution | TestRuns.tsx | test_runs, test_run_cases | /projects/{id}/test-runs | `test_create_run_pins_version_and_pre_creates_steps`, `test_only_approved_cases_can_be_bundled` | Done (backend; no frontend yet) |
| BR-09 | Execution timing instrumentation | FR-EXEC-002 | Test Execution | TestRuns.tsx (console) | execution_steps.duration_ms | /execution-steps/{id}/open, /verdict | `test_marking_any_step_fail_flags_case_failed`, `test_verdict_without_explicit_open_still_works` | Done (backend; no frontend yet) |
| BR-10 | In-run atomic step-defect linking | FR-EXEC-003 | Test Execution, Defect Mgmt | TestRuns.tsx, Defects.tsx | execution_steps, defects, defect_links | POST /defects (from execution_steps.id) | `test_defect_from_failed_step_auto_derives_traceability` | Done (backend; no frontend yet) |
| BR-11 | Defect lifecycle tracking | FR-DEF-001 | Defect Management | Defects.tsx | defects | /defects/{id}/status | `test_status_transitions_are_strictly_sequential`, `test_tester_cannot_close_but_can_advance_earlier_states` | Done (backend; no frontend yet) |
| BR-12 | Multi-axis BI charts & export | FR-REP-001 | Reporting | Reporting.tsx | cross-module read | /reports/aggregate | `test_aggregate_report_by_project_and_domain`, `test_aggregate_report_by_assignee_unassigned_fallback` | Done (backend; no frontend yet) |
| BR-13 | Immutable compliance audit logging | FR-ADM-002 | Audit Management | Admin.tsx | audit_logs | /audit-logs | hash chain written on every auth/user mutation in `test_auth_flow.py`; insert-only grant verified live in Phase 1; now also surfaced read-only via `/dashboard/activity-stream` (`test_activity_stream_returns_recent_audit_events`) | Partial (write path + one read surface done; no dedicated `/audit-logs` admin screen/endpoint yet — Phase 9) |

## Planning-phase-only items (not in original BR list, added by architecture review)
| ID | Requirement | ADR | Status |
|---|---|---|---|
| BR-14 | Platform tenant bootstrap (first admin provisioning) | ADR-008 | Done |
| BR-15 | Test case version pinning on execution | ADR-003 | Done |
| BR-16 | GDPR pseudonymization flow | ADR-009 | Done |
| BR-17 | MFA challenge lifecycle (real/simulated) | ADR-011 | Done |
| BR-18 | Attachment storage (filesystem + metadata) | ADR-012 | Not Started |
| BR-19 | Login requires explicit tenant_id (email is tenant-scoped, not global) | ADR-017 | Done |
| BR-20 | Team member allocation to projects (FR-PROJ-002), with Manager authority scoped to assigned projects (ADR-018) | FR-PROJ-002 | Done |
| BR-21 | `testrun.finish` sign-off gate, Manager/Admin only (BRD matrix doesn't separately qualify run closure vs. creation) | ADR-022 | Done |
| BR-22 | Only `approved` test cases may be bundled into a test run | ADR-025 | Done |
| BR-23 | Multi-criteria defect filtering (project/status/severity), FR-DEF-002 | FR-DEF-002 | Done |
| BR-24 | Defect status transitions strictly sequential, no reopen-from-Closed | ADR-026 | Done |
| BR-25 | Real-time KPI dashboard cards (projects, test cases, runs, defects) | FR-DASH-001 | Done |
| BR-26 | Recent operational activity stream (last 10 audit events) | FR-DASH-003 | Done |
| BR-27 | CSV compliance export with tenant/timestamp/officer header | FR-REP-002 | Done |
| BR-28 | Reporting/Dashboard scope + metric definitions (Tester restriction, Status=run_status, Assignee=reported_by, PDF out of scope) | ADR-027 | Done |
| BR-29 | Full-system cross-tenant RLS isolation sweep, verified at both API and direct-SQL layers | BR-01 (extended) | Done |
| BR-30 | Audit hash-chain integrity verified against real multi-module data, not just unit-tested in isolation | BR-13 (extended) | Done |
| BR-31 | Backend security review (auth coverage, SQL injection surface, cookie flags, mass-assignment surface) | — | Done |

## Current overall status
Phase 0: architecture, schema, module boundaries, and ambiguity resolution — **Done**.
Phase 1: repo scaffolding (Docker Compose, FastAPI/Alembic skeleton, Vite skeleton) — **Done**.
Phase 2: Platform Administration + Authentication + User Management — **Done** (backend only; no frontend screens yet — those land when the Test Management UI work begins, per the phase plan in `IMPLEMENTATION_STATUS.md`).
Phase 3: Project Management — **Done** (backend only).
Phase 4: Test Case Management + Versioning + Approval workflow — **Done** (backend only).
Phase 5: CSV Bulk Import/Export — **Done** (backend only).
Phase 6: Test Execution Engine — **Done** (backend only).
Phase 7: Defect Management + step-level traceability — **Done** (backend only).
Phase 8: Dashboard + Reporting & Analytics + Compliance export — **Done** (backend only).
Phase 9: Audit log hardening, RLS verification, security review (backend scope) — **Done**.
Phase 10 (new, split from the original Phase 9 plan): Frontend UI, accessibility pass, Playwright E2E across all BRD §9 journeys — **Not Started**.
All other BR rows are `Not Started` until their corresponding phase begins.
