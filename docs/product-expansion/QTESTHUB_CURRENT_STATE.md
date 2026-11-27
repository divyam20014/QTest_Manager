# QTestHub: Current State

Assessment date: 2026-11-27. Code baseline: commit `c4479b5` on `main`. Database baseline: Alembic head `a7c9e1f3b5d8`, read from the running development database (read-only).

## Changes since the assessment (2026-11-27)

These documents describe the baseline below. Since then:

- **F-01 fixed** (ADR-135). Content edits to a deprecated case are refused, and a version with results is never edited in place. The rule is in the service; there is no database trigger. A read-only check of the development database found no executed history affected: one of 6 deprecated cases had been edited afterwards, and it had no results.
- **F-08 fixed.** The served documents were copied back into `docs/`, and the sync check passes.
- **CI added** as a workflow file. It has not run, because it has not been pushed.
- **Backend suite run to completion:** 1,582 of 1,584 tests passed (1 hour 50 minutes). One failure was an out-of-date test of the project tab keys (not updated with ADR-131); it was corrected and its file passes (13 of 13). The other is the 2,000-row import speed budget (GAP-69), which stays open. The full suite was not run again after the correction.
- **Frontend:** type check, lint (warnings only) and build passed. All 615 unit tests passed: the full run had one failure, the design-system colour rule, and that file passed after an explained exception was recorded.
- **Browser suite: not run to completion.** The product owner chose to skip it on 2026-11-27.

The other findings are open, except as noted below.

### Phase 0 completion (later on 2026-11-27)

- **F-04 fixed for test cases and defects** (ADR-136). The silent overwrite and the unseen approval were first reproduced. Tasks, requirements and releases are not covered. Migration `b1d3f5a7c9e2`.
- **F-02 corrected, not solved** (ADR-137): the figures are labelled as whole-project. Per-release readiness is not built.
- **F-03:** the user guide no longer says runs record a build or environment. Runs still do not.
- **F-05 fixed** (ADR-138). Work on it showed that adding the audit log would have failed the whole export job; that is handled.
- **Added:** tests for tenant isolation of the schema, route guards and export coverage.
- **F-12 (new, open):** `POST /requirements/{id}/generate-test-cases` checks project access but not `testcase.create`, and it saves test cases. With AI enabled, a role without that permission could create them. **[V] code reading; [U] not reproduced.**

### Phase 1, steps A to D (2026-11-27)

- **1A, F-07 addressed** (ADR-139): a project needs only a name; the domain list belongs to the organization.
- **1B** (ADR-140): archive and restore; the database makes an archived project read-only.
- **1C** (ADR-141): teams, added to a project as a copy of their current members.
- **1D** (ADR-142): a new project can copy another's tabs and module folders. No template tables; task statuses were already organization-wide.
- **1E** (ADR-143), approved and built: F-06 and F-12 fixed; QA Lead, Developer and Viewer added. The problems were reproduced in tests first. A read-only report on the development database: no project roles set; one custom role is affected (AI generation) and no active user has it. See [the approved proposal](QTESTHUB_PHASE1E_PERMISSIONS.md).
- **Two older defects found and fixed:** saving a project's dates, budget or linked manager answered with a server error (introduced 2026-11-09); so did giving an existing user a custom role.
- **Test results:** full backend suite 1,647 of 1,650 passed (1 hour 50 minutes). One failure is the known import speed budget (GAP-69). Two were a flaw in the new route-guard test, which counted routes other tests add; it was corrected and passes after those tests. The full suite was not run again after that correction.
- **After 1E**, a second full backend run: 1,626 of 1,668 passed (1 hour 24 minutes). 39 failures were a defect introduced by 1E that stopped every import-wizard import (two causes: the wrong names for the import types, and a permission lookup handed the importer instead of the signed-in context, hidden from the type check by an ignore marker). One was a test using the new role name "QA Lead" and one a test listing task permission holders. All were fixed and their files rerun and passing. The remaining one is the import speed budget (GAP-69). The full suite was not run again after these fixes.
- **R-9** (added after the matrix was approved): marking a defect Verified, by status change or import, needs `testcase.execute`. 169 related backend tests and 337 related frontend tests passed.
- **Development database upgraded (2026-11-28)** to `f5b7d9e1a3c4`. A rehearsal first found that 880 of 884 project memberships pointed to projects and users that no longer existed, so a strict restore failed. Cause: `seed_loadtest.py --drop` deleted only tables with a `tenant_id`, with foreign key checks off. With the owner's approval the 880 rows were removed (a copy was kept), every foreign key was checked, a strict restore of a new backup succeeded, and then the upgrade ran. The cleanup was fixed and tested on a temporary database.
- **Open:** `seed_loadtest.py` can no longer create its data: it inserts requirements without a task, which the database has refused since ADR-128.

## How to read these documents

| Mark | Meaning |
|---|---|
| **[V]** | Verified: seen in the code or live schema at the baseline, or reproduced. Where the evidence is a test run, it says so. |
| **[R]** | Recommendation. |
| **[U]** | Unknown or not verified. Do not treat as fact. |

Nothing in the application, its database schema or its configuration was changed. One temporary test file was added to reproduce finding F-01, run against the backend tests' separate database, and removed.

Companion documents: [Gap analysis](QTESTHUB_GAP_ANALYSIS.md), [Product blueprint](QTESTHUB_PRODUCT_BLUEPRINT.md), [Database design](QTESTHUB_DATABASE_DESIGN.md), [Architecture](QTESTHUB_ARCHITECTURE.md), [Roadmap](QTESTHUB_IMPLEMENTATION_ROADMAP.md), [Risk register](QTESTHUB_RISK_REGISTER.md).

## 1. Size [V]

| Area | Count |
|---|---|
| Backend application | 238 Python files, about 46,000 lines; 366 route declarations in 47 route files (the running app registers 388 method routes); 69 service modules |
| Database | 76 Alembic migrations |
| Frontend | 435 TypeScript files, about 70,000 lines; 20 runtime npm dependencies |
| Tests | 96 backend test files (1,075 test functions), 80 frontend unit test files, 77 browser spec files |

## 2. Technology: expected against actual

| Expected | Actual [V] |
|---|---|
| React, TypeScript, Vite, Tailwind | As expected. React Query for server state, React Router, Recharts. |
| shadcn/ui | A `components.json` exists, but `package.json` has no Radix or shadcn dependency. `components/ui` holds the project's own components. |
| FastAPI, SQLAlchemy, PostgreSQL | As expected. PostgreSQL 16 with `pgcrypto`, `citext`, `pg_trgm`, `pg_stat_statements`. |
| JWT or session authentication | **Server-side sessions** in the database with an `HttpOnly`, `SameSite=Lax` cookie (`Secure` outside development). Not JWT. `PyJWT` is a dependency; the sign-in does not use JWT sessions. |
| Argon2id | `argon2-cffi` `PasswordHasher`. |
| RBAC and RLS | Both, see sections 6 and 7. |
| Redis / Celery | **Neither.** A database-backed job queue with its own worker process. |
| Docker | `docker-compose.yml` (db, api, web, worker) and `docker-compose.prod.yml` (adds an nginx proxy). |

## 3. Frontend and routing [V]

- Single-page app. `routes/AppShell.tsx` provides the sidebar, top bar, phone bottom bar and command palette.
- Flat sidebar: Dashboard, My Work, Projects, Test Cases, Test Runs, Defects, Reports, Admin. One definition in `lib/navRegistry.ts` feeds the sidebar, the phone menu and search.
- Project workspace tabs: Overview, Tasks, Test Cases, Test Runs, Defects, Reports, Planning (suites, plans, releases, builds), Team. Activity and Settings open from the project header.
- Records live under `/projects/:projectId/...`; older URLs redirect.
- Routes are lazy-loaded; `lib/routeAccess.ts` gates menus and pages (the API enforces access independently).
- Tenant defaults can hide or reorder menu entries and tabs (`Admin > Workspace`). **"Workspace" already has this meaning in the product.**
- Other surfaces: public marketing pages, self-service signup, invitations, a platform-administrator console, a user guide.

## 4. Backend and API organisation [V]

- Layers: `api/` (routes) → `services/` (rules) → `models/` (SQLAlchemy), with `schemas/` (Pydantic) at the boundary. A modular monolith.
- Base path `/api/v1`. Responses use a `{data, error}` envelope.
- Separate route groups for the platform console, SCIM (`/Users`), OIDC SSO, a CI results webhook and public marketing.
- List sizes are capped (typically 100 or 200 per page; exports 50,000 rows; the task tree 2,000).

## 5. Data model [V]

66 application tables plus `alembic_version`. Details in [Database design](QTESTHUB_DATABASE_DESIGN.md).

| Area | Tables |
|---|---|
| Tenancy and identity | `tenants`, `users`, `roles`, `permissions`, `role_permissions`, `project_members`, `sessions`, `mfa_challenges`, `user_invites`, `sso_configs`, `scim_tokens`, `service_tokens`, `access_rules` |
| Projects and work | `projects`, `tasks`, `task_statuses`, `task_test_case_links`, `releases`, `builds`, `environments` |
| Requirements | `requirements`, `requirement_versions`, `requirement_test_case_links` |
| Test management | `test_modules`, `test_cases`, `test_case_versions`, `test_case_version_steps`, `shared_steps`, `test_data_sets`, `test_data_set_rows`, `test_suites`, `test_suite_cases`, `test_plans`, `test_plan_runs`, `test_runs`, `test_run_cases`, `execution_steps` |
| Defects | `defects`, `defect_links` |
| Collaboration | `comments`, `comment_mentions`, `attachments`, `notifications` |
| Configuration and reporting | `field_options`, `status_labels`, `custom_field_definitions`, `custom_field_values`, `saved_views`, `saved_reports`, `dashboards`, `dashboard_widgets`, `report_schedules` |
| Operations | `audit_logs`, `audit_chain_checkpoints`, `background_jobs`, `import_sessions`, `idempotency_keys`, `entity_counters`, `ai_usage_logs`, `plans`, `subscriptions` |
| Platform | `platform_admins`, `platform_sessions`, `platform_admin_recovery_codes`, `platform_audit_events`, `marketing_leads` |

Present **only** as listed. There are no tables for workspaces, departments, teams, milestones, sprints, task dependencies, work logs, resource allocations, release approvals or release checklists.

## 6. Authentication and authorisation [V]

- Tenant sign-in: email, password, then a one-time code (5 minutes, 3 attempts). OIDC single sign-on and SCIM provisioning exist. SAML is deliberately not built (`PRODUCT_VISION.md`).
- Sessions: 30-minute idle and 12-hour absolute settings. Tenant IP allowlist.
- Platform administrators: a separate plane with password and authenticator app (TOTP), recovery codes, lockout after 5 failures, step-up for sensitive actions, an origin check, and its own hash-chained audit.
- System roles: `admin`, `manager`, `tester`; tenants can add custom roles. 41 permission codes.
- A project member can have a project role override (`project_members.role_id`).
- Optional conditional access rules (time and environment), off by default.
- Rate limiting with `slowapi`: tighter limits on sensitive routes and a 300/minute backstop. Storage is in process memory.

## 7. Multi-tenancy and RLS [V]

- One shared schema; `tenant_id` on tenant data; the tenant is set per transaction (`app.current_tenant`).
- **51 policies**, all `FOR ALL` with `WITH CHECK`, and RLS **forced** on those tables.
- The application role `qtesthub_app` is not a superuser and cannot bypass RLS. A second role, `qtesthub_identify`, bypasses RLS and is used for finding a user's tenant at sign-in. Migrations run as the owner `qtesthub`.
- `audit_logs`: the application role has `INSERT` and `SELECT` only. Records are hash-chained, with signed checkpoints.
- Tables with a `tenant_id` but **no RLS**: `sessions`, `mfa_challenges`, `user_invites`, `background_jobs`. Tables with neither: including `project_members` and `role_permissions`. **[U]** The reason for each exception was not individually confirmed; they appear to serve pre-sign-in or worker paths.
- Foreign keys generally do not include `tenant_id` (composite same-project keys exist for tasks, requirement-to-task and defect-to-task). Same-tenant references therefore rely on service validation together with RLS on reads. **[U]** No cross-tenant write was attempted in this assessment.

## 8. Integrations [V]

| Integration | State |
|---|---|
| OIDC SSO, SCIM | Built |
| CI results webhook (`POST /webhooks/test-results`) with service tokens | Built |
| AI | One provider (Google Gemini) behind an `AIProvider` interface. Per tenant: off until enabled, with its own encrypted API key and usage log |
| Email (SMTP) | Built; delivery mode is `simulated` or `real` |
| Object storage | Local disk by default; S3-compatible backend available |
| Error monitoring | Sentry SDK, enabled by DSN |
| Jira, Azure DevOps, Slack, GitHub | No integration found |

AI features: generate test cases from a requirement (**saved as new test cases that still need approval**), review a test case, analyse a requirement change, an assistant that answers questions, defect root-cause suggestion.

## 9. Background jobs [V]

`app/worker.py` polls `background_jobs` and claims work with `FOR UPDATE SKIP LOCKED`, so several workers can run. Job types include CSV import, standard import commit and tenant data export. The worker also runs timed duties. States: queued, running, succeeded, failed, with an attempt count.

## 10. Files and attachments [V]

- Attach to: test case, defect, execution step, requirement, task. (The schema also allows a test case version; the product does not use it.) Comments: test case, defect, execution step, task. Both are polymorphic (no foreign key to the owner).
- Allowed: common image types, PDF, Word, Excel, CSV, text, log. 10 MB limit. Checked by extension **and** file signature for binary types. SHA-256 stored.
- No malware scanning found.
- BRD/SRS files can be attached to a requirement or task. **Nothing reads their content.**

## 11. Errors and logging [V]

Central handlers for application, validation, data, rate-limit and unexpected errors. Structured JSON logs, a request id (`x-request-id`) on every request, and a request log line with duration. `GET /api/v1/ready` checks readiness.

## 12. Automated tests

| Fact | Basis |
|---|---|
| **The full backend suite and full browser suite have not been run to completion** in the recent work | [V] session record |
| Browser tests now run only against a throwaway database and servers (`npm run test:e2e`) | [V] commit `c4479b5`; of 26 high-risk tests, 23 passed and 3 failed waiting for pages; after the test API was changed to one process, the two affected files passed (8 of 8) |
| Targeted suites for the navigation work passed on 2026-11-26 | [V] test output |
| One performance test fails: 2,000-row legacy import over its 2.5 s budget (4.6 s measured) | [V] run on 2026-11-26; also GAP-69 |
| One backend type error remains (`test_case_service.py`, mypy) | [V] run on 2026-11-26 |
| No CI workflow was found in the repository | [V] no `.github` directory or other pipeline file seen |
| Coverage percentage | [U] not measured |

## 13. Docker and deployment [V]

- Development: the `web` container runs the Vite dev server; images bake in source, so code changes need a rebuild.
- Production: `docker-compose.prod.yml` builds the frontend with `Dockerfile.prod` (static files on nginx), adds a TLS reverse proxy with HSTS, nosniff, frame denial, referrer policy and a content security policy.
- The API refuses to start in production with unsafe defaults (simulated MFA, development database passwords, development or wildcard CORS, missing encryption key, and others).
- Backup, restore and verification scripts exist in **two places** (`scripts/`, `deployment/scripts/`), and there are **two nginx configurations** (`deploy/`, `deployment/`). **[U]** Which set is authoritative.
- **[U]** The production stack was not built or run in this assessment. Hosting target, backup schedule and restore drills are unknown.

## 14. Performance and security notes

- [V] The test case board is recorded as slow near 50,000 cases; the task tree and picker stop at 2,000 (`KNOWN_GAPS.md`, code).
- [V] Load-test scripts exist (`seed_loadtest.py`, `loadtest_api.py`). **[U]** No load test was run in this assessment.
- [V] No tenant-plane CSRF token or origin check was found; protection rests on `SameSite=Lax` and the CORS allowlist.

## 15. Findings referenced by the other documents

| ID | Finding | Evidence | Severity |
|---|---|---|---|
| **F-01** | **History of an executed test case version can be rewritten.** After deprecating an executed case, editing its title or expected result succeeds (200) and changes the version the finished result points to. Editing its steps fails with an unhandled foreign-key error. Only *approved* cases create a new version on edit, and nothing blocks editing a *deprecated* one. | **[V] Reproduced** on the test database | Critical |
| **F-02** | **Release readiness ignores the chosen release.** `release_id` is only checked to exist and used for the name; the counts, pass rate, open defects and coverage are for the whole project. | [V] `reporting_service.get_release_readiness` | Critical |
| **F-03** | **A test run records no environment, build or release.** `test_runs` has no such columns, although the user guide says a run is executed against a build and environment. | [V] live schema, `TestRunCreateRequest` | High |
| **F-04** | **No protection against overwriting another user's changes** on defects, test cases, tasks or requirements. Only project updates send `expected_version`. A reviewer can approve content edited after they opened it, because editing a case in review keeps it in review. The test case edit form can compare old input against a newer version fetched in the background and so restore old content. | [V] code reading. **[U]** not reproduced with two users | High |
| **F-05** | **The tenant data export is incomplete.** Among others it omits test suites, test plans and their run links, shared steps, test data sets and rows, custom field definitions and values, field options and status labels. | [V] `export_service._EXPORT_MODELS` against the live schema | High |
| **F-06** | **Project role overrides apply at the route check only.** Service rules still branch on the tenant-wide role (38 `role_code` comparisons in services and routes). The code documents this as deferred. | [V] `core/auth.py` | High for per-project PM roles |
| **F-07** | **Projects are insurance-specific and heavy to create.** `domain` is required and limited to Motor, Health, Travel, Life, Property; `budget`, `region`, `manager_name`, `start_date` and `end_date` are also required. | [V] live schema, `ProjectCreateRequest` | High for the new market |
| **F-08** | **Documentation sources have drifted.** `docs/` is the registered source and `backend/app/docs_content/` the served copy. Recent work (including ADR-129 to ADR-134) edited only the served copy. **Running the docs sync would overwrite those edits.** Affected: user guide, ADRs, API specification, database schema, test strategy. | [V] file comparison, `sync_docs.py` | High, easy to fix |
| **F-09** | Several planning documents are out of date. For example `SAAS_GAP_ANALYSIS.md` still lists no production frontend build, no error monitoring, no backup scripts and unstructured logs, all of which now exist. `IMPLEMENTATION_STATUS.md` was last committed 2026-11-11. | [V] | Medium |
| **F-10** | History keeps at most 300 characters of each old and new value; editing a draft or in-review case overwrites the current version. Re-recording a step verdict replaces it, with the earlier value only in the audit entry. | [V] `core/audit_diff.py`, `execution_service.record_verdict` | Medium |
| **F-11** | Backend tests migrate a second database on the same server using the default role passwords. Role passwords are server-wide, so this would change them on a server using other passwords. | [V] `tests/conftest.py`, migrations | Medium |
