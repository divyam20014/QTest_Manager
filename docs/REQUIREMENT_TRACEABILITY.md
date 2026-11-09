# Requirement Traceability Matrix (RTM)

Status values: `Not Started`, `In Progress`, `Implemented (unverified)`, `Done (tested end-to-end)`. A row is only `Done` when UI + backend + DB persistence + RBAC + tenant isolation + automated tests all pass (per completion criteria) — never marked complete merely because UI exists.

| BR ID | Requirement | FR Spec | Backend Module | Frontend Module | DB Entity | API Endpoint | Test Coverage | Status |
|---|---|---|---|---|---|---|---|---|
| BR-01 | Multi-tenant logical isolation | FR-AUTH-001 | Authentication, core/tenancy | App shell | tenants, RLS on all tenant tables | all (session-derived tenant) | `test_cross_tenant_isolation_on_user_list` (real Postgres, real RLS) | Done (backend; no frontend yet) |
| BR-02 | Role-Based Access Control | FR-AUTH-002 | User Management, core/auth | Auth, route guards, UsersRoles.tsx | users, roles, permissions | /auth/*, /users | `test_full_bootstrap_login_and_me`, `test_wrong_password_is_generic_error`, `test_mfa_lockout_after_three_attempts`; Users & Roles admin screen (create/role-change/deactivate) driven live in a real browser (Phase 10.8) | Done |
| BR-03 | Portfolio domain breakdown | FR-DASH-002 | Dashboard | Dashboard.tsx | projects, test_cases | /dashboard/domain-distribution | `test_domain_distribution_groups_by_domain` | Done (backend; no frontend yet) |
| BR-04 | Insurance project budget & dates | FR-PROJ-001 | Project Management | ProjectsList.tsx, ProjectDetail.tsx | projects | /projects | `test_admin_creates_project_and_sees_default_currency`, `test_duplicate_project_name_case_insensitive_rejected`, `test_invalid_date_range_rejected`; frontend driven live in a real browser (Phase 10.2) | Done |
| BR-05 | Step-by-step test case authoring | FR-TC-001 | Test Case Mgmt, Versioning | TestCasesList.tsx, TestCaseDetail.tsx, TestCaseForm.tsx | test_cases, test_case_versions, test_case_version_steps | /test-cases | `test_create_test_case_starts_as_draft_version_one`, `test_at_least_one_step_required`, `test_editing_approved_case_forks_version_and_reverts_to_draft`; version-fork-to-v2 watched live in a real browser (Phase 10.3) | Done |
| BR-06 | CSV bulk import with step parsing | FR-TC-002 | CSV Import/Export | ImportDialog.tsx | test_cases, test_case_versions | /test-cases/import (ADR-021, tenant-wide) | `test_valid_rows_import_successfully`, `test_invalid_rows_reported_without_blocking_valid_rows`, `test_bulk_import_2000_rows_under_2_5_seconds`; full upload→report→list-refresh→export round-trip watched live in a real browser (Phase 10.4) | Done |
| BR-07 | Two-tier test case approval | FR-TC-003 | Test Case Mgmt | TestCaseDetail.tsx | test_cases.status | /test-cases/{id}/approve | `test_full_approval_workflow`, `test_tester_cannot_approve`, `test_cannot_approve_from_draft_directly`; submit→approve watched live in a real browser (Phase 10.3) | Done |
| BR-08 | Interactive run execution runtime | FR-EXEC-001 | Test Execution | TestRunsList.tsx, TestRunDetail.tsx | test_runs, test_run_cases | /projects/{id}/test-runs | `test_create_run_pins_version_and_pre_creates_steps`, `test_only_approved_cases_can_be_bundled`, `test_list_test_runs_for_project`; full run creation→execution→rollup watched live in a real browser (Phase 10.5) | Done |
| BR-09 | Execution timing instrumentation | FR-EXEC-002 | Test Execution | ExecutionConsole.tsx | execution_steps.duration_ms | /execution-steps/{id}/open, /verdict | `test_marking_any_step_fail_flags_case_failed`, `test_verdict_without_explicit_open_still_works`; real server-measured durations (127ms/74ms/94ms) observed in the UI (Phase 10.5); BRD Journey 4's re-verdict-after-fix flow had no UI control at all until Phase 10.9 found and fixed the gap (`journey4-defect-lifecycle.spec.ts`, ADR-024 addendum) | Done |
| BR-10 | In-run atomic step-defect linking | FR-EXEC-003 | Test Execution, Defect Mgmt | ExecutionConsole.tsx, DefectQuickCreateDialog.tsx | execution_steps, defects, defect_links | POST /defects (from execution_steps.id), GET /defects?test_run_id= | `test_defect_from_failed_step_auto_derives_traceability`, `test_filter_defects_by_test_run_id`; auto-opening defect dialog on Fail, the resulting defect's full traceability, and the Execution Console's "🐞 Defect reported" badge (closing GAP-20) all verified live in a real browser + confirmed via direct API call (Phase 10.6) | Done |
| BR-11 | Defect lifecycle tracking | FR-DEF-001 | Defect Management | DefectsList.tsx, DefectDetail.tsx | defects | /defects, /defects/{id}, /defects/{id}/status | `test_status_transitions_are_strictly_sequential`, `test_tester_cannot_close_but_can_advance_earlier_states`; full sequential walk New→Open→Fixed→Verified→Closed driven live in a real browser, final `Closed` status + `closed_at` confirmed via direct API call (Phase 10.6) | Done |
| BR-12 | Multi-axis BI charts & export | FR-REP-001 | Reporting | Reporting.tsx | cross-module read | /reports/aggregate, /dashboard/domain-distribution | `test_aggregate_report_by_project_and_domain`, `test_aggregate_report_by_assignee_unassigned_fallback`; domain-distribution bar chart and metric×group_by stacked-bar report, with a real approved-percentage display bug (10000% caused by double-applying a percentage already 0–100) caught and fixed via live browser verification (Phase 10.7) | Done |
| BR-13 | Immutable compliance audit logging | FR-ADM-002 | Audit Management | Administration.tsx, AuditLogs.tsx | audit_logs | /audit-logs, /audit-logs/verify-chain (ADR-029) | hash chain written on every auth/user mutation in `test_auth_flow.py`; insert-only grant verified live in Phase 1; dashboard's `/dashboard/activity-stream` read surface plus the new dedicated, filterable, Admin-only `/audit-logs` screen with a live chain-integrity verification action (`test_admin_can_list_and_filter_audit_logs`, `test_tester_cannot_view_audit_logs`, `test_verify_chain_reports_valid_for_untampered_log`); full Users&Roles → Audit Logs → Verify Chain Integrity flow driven live in a real browser (Phase 10.8) | Done |

## Planning-phase-only items (not in original BR list, added by architecture review)
| ID | Requirement | ADR | Status |
|---|---|---|---|
| BR-14 | Platform tenant bootstrap (first admin provisioning) | ADR-008 | Done |
| BR-15 | Test case version pinning on execution | ADR-003 | Done |
| BR-16 | GDPR pseudonymization flow | ADR-009 | Done |
| BR-17 | MFA challenge lifecycle (real/simulated) | ADR-011 | Done |
| BR-18 | Attachment storage (filesystem + metadata) | ADR-012 | Done (GAP-15, post-Phase-10) |
| BR-19 | Login requires explicit tenant_id (email is tenant-scoped, not global) | ADR-017 | Done |
| BR-20 | Team member allocation to projects (FR-PROJ-002), with Manager authority scoped to assigned projects (ADR-018) | FR-PROJ-002 | Done (backend + frontend, Phase 10.2) |
| BR-32 | `GET /users` directory readable by Manager (not just Admin) so project member allocation is actually usable | ADR-028 | Done |
| BR-33 | `GET /projects/{id}/test-runs` list endpoint (BRD's "Test Plans / Runs" screen had no way to list existing runs before this phase) | — | Done |
| BR-21 | `testrun.finish` sign-off gate, Manager/Admin only (BRD matrix doesn't separately qualify run closure vs. creation) | ADR-022 | Done |
| BR-22 | Only `approved` test cases may be bundled into a test run | ADR-025 | Done |
| BR-23 | Multi-criteria defect filtering (project/status/severity), FR-DEF-002 | FR-DEF-002 | Done (backend + frontend, Phase 10.6) |
| BR-34 | `GET /defects?test_run_id=` scoped filter so the Execution Console can show "already reported" badges without an N+1 per-step lookup (GAP-20) | GAP-20 | Done |
| BR-35 | New `audit.view` permission (Admin-only) gating the dedicated `/audit-logs` and `/audit-logs/verify-chain` endpoints | ADR-029 | Done |
| BR-36 | Playwright E2E suite covering BRD Journeys 1-4 end to end against the real backend, plus a WCAG 2.1 A/AA accessibility scan across every main screen (zero serious/critical violations) | — | Done (Phase 10.9) |
| BR-37 | Per-IP rate limiting on `/auth/login` and `/auth/mfa/verify` (GAP-16) | — | Done (post-Phase-10) |
| BR-38 | Row-locked MFA attempt-count read to close a concurrency race in the 3-attempt lockout (GAP-17) | — | Done (post-Phase-10) |
| BR-39 | `pip-audit`/`npm audit` dependency vulnerability scanning wired up; `python-multipart` fully patched (GAP-19) | — | Done (post-Phase-10; `starlette` CVEs remain, need a dedicated `fastapi>=0.140.0` upgrade effort) |
| BR-40 | Structured backend request logging (method/path/status/duration) and app-startup log, replacing silence beyond uvicorn's own access log | ADR-031 | Done (foundation hardening pass) |
| BR-41 | Docker health checks on all three services (`db`/`api`/`web`) and `restart: unless-stopped` on all three, closing a foundation-spec gap | ADR-031 | Done (foundation hardening pass) |
| BR-42 | DB credentials sourced from a gitignored root `.env` via compose variable substitution instead of hardcoded in `docker-compose.yml`; `qtesthub_app` role password now set from `APP_DB_PASSWORD` by a dedicated migration (GAP-11) | ADR-031 | Done (foundation hardening pass) |
| BR-43 | UI shell completion: breadcrumb trail, notification bell (honest empty state, no backend feed yet), and a profile dropdown menu, closing the foundation spec's UI shell checklist | — | Done (foundation hardening pass) |
| BR-44 | Suspended/Pending tenant status enforced at login and on every authenticated request (GAP-23) | ADR-032 | Done (auth/tenant hardening pass) |
| BR-45 | Admin-initiated password reset, revoking the target user's existing sessions (GAP-24) | ADR-032 | Done (auth/tenant hardening pass) |
| BR-46 | Idle/sliding session timeout enforced via `sessions.last_seen_at`, alongside the existing absolute timeout (GAP-25) | ADR-032 | Done (auth/tenant hardening pass) |
| BR-47 | "Real" (SMTP email) MFA delivery mode, distinct from simulated dev mode, failing loudly if unconfigured (GAP-04 partial) | ADR-032 | Done (auth/tenant hardening pass) |
| BR-48 | Platform Administration (tenant lifecycle) frontend screen at `/platform-admin` (GAP-26) | ADR-008, ADR-032 | Done (auth/tenant hardening pass; success path not live-click-verified, see GAP-26) |
| BR-24 | Defect status transitions strictly sequential, no reopen-from-Closed | ADR-026 | Done |
| BR-25 | Real-time KPI dashboard cards (projects, test cases, runs, defects) | FR-DASH-001 | Done |
| BR-26 | Recent operational activity stream (last 10 audit events) | FR-DASH-003 | Done |
| BR-27 | CSV compliance export with tenant/timestamp/officer header | FR-REP-002 | Done (backend + frontend download link, Admin/Manager only, Phase 10.7) |
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
Phase 10 (new, split from the original Phase 9 plan): Frontend UI, accessibility pass, Playwright E2E across all BRD §9 journeys — **Done** (10.1 auth/shell/dashboard, 10.2 Projects, 10.3 Test Case Management, 10.4 CSV Import/Export, 10.5 Test Execution Console, 10.6 Defects Management, 10.7 Reporting charts, 10.8 Administration, 10.9 accessibility + E2E suite all done). All ten frontend screens exist, are covered by the Playwright E2E suite (`frontend/e2e/`), and pass a WCAG 2.1 A/AA accessibility scan with zero serious/critical violations.
All other BR rows are `Not Started` until their corresponding phase begins.
