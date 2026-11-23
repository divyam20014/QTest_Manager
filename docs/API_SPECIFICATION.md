# API Specification — Planning-Phase Inventory

Scope note: this is the endpoint inventory agreed at planning time to validate module boundaries and the DB schema against real access patterns. Exact request/response bodies are finalized per-phase (in step with Pydantic schemas) and reflected here as each module is implemented — this file is a living document, not a frozen contract.

## Conventions
- Base path: `/api/v1`.
- Auth: HTTP-only session cookie, set by `/auth/login` after MFA verification.
- Response envelope: `{ "data": ..., "error": null }` on success, `{ "data": null, "error": { "code": "...", "message": "..." } }` on failure. No fake/mocked success responses (engineering principle).
- Malformed ids (path, query or body) are a `422` with `{ "data": null, "error": { "code": "validation_error", "message": "..." } }` (request validation errors use the same envelope as every other error, ADR-088); a value the database rejects is `422` with code `invalid_value`. A well-formed id that does not exist or belongs to another tenant stays `404`. Never `5xx`.
- All list endpoints are tenant-scoped automatically via session context; `tenant_id` is never a request parameter.
- Pagination: `?page=&page_size=` on all list endpoints, `{ "items": [...], "total": N }` under `data`. Test cases, defects (with `page_size`) and audit logs also accept an optional `cursor` (empty = first page) for keyset paging: the response adds `next_cursor` (body; `X-Next-Cursor` header for the audit list), `page`/`offset` are ignored, and `include_total=false` skips the count (`total = -1`) (ADR-113).

## Operational endpoints (no auth, no tenant context)
| Method | Path | Purpose |
|---|---|---|
| GET | /health | Liveness only — always returns `{"status":"ok"}` if the process is up. |
| GET | /ready | Readiness — does a real `SELECT 1` against the database; 503 if unreachable (SAAS-GAP-16). Used by the `api` service's Docker healthcheck. |

## Platform Administration (no tenant context)

Step-up (ADR-083): the routes marked *Step-up required* answer **403** with error code `step_up_required` unless a TOTP or recovery code was verified on the session within `PLATFORM_STEP_UP_MINUTES` (completing MFA at sign-in counts); call `POST /platform/auth/step-up`, then repeat the request.

Authentication (ADR-074, supersedes HTTP Basic): sign in through `/platform/auth/*` (password, then authenticator code or recovery code). Every route below requires a fully authenticated (`mfa_verified`) session carried in the `qth_platform_session` HttpOnly, SameSite=Strict cookie (`Path=/api/v1/platform`); an `Authorization: Basic` header is rejected with 401. State-changing requests carrying a browser `Origin` outside `CORS_ALLOW_ORIGINS` get 403.
| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | /platform/auth/login | Password step: `{email, password}` → sets the pre-MFA `qth_platform_session` cookie (stage `password_ok`, 10 min, grants no API access). Rate limited 10/min/IP; 5 wrong passwords lock the account 15 min (ADR-074) | public |
| GET | /platform/auth/me | Current platform session: `{email, stage, mfa_enrolled, recovery_codes_remaining, step_up_expires_at}` (`step_up_expires_at` is null when a step-up is needed); 401 when signed out/expired (an idle session answers 401 with code `session_idle_expired`; a User-Agent or, when enabled, IP change revokes the session with a generic 401, ADR-083) | platform session (any stage) |
| POST | /platform/auth/mfa/enroll/start | First-time setup: body `{enrolment_code}` (the one-time code issued with the account, ADR-080); returns a *pending* `{secret, otpauth_uri, issuer, account}`. Wrong/expired/absent code -> 401 `Invalid or expired enrolment code` (counted towards the MFA lockout, code not consumed); 409 once MFA is enabled | platform session (`password_ok`) |
| POST | /platform/auth/mfa/enroll/verify | `{code, enrolment_code}` re-checks the enrolment code, confirms the first authenticator code, consumes the enrolment code, enables MFA, returns the 10 single-use `recovery_codes` **once** and rotates to a fully authenticated session | platform session (`password_ok`) |
| POST | /platform/auth/mfa/verify | `{code}` (6-digit TOTP) **or** `{recovery_code}` (consumed) → fully authenticated session (token rotated). 5 wrong codes lock the account 15 min and revoke its sessions | platform session (`password_ok`, enrolled) |
| POST | /platform/auth/step-up | ADR-083: `{code}` (current TOTP, replay-protected) **or** `{recovery_code}`; stamps the session's `step_up_at` and returns `{step_up_expires_at}` (valid `PLATFORM_STEP_UP_MINUTES`, default 5). A wrong code counts toward the MFA lockout (generic 401; five failures lock the account and revoke every session). Audited `step_up_ok` / `step_up_failed`. Rate limited 10/min/IP | platform session (`mfa_verified`) |
| GET | /platform/auth/sessions | ADR-083: the caller's own live sessions: `[{id, created_at, last_seen_at, ip_address, user_agent (truncated), current}]`. Never a token or token hash | platform session (`mfa_verified`) |
| DELETE | /platform/auth/sessions/{id} | ADR-083: sign out one of YOUR sessions; returns `{revoked, current}` (revoking the current one clears the cookie). Another admin's, an unknown or an already revoked id is 404. Audited `session_revoked` | platform session (`mfa_verified`) |
| POST | /platform/auth/logout | Revokes the session and clears the cookie | any |
| POST | /platform/auth/password/change | Self-service: `{current_password, new_password, code}` **or** `{..., recovery_code}`. Needs the current password and a fresh (replay-protected) authenticator code or unused recovery code; new password follows the platform policy (422) and must differ from the current one (422). Revokes the admin's OTHER sessions and keeps this one. Wrong current password counts toward the 5-strikes/15-min lockout, wrong code toward the MFA lockout (generic 401). Rate limited 5/min/IP (ADR-081) | platform session (`mfa_verified`) |
| POST | /platform/auth/password/reset | Complete an admin-issued reset: `{email, reset_code, new_password, code \| recovery_code}` (the authenticator factor is needed when MFA is enabled). Success sets the password, consumes the code and revokes sessions (it does not sign in). Wrong/expired code or unknown email -> generic 401 `Invalid or expired reset code`, counted toward the lockout, the code is not burned. Rate limited 10/min/IP (ADR-081) | public |
| POST | /platform/tenants | Create tenant + first Admin user (ADR-008); every new tenant is seeded with a default Trial subscription (ADR-053); optional `primary_domain` (Motor/Health/Travel/Life/Property/Other, else 422; ADR-073) | platform_owner |
| GET | /platform/tenants | List tenants (each includes `primary_domain`, ADR-073) | platform_owner |
| PATCH | /platform/tenants/{id}/status | approve/suspend tenant | platform_owner |
| POST | /platform/admins/{id}/reset-mfa | **Step-up required (ADR-083).** Clear another platform admin's MFA (lost device) and revoke their sessions; they re-enrol at next sign-in using the fresh one-time `enrolment_code` returned **once** in this response (ADR-080). 409 for your own account (ADR-074) | platform_owner |
| POST | /platform/admins/{id}/enrolment-code | **Step-up required (ADR-083).** Issue a new one-time enrolment code for an admin who has not enrolled yet (replaces any earlier code); returns it once as `enrolment_code`. 409 for your own account or an enrolled admin, 404 unknown (ADR-080) | platform_owner |
| POST | /platform/admins | **Step-up required (ADR-083).** Create a platform admin `{email, password}`; returns the one-time enrolment code once (ADR-080) | platform_owner |
| PATCH | /platform/admins/{id} | `{is_active}`. **Deactivating needs a step-up (ADR-083)**; reactivating does not | platform_owner |
| POST | /platform/admins/{id}/password-reset-code | **Step-up required (ADR-083).** Issue a one-time password-reset code for another admin (replaces any earlier one): returns it once as `password_reset_code`, revokes the target's sessions at once and blocks their old password until the code is used (`PLATFORM_PASSWORD_RESET_CODE_TTL_HOURS`, default 24). The list exposes only `password_reset_code_active` / `password_reset_code_expires_at`. 409 for your own account or a deactivated admin, 404 unknown. Rate limited 10/min/IP (ADR-081) | platform_owner |
| GET | /platform/audit-events | Read-only platform audit trail (ADR-082), newest first: `event_type`, `outcome` (`success`\|`failure`), `actor_email` (substring), `page`, `page_size` (max 100). Items carry `id`, `created_at`, `event_type`, `actor_admin_id`, `actor_email`, `target_admin_id`, `ip`, `outcome`, `details` (whitelisted keys only); never any secret, code, hash or token. Platform session required, 401 otherwise. Rate limited 60/min/IP | platform_owner |
| GET | /platform/audit-events/verify | Re-walks the platform audit hash chain, then checks the signed checkpoints; returns `{valid, checked_count, broken_at_id, checkpoints_checked, checkpoint_failure}` (same shape as the tenant verify; `checkpoint_failure` is `null` or `{checkpoint_id, reason}`). Rate limited 10/min/IP (ADR-082, ADR-085) | platform_owner |
| GET | /platform/audit-events/checkpoints | Signed checkpoints of the platform chain, oldest first (ADR-085). Rate limited 30/min/IP | platform_owner |
| POST | /platform/audit-events/checkpoints | Anchors the current platform chain head in a new signed checkpoint. Returns `{created, reason, checkpoint}`; `created=false, reason="no_new_events"` when nothing changed since the last one. 409 if the chain or an earlier checkpoint already fails verification. Platform session required, no step-up. Rate limited 10/min/IP | platform_owner |
| GET | /platform/audit-events/checkpoints/export | The same list as a downloadable JSON document `{scope, exported_at, checkpoints}` to store off-box. Rate limited 10/min/IP | platform_owner |
| GET | /platform/plans | list the subscription-plan catalog (Tier 1, ADR-053) | platform_owner |
| GET | /platform/tenants/{id}/subscription | view a tenant's current subscription | platform_owner |
| PUT | /platform/tenants/{id}/subscription | assign/update a tenant's plan/status/seat count — schema/record-keeping only, no payment gateway (Tier 1, ADR-053) | platform_owner |

## Authentication (FR-AUTH)
| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | /auth/signup | public self-service signup (ADR-064): creates the tenant, its first Admin and a sample project; rate-limited 5/hour per IP; the Admin still signs in through login + MFA. Optional `primary_domain` (Motor/Health/Travel/Life/Property/Other; any other value is a 422) pre-selects the Domain of new projects (BRD FR-AUTH-04, ADR-073) | public (unauthenticated) |
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
| POST | /users/{id}/erase | erase a user's personal data (ADR-086). Body `{dry_run (default true), confirm_email}`. A dry run returns `{dry_run, erased:false, changes, retained, notes}` with per-table counts and changes nothing; a real run (`dry_run=false`) needs `confirm_email` equal to the user's current email (422 otherwise) and anonymises the user in one transaction: name -> "Erased user", email -> `erased-<id>@erased.invalid`, account closed, sessions revoked, notifications removed, invites and report-schedule addresses cleaned, audit event `user.erased` (ids and counts only). 409 for yourself, the last active Admin, or an already-erased user; 404 for an unknown or other-tenant id. Rate-limited. User objects now carry `erased_at`. Replaces the removed `/users/{id}/gdpr-erase` | admin (`user.erase`) |
| GET | /users/me/history | self-service account history (creation, profile/role edits, password resets, own login/MFA events) (ADR-039) | all (scoped to caller's own account) |
| POST | /users/invite | create a single-use, time-limited invite (no `users` row exists until accepted); "simulated" email mode returns the token directly (Tier 1, ADR-053) | admin |
| POST | /users/invite/{token}/accept | public, no auth — sets the invitee's own password and activates the account | any (unauthenticated) |

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

## Requirements Management (AI/SaaS vision roadmap Phase 2, ADR-044, GAP-71)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/requirements | list, paginated | assigned/all per role |
| POST | /projects/{id}/requirements | create (version 1) | admin, manager (`requirement.manage`) |
| GET | /projects/{id}/requirements/coverage | RTM/coverage report: total/covered requirement counts + percentage | assigned/all per role |
| GET | /requirements/{id} | detail incl. linked test cases | assigned/all per role |
| GET | /requirements/{id}/versions | immutable version history, newest first | assigned/all per role |
| PATCH | /requirements/{id} | edit; always forks a new version (no draft/approved workflow) | admin, manager (`requirement.manage`) |
| DELETE | /requirements/{id} | delete (cascades its test-case links) | admin, manager (`requirement.manage`) |
| POST | /requirements/{id}/test-cases | link a test case (must belong to the same project, 409 otherwise) | admin, manager (`requirement.manage`) |
| DELETE | /requirements/{id}/test-cases/{testCaseId} | unlink | admin, manager (`requirement.manage`) |

## AI Test Case Generator & Reviewer (AI/SaaS vision roadmap Phase 3/4, ADR-045/ADR-046, GAP-72)
| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | /requirements/{id}/generate-test-cases | generate up to `max_cases` (1-5, default 3) draft test cases from a requirement via the tenant's configured AI provider; auto-linked to the requirement; 409 if AI isn't enabled/configured for the tenant | same as manual test-case creation (all, assigned) |
| POST | /test-cases/{id}/ai-review | review an existing test case's clarity/missing-steps/ambiguous-expected-results; returns suggestions only, never mutates the test case; 409 if AI isn't enabled/configured | same as viewing the test case (all, assigned) |
| GET | /ai/usage | per-tenant token-usage summary (requests, successful requests, prompt/completion/total tokens) across both generation and review | admin (`tenant.settings.manage`) |

## Test Case Management & Versioning (FR-TC)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-cases | list; supports `search` (Test Case ID, title, requirement reference or module name; case-insensitive, LIKE wildcards literal), `priority`, `status` (review status), `assignee_id`, `module_id`, `test_type`, `severity`, `automation_status` (Manual / Automated / Candidate for Automation), `environment`, `execution_status` (Pass / Fail / Blocked / Skipped / Not Run), `executed_by` (user id), `quarantined`, `sort` (`title`, `created_at`, `priority`, `status`, `display_id` numeric, `test_type`, `severity`, `automation_status`, `last_executed_at`, `execution_status`; prefix `-` = descending), `page`/`page_size`, keyset `cursor` (created_at sorts only), returns `{items, total}` (ADR-034, ADR-116) | all (assigned) |
| GET | /test-cases | the same listing and the same filters, search and sorts, across every project the caller may see; each item carries its `project_id` (ADR-077). Admin and Manager: every project in the tenant. Anyone else: only projects they own or belong to, exactly the per-project rule | all (assigned projects) |
| GET | /test-cases/columns | the 22 test case fields (`key`, `label`, `type`, `group`, `sortable`, `filterable`, `editable`, `mandatory_on_create`, `default_visible`), the nine `default_columns` in order (Test Case ID, Title, Module, Test Type, Priority, Automation Status, Execution Status, Executed By, Last Execution Date), and the allowed sort keys, filters and enum values, so the UI's column picker is server-driven (ADR-116) | all |
| POST | /projects/{id}/test-cases | create (status=draft, version 1); accepts optional `Idempotency-Key` header (ADR-040). **Mandatory (422 with `error.fields`, one message per field):** `module_id`, `title` (5-255), `priority`, `preconditions` (alias `prerequisite`), `test_data`, `steps` (1-200; each `action`, `expected` / `expected_result`, optional `test_data`; `step_no` is ignored and steps are renumbered 1..n from list order), `expected_result` (case level). Optional: `description` (Markdown, 20,000 chars), `postconditions`, `test_type` (tenant `test_type` options), `severity` (tenant `test_case_severity` options), `automation_status` (default Manual), `environment`, `requirement_ref`, `assignee_id`, `scenario_id`/`scenario_description`, `test_data_format` (`auto`\|`text`\|`json`: `json` rejects malformed JSON, the others accept any text). HTML is stripped from Markdown fields. The response carries the generated `display_id` (TC_000001) and the read-only derived fields (ADR-116) | testcase.create (assigned) |
| GET | /test-cases/{id} | detail incl. current version+steps. Besides the stored fields: `review_status` / `review_status_label` (the lifecycle `status`, product label "Review Status"), `module_name` and `module_path` (`Module/Submodule/Feature`), `preconditions` (= `prerequisite`), `test_data_format` (`json`\|`text`), `created_by_name`, derived `execution_status` (latest executed run case: passed=Pass, failed=Fail, blocked=Blocked, ignored=Skipped; pending / in progress / never = Not Run), `last_executed_by`, `last_executed_at`, `last_actual_result`, `linked_defects` (id, display_id, title, status; capped at 50) with `linked_defect_count`, `attachment_count`, `comment_count`. A soft-deleted case is 404 | all (assigned) |
| GET | /test-cases/{id}/executions | execution history for the history tab: one row per run case (`test_run_case_id`, run, `executed_at`, `executed_by_name`, `status`, `execution_status`, `actual_result`, `blocked_reason`, `version_number`, `defects`), newest first, `page`/`page_size` (max 100), `{items, total}`. Readable for a soft-deleted case by Admin and Manager (ADR-116) | all (assigned; Tester scope applies) |
| POST | /test-cases/{id}/duplicate | copy the definition into a new draft: new `display_id`, title + ` (Copy)`, same module/type/severity/priority/automation/environment/requirement ref/content/steps; no executions, defects, comments, attachments, links, custom values, assignee; audit `testcase.duplicated` (ADR-116) | testcase.create |
| GET | /test-cases/{id}/versions | version history (ADR-003) | all (assigned) |
| GET | /test-cases/{id}/versions/compare?from=&to= | per-step + title/description diff between two versions (ADR-034) | all (assigned) |
| PATCH | /test-cases/{id} | content edit (title/description/steps/scenario/preconditions/test data/expected result/postconditions) → creates a new version and reverts to draft if approved; older versions are immutable. **Metadata-only edits (priority, assignee, module, test type, severity, automation status, environment, requirement ref) never fork a version or un-approve the case** (ADR-070, ADR-116). `display_id` is immutable (422 unless it equals the current value). A legacy case is never refused for empty "mandatory" fields it already had; an edit that CLEARS module, preconditions, test data or expected result is a 422. The audit event records `changes: {field: {from, to}}` (ADR-116) | all (assigned, own drafts for tester delete rule) |
| POST | /test-cases/bulk-update | bulk priority and/or assignee change (`test_case_ids`, `priority`, `assignee_id`; omitted key = unchanged, `assignee_id: null` = unassign); metadata-only; returns per-item `{updated, failed, results[]}`; `testcase.edit` checked per item against its project (ADR-070) | testcase.edit (per project) |
| POST | /test-cases/{id}/submit-review | draft → ready_for_review | tester/manager/admin |
| POST | /test-cases/{id}/approve | → approved | manager, admin |
| POST | /test-cases/{id}/deprecate | → deprecated (terminal; ADR-034) | manager, admin |
| POST | /test-cases/{id}/quarantine | flag a flaky case; body `{reason}` 3-500 characters. 409 if already quarantined; audit `testcase.quarantined` (reason length only) (ADR-097) | `testcase.approve` (manager, admin) |
| POST | /test-cases/{id}/unquarantine | remove the flag; 409 if not quarantined; audit `testcase.unquarantined` | `testcase.approve` |
| DELETE | /test-cases/{id} | **soft delete** (`deleted_at`/`deleted_by`; ADR-116): hidden from lists, search, counts, reports, exports and duplicate-title checks; runs, defects, versions, comments, attachments and the display id are kept (the old 409 when runs/defects exist is gone); audit `testcase.deleted`. A Tester-tier caller without `testcase.delete` may still delete their own draft | `testcase.delete` (project-role overrides apply), or own draft for a Tester |
| GET | /test-cases/{id}/attachments | list attachments (ADR-012, GAP-15) | all (assigned) |
| POST | /test-cases/{id}/attachments | upload (multipart, 10MB cap, file-type allowlist per ADR-034, plus magic-byte/content-signature validation per ADR-040) | testcase.edit (admin/manager/tester) |
| GET | /defects/{id}/attachments | list attachments on a defect (Phase 7, ADR-049, GAP-75) | all (assigned to the defect's project) |
| POST | /defects/{id}/attachments | upload (same validation as test-case attachments) | all (assigned to the defect's project; no dedicated permission, same as other defect mutations) |
| GET | /execution-steps/{id}/attachments | list attachments on an execution step (Phase 7, ADR-049, GAP-75) | all (assigned to the step's run's project) |
| POST | /execution-steps/{id}/attachments | upload (same validation as test-case attachments) | executionstep.record (admin/manager/tester) |
| GET | /attachments/{id}/download | download file bytes (owner-type-dispatched visibility: test case/defect/execution step) | all (assigned to the owning entity's project) |
| DELETE | /attachments/{id} | delete (owner-type-dispatched authorization) | all (assigned to the owning entity's project; permission requirement matches that owner type's own upload rule) |
| GET | /test-cases/{id}/comments | list comments on a test case (Phase 8, ADR-050, GAP-74) | all (assigned) |
| POST | /test-cases/{id}/comments | post a comment, optionally with explicit `mentioned_user_ids` | all (assigned) |
| GET | /defects/{id}/comments | list comments on a defect | all (assigned to the defect's project) |
| POST | /defects/{id}/comments | post a comment | all (assigned to the defect's project) |
| GET | /execution-steps/{id}/comments | list comments on an execution step | all (assigned to the step's run's project) |
| POST | /execution-steps/{id}/comments | post a comment | all (assigned to the step's run's project) |
| DELETE | /comments/{id} | delete (owner-type-dispatched authorization); own comment, or Admin/Manager moderation | author of the comment, or admin/manager |
| GET | /notifications | list the caller's own notifications, newest first (max 50), optional `unread_only` (Phase 9, ADR-051, GAP-74) | all (own notifications only) |
| GET | /notifications/unread-count | unread count for the bell badge | all (own) |
| PATCH | /notifications/{id}/read | mark one notification read | all (own; 404 if it belongs to someone else) |
| POST | /notifications/mark-all-read | mark all of the caller's unread notifications read | all (own) |

## CSV Import/Export (FR-TC-002, ADR-021)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /projects/{id}/test-cases/export.csv | export one project's test cases: every field of the 22-field standard (Test Case ID, requirement, module, test type, severity, automation status, environment, preconditions, test data, steps (one per line, `N. action \| test data \| expected`, ADR-120), expected result, postconditions, execution status, actual result, executed by, execution date, defect ids, created by, attachment and comment counts, plus the legacy columns). `columns=display_id,title,...` selects and orders columns; the same filters as the list (`search`, `priority`, `status`, `assignee_id`, `module_id`, `test_type`, `severity`, `automation_status`, `environment`, `execution_status`, `executed_by`, `quarantined`) and `sort` select and order the rows, so an export can be the current filtered view (ADR-117) (`display_id`, `title`, `module`, `sub_module`, `project`, `priority`, `status`, `description`, `scenario_id`, `scenario_description`, `preconditions`, `test_data`, `assignee`, `steps`, `requirement_ref`, `test_type`, `severity`, `automation_status`, `environment`, `expected_result`, `postconditions`, `execution_status`, `actual_result`, `executed_by`, `last_executed_at`, `linked_defects`, `created_by`, `attachments`, `comments`); unknown or repeated key = 422. Soft-deleted cases excluded; Tester scope applies (ADR-116) | `testcase.bulk_import_export` or `testcase.export` (assigned for tester) |
| GET | /projects/{id}/test-cases/export.xlsx | same rows (and the same `columns=` parameter) as export.csv as an Excel workbook; string cells starting `= + - @` are neutralised (ADR-071) | `testcase.bulk_import_export` or `testcase.export` (assigned for tester) |
| GET | /test-cases/import/template.csv | sample template | all |
| GET | /test-cases/import-template.xlsx | ADR-120: the standard import template: the 22 catalogue headers (+ Assignee Email, Review Status, Scenario Id, Scenario Description, Project Name), an example row, an Instructions sheet and an Allowed values sheet with dropdown validation (the tenant's own options) | `testcase.bulk_import_export` or `testcase.create` |
| GET | /test-cases/import-template.csv | same headers and example row as csv | `testcase.bulk_import_export` or `testcase.create` |
| POST | /test-cases/import/preview | multipart `file` (.xlsx or .csv, 10 MB, 20,000 rows; formulas, macros, external links and zip bombs refused) + `project_id`: validates everything WITHOUT writing and returns `{token, expires_at (30 min), totals, rows (first 200), issues, modules_to_create, file_warnings, unknown_columns, ignored_columns, async_commit}`; a missing mandatory column is a 422 listing the columns; 10/minute | `testcase.bulk_import_export` or `testcase.create` (a Tester must be assigned to the project) |
| GET | /test-cases/import/preview/{token}/rows | pages the stored preview: `status=all|valid|warning|error|issues`, `offset`, `limit` (1-500); the token is private to its user | same |
| POST | /test-cases/import/commit | `{token, mode: all_or_nothing (default) \| skip_invalid}`: validates again and inserts in one transaction (display ids preserved or reserved as a range, versions, steps, audit); answers `{created, skipped, failed, errors, ids, modules_created}`; above 2,000 importable rows `{async: true, job_id}`; a failure rolls everything back; 10/minute | same |
| GET | /test-cases/import/status/{job_id} | the async commit job of the caller (`status`, `result`, `error`) | same |
| POST | /test-cases/import | tenant-wide, synchronous validate+commit; the 13 legacy headers, optionally followed by `Requirement ID`, `Test Type`, `Severity`, `Automation Status`, `Environment`, `Expected Result`, `Postconditions` (a file with any of these must also fill Prerequisite, Test Data and Expected Result on every row; the legacy 13-column file keeps its old rules; invalid enum values are per-row errors) (ADR-116); each row names its own project (ADR-021); enforces a 2,000-row cap, 5MB/`.csv`-only file validation, and per-project duplicate-title detection (ADR-035) | all (per-row: Admin/Manager tenant-wide, Tester must be assigned to that row's project) |
| POST | /test-cases/import/async | same validation, enqueues the import to the background job queue and returns a job id immediately instead of blocking the request (Tier 1, ADR-053) | all (same per-row rule as above) |
| GET | /test-cases/import/jobs/{job_id} | poll an async import job's status/result | all (own tenant's job only) |

## Test Execution (FR-EXEC)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /test-runs | one page of runs across every project the caller may see, newest first, as `{items, total}` (`items` are the same lightweight summaries, each with its `project_id`). Filters `project_id`, `active_only`; `page`, `page_size` (default 50, max 100). Admin and Manager: every project in the tenant; anyone else: projects they own or belong to; a `project_id` they may not open is 403. Soft-deleted runs are excluded (ADR-078) | all (assigned projects) |
| GET | /projects/{id}/test-runs | list runs for a project (lightweight summary, no per-case rollups) | all (assigned) |
| POST | /projects/{id}/test-runs | create run, bundle cases (pins versions) | all (assigned) |
| GET | /test-runs/{id} | run detail + case rollups | all (assigned) |
| PATCH | /test-runs/{id} | edit name/run_type; blocked once execution has started or run is finished (ADR-036) | all (assigned) |
| POST | /test-runs/{id}/cases | add approved test cases to an existing, unfinished run (ADR-036) | all (assigned) |
| DELETE | /test-runs/{id}/cases/{id} | remove a case; blocked if any of its steps are already opened (ADR-036) | all (assigned) |
| PATCH | /test-run-cases/{id}/assign | assign execution responsibility (ADR-036) | all (assigned) |
| POST | /test-runs/{id}/pause | pause a run; blocks further step open/verdict until resumed (ADR-036) | manager, admin |
| POST | /test-runs/{id}/resume | resume a paused run (ADR-036) | manager, admin |
| POST | /test-runs/{id}/finish | set finished_at, lock. A run also finishes **automatically** when every case is complete (blocked, or every step recorded and the case not failed — a failed case keeps the run open for the re-run after the fix); audit event `testrun.finished` carries `auto: true` (ADR-070) | manager, admin |
| POST | /test-runs/{id}/reopen | undo a finish: clears `finished_at` only (case statuses, verdicts and timings are untouched, and the run does not re-finish until the next verdict or block). 409 if the run is not finished; 404 for another tenant's or a soft-deleted run; audit event `testrun.reopened` with `previous_finished_at` (ADR-075) | manager, admin |
| POST | /test-runs/{id}/rerun-failed | create a new run with only this run's `failed` and `blocked` cases (open or finished source). Copies type, assignees and data rows, name `<name> (rerun)`, sets `original_run_id`; response is the new run. 409 when nothing failed or blocked; 403 `blocked_by_access_rule` during a freeze; 404 for another tenant's run; audit `testrun.rerun_created` (ADR-096) | `testrun.create`, project member |
| DELETE | /test-runs/{id} | **soft delete** (`deleted_at`/`deleted_by`); the run leaves lists, counts, dashboards and reports, data is retained and included in tenant exports; audit `testrun.deleted` (ADR-070) | testrun.delete (admin, manager) |
| POST | /test-run-cases/{id}/block | mark a run case **Blocked** with a required `reason` (3-1000 chars) and an optional `actual_result`; records `executed_by`/`executed_at`; same rights as recording a verdict (assignee for a Tester); 409 on a finished/paused run or an already-blocked case; verdicts/step-open are refused while blocked; audit `testrun.case_blocked` (ADR-070) | executionstep.record |
| POST | /test-run-cases/{id}/unblock | re-open a blocked case; status is recomputed from its step verdicts; 409 if not blocked or the run is finished; audit `testrun.case_unblocked` (ADR-070) with `blocked_seconds`; the time spent blocked is removed from the open step's timer by moving its `opened_at` forward (ADR-076) | executionstep.record |
| GET | /test-run-cases/{id}/context | run/project/case display context for the Execution Console (ADR-036) | all (assigned) |
| GET | /test-run-cases/{id}/steps | step list + current verdicts/timings | all (assigned) |
| POST | /execution-steps/{id}/open | mark step opened (starts timer); idempotent, rejects if run finished/paused | all (assigned) |
| POST | /execution-steps/{id}/verdict | pass\|fail\|ignore with an optional `actual_result` (10,000 chars; required for `fail` while `REQUIRE_ACTUAL_RESULT_ON_FAIL` is true, which is the default since ADR-117; set it to false for clients that cannot send the field). The run case gets `executed_by`/`executed_at` when it reaches passed or failed and carries the actual result; re-recording while the run is open replaces the step's current verdict and the audit event keeps the previous one (`changes: {verdict, actual_result, run_case_status}` from/to). Needs `executionstep.record` or `testcase.execute` (ADR-116). Closes timer, computes duration_ms; row-locked against concurrent sibling-step verdicts (ADR-036) | all (assigned) |

## Defect Management (FR-DEF)
Defects follow the 22-field standard (ADR-118): Bug ID (`BUG_000001`, immutable), title, description (Markdown), component / module, preconditions, steps to reproduce (structured), expected and actual result, attachments, environment, build found, severity, priority, status, resolution, root cause (+ notes), reporter, assignee, date reported, fix version, linked test cases and labels. Every response carries those fields (`display_id`, `repro_steps`, `labels`, `reporter`, `assignee`, `date_reported`, `attachment_count`, `linked_test_cases`, ...). Write permissions accept the new code OR its legacy equivalent, so no built-in role loses access.

The web UI built on these endpoints is described in ADR-119: the list sends `status`, `severity`, `priority` and `labels` as comma-separated values (the status tabs are fixed status sets: Open = every status except Closed and Rejected, Closed = Closed + Rejected), pages 50 at a time, exports with `columns=` for the shown columns and `ids=` for ticked rows, and saves `status` / `severity` / `priority` / `labels` as comma-separated tokens in a saved view (a view value may use letters, digits, spaces, an apostrophe and `_ . -` only, so Won't Fix can be stored, but a label with other characters, such as `/` or `:`, cannot be stored in a view filter). `GET /defects?test_run_id=` matches defects raised in that run or linked to one of its steps; a defect linked to a run case with `POST /test-run-cases/{id}/defects/{defect_id}` is listed by the `existing_defects` of that run case's defect draft.

| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /defects | filters: `project_id`, `status`, `severity`, `priority` and `labels` (each repeated or comma-separated, any-of; labels must all be present), `assignee_id`, `reported_by`, `module_id`, `test_case_id` (primary FK or link), `created_from`/`created_to`, `fix_version`, `environment` (contains), `resolution`, `search` (Bug ID, title, description snippet, exact label). `sort=field` or `-field` (`display_id`, `title`, `severity`, `priority`, `status`, `assignee`, `date_reported`, `created_at`, `fix_version`; severity, priority and status sort by rank; unknown = 422; default `-created_at`). Without `page_size` it returns a plain list capped at 5,000 rows (`X-Result-Truncated: true`; `test_run_id` applies here). With `page_size` (1-100, plus `page`) it returns `{items, total}`; `cursor` (empty = first page) switches to keyset paging for the default newest-first order only (ADR-078, ADR-113, ADR-118) | all (scoped: a Tester sees assigned projects) |
| GET | /defects/status-counts | `{counts: {status: n}, total}` for the matching defects under every filter except `status`; feeds the status tabs (ADR-078) | all (scoped) |
| GET | /defects/columns | the 22 fields (`key`, `label`, `type`, `group`, `sortable`, `filterable`, `editable`, `mandatory_on_create`, `default_visible`), the ten default columns (Bug ID, Title, Module, Severity, Priority, Status, Reporter, Assignee, Date Reported, Fix Version), sorts, filters, the 11 statuses with their allowed transitions, the 6 resolutions and the export column keys (ADR-118) | all |
| GET | /defects/export.csv, /defects/export.xlsx | all 22 fields (plus Root Cause Notes); `columns=` selects and orders (unknown or repeated key = 422), `ids=` exports the selected rows (max 2,000), every list filter and `sort` apply, at most 50,000 rows (narrow the filters otherwise), text cells that start with `= + - @` are prefixed with a quote. Tester scope applies (ADR-118) | `defect.export` |
| POST | /defects | create (standalone, `test_run_id`, `execution_step_id` or `test_run_case_id`); optional `Idempotency-Key` (ADR-040). **Mandatory (422 with `error.fields`, one message per field):** title, description, at least one repro step (`repro_steps: [{action, test_data?, expected_result?}]`, or the legacy `steps_to_reproduce` text, converted), expected result, actual result, environment (`environment` text or `environment_id`), severity, priority. Status defaults to New (`New`, or `Assigned` with an assignee); the reporter is the caller (never client-supplied) and the date is automatic. Optional: preconditions, `build_found`, `fix_version`, `labels` (trimmed, lower-cased, de-duplicated; max 20 of 40 characters), `module_id`, `assigned_to` (an active member of the project), `root_cause`, `root_cause_notes`, `test_case_id` / `test_case_ids` (linked on creation). From an execution the missing fields are derived (see defect-draft) and the defect is linked to its test case and run case; `copy_evidence` (default true) copies the execution's attachments by reference (ADR-118) | `defect.create` |
| GET | /defects/{id} | detail incl. links, execution evidence, linked test cases, test case version + traceability chain | all (scoped) |
| PATCH | /defects/{id} | edit any field of the standard except id, reporter, date and status (including expected / actual result, preconditions, repro steps, labels, build found, fix version, resolution, root cause notes). A mandatory field can only be blanked if the row had no value for it (legacy rows are never refused for what they already lack); per-field 422s. Changing the assignee also needs `defect.assign` (or `defect.close`). A Closed defect is locked (reopen first) | `defect.edit` or `defect.create` |
| GET | /defects/{id}/history | audit events of the defect; each carries `changes: {field: {from, to}}` for create, update, status, assignment, link / unlink, attachment add / remove and retest events | all (scoped) |
| PATCH | /defects/{id}/status | all 11 codes; checked against the transition table (409 listing the allowed next statuses) and the resolution rules (422); optional `resolution`, `comment`. Closed also needs `verification_confirmed: true` and `defect.close` (or the Admin / Manager tier) | `defect.change_status`, `defect.create` or `defect.close`; Closed / Reopened: `defect.close` or Admin / Manager |
| POST | /defects/{id}/reopen | moves a Fixed / Retest / Verified / Rejected / Closed defect to **Reopened** (count, date, resolution cleared) | `defect.close` or Admin / Manager |
| POST | /defects/{id}/retest | a Fixed (or Retest) defect: creates a test run of type `Retest` with the linked test cases (current versions), run cases assigned to the reporter or `tester_id` (an active project member), the defect linked to each run case; a Fixed defect moves to Retest; audit `defect.retest_started` | `defect.change_status` |
| POST | /defects/{id}/retest-result | body `{result: pass\|fail, run_case_id, comment?}` for a defect in Retest and a run case of its Retest run whose status matches (passed / failed). **pass:** Closed with resolution Fixed when the caller may close defects, otherwise Verified; **fail:** Reopened (`reopened_count` + 1, assignee and reporter notified, the failure text appended to the actual result). The run case is never modified; audit `defect.retest_result` | `defect.change_status` |
| GET | /defects/{id}/retests | every retest (one entry per run case of a Retest run) with run, status, tester, date and recorded result | all (scoped) |
| GET | /defects/{id}/test-cases | linked test cases from both link models: `display_id`, `title`, `module_name`, `module_path`, `is_primary`, latest execution status / date / tester / run, `raised_from_run_case_id`. Tester scope (assigned cases only, when enabled) applies | all (scoped) |
| POST | /defects/{id}/test-cases/{test_case_id} | link a test case (idempotent: `link_created`); it must exist, not be deleted and belong to the defect's project; audit `defect.link_added` with before / after | `defect.edit` or `defect.create` |
| DELETE | /defects/{id}/test-cases/{test_case_id} | unlink (idempotent; clears the primary FK when it is that case); audit `defect.link_removed` | `defect.edit` or `defect.create` |
| POST | /defects/{id}/links | generic link (`execution_step`, `defect`, `test_case`, `test_run_case`); the target must exist in the defect's project; idempotent | `defect.edit` or `defect.create` |
| DELETE | /defects/{id}/links/{link_id} | remove one link row (idempotent); audited | `defect.edit` or `defect.create` |
| PATCH | /defects/{id}/root-cause, /environment, /build-release | classification shortcuts, audited with from / to | `defect.edit` or `defect.create` |
| DELETE | /defects/{id} | **soft delete**; the defect leaves lists, counts, dashboards and reports, row/links/history retained and included in tenant exports; audit `defect.deleted` (ADR-070) | defect.delete (admin, manager; project-scoped role overrides apply) |
| GET | /test-cases/{id}/defects | the defects of a case from the same unified source: `display_id`, `title`, `status`, `severity`, `priority`, assignee | all (scoped) |
| GET | /test-run-cases/{id}/defect-draft | a prefilled defect for a failed execution (nothing stored): title `TC_000012 – <title> failed`, module, preconditions, steps up to and including the failing one (flagged `failed`), expected (the failing step's, else the case's), actual (the execution's actual result), environment (the case's; a run has no environment of its own), tester, date, the evidence attachments, and the defects already linked to this run case | all (assigned to the project) |
| POST | /test-run-cases/{id}/defects/{defect_id} | link an existing defect of the same project to this run case (and its test case); idempotent | `defect.edit` or `defect.create` |
| GET | /defects/import-template.xlsx | ADR-120: the standard import template: the 22 catalogue headers (+ Root Cause Notes), an example row, Instructions and Allowed values sheets (statuses with their resolution rules) with dropdown validation | `defect.import` or `defect.create` |
| GET | /defects/import-template.csv | same headers and example row as csv | `defect.import` or `defect.create` |
| POST | /defects/import/preview | as the test case preview (multipart `file` + `project_id`): mandatory fields, enums, status and resolution rules, assignee (a project member, needs `defect.assign`), linked test case ids, labels, module paths; nothing is written | `defect.import` or `defect.create` |
| GET | /defects/import/preview/{token}/rows | pages the stored preview | same |
| POST | /defects/import/commit | `{token, mode}` as for test cases; statuses other than New / Assigned need `defect.change_status` or `defect.close`, Closed / Rejected need the close permission | same |
| GET | /defects/import/status/{job_id} | the async commit job of the caller | same |
| POST | /defects/import | CSV import: the 11 legacy columns, optionally followed by Bug ID, Preconditions, Build Found, Fix Version, Labels (`;` separated), Linked Test Case IDs (display ids of the row's project), Root Cause, Root Cause Notes. A file using any of them must also fill steps, expected, actual and environment on every row. A Bug ID is kept only when well formed, unused and not repeated, otherwise the next id is assigned and the counter moves past the kept ids (ADR-118) | `defect.import` or `defect.create` |

Status workflow (ADR-118). Allowed next statuses: New: Assigned, In Progress, Rejected, Deferred, Open; Open: Assigned, In Progress, Fixed, Rejected, Deferred; Assigned: In Progress, Rejected, Deferred; In Progress: Fixed, Deferred, Assigned, Rejected; Fixed: Retest, Reopened, Verified; Retest: Closed, Reopened, Verified; Reopened: Assigned, In Progress, Fixed; Verified: Closed, Reopened; Deferred: Assigned, In Progress, New, Closed; Rejected: Reopened, Closed; Closed: Reopened. Resolution by status: New, Open, Assigned, In Progress, Retest and Reopened carry none (a move into them clears it; sending one is 422); Fixed defaults to Fixed; Verified may carry Fixed; Rejected needs Duplicate, Won't Fix, Cannot Reproduce, By Design or Not Applicable; Deferred may carry Won't Fix, By Design or Not Applicable; Closed needs one of the six (defaults to Fixed when coming from Fixed / Retest / Verified).

## Reporting & Dashboard (FR-REP, FR-DASH)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /dashboard/summary | KPI cards incl. active projects, approved test case count, critical defect count (ADR-038). Optional `project_id` narrows every figure to that one project, still limited to what the caller may see (a project outside their scope gives zeros) (ADR-079) | all (scoped) |
| GET | /dashboard/domain-distribution | FR-DASH-002 chart data, now incl. per-domain pass percentage (ADR-038) | all (scoped) |
| GET | /dashboard/activity-stream | last 10 actions. Optional `project_id` keeps only events whose entity belongs to that project, found among the latest 200 tenant events, so a quiet project can show fewer than 10; empty for a project the caller may not see (ADR-079) | all (scoped) |
| GET | /reports/aggregate | multi-axis pivot (metric, groupBy); metric now incl. `test_case_status`, `defect_root_cause` (Phase 6, ADR-048); accepts `project_id`/`domain`/`assignee_id`/`date_from`/`date_to`/`priority`/`status` filters (ADR-038) | all (scoped; restricted for tester) |
| GET | /reports/execution-trend | daily pass/fail/ignore step-verdict counts over a trailing window (`days`, default 30), optional `project_id` (ADR-038) | all (scoped) |
| GET | /reports/defect-trend | daily opened-vs-closed defect counts over a trailing window (`days`, default 30), optional `project_id` (Phase 6, ADR-048, GAP-77) | all (scoped) |
| GET | /reports/defect-aging | per-severity open-defect count + SLA-breach count, optional `project_id` (Phase 6, ADR-048, GAP-77) | all (scoped) |
| GET | /reports/defect-leakage | defect leakage and test effectiveness (ADR-097): `project_id`, `date_from`, `date_to` optional. Returns total/escaped defects, `leakage_percentage` and `detection_effectiveness_percentage` (null when no defects), `open_escaped_defects` with `open_escaped_age_buckets`, `escaped_by_severity`, `quarantined_test_cases`, per-release `releases` and monthly `trend`. Escaped = linked to a release dated today or earlier, or environment named production/prod | `report.view`; 403 for a Tester when Reports are hidden or the project is not theirs |
| GET | /reports/defect-leakage/export.xlsx | same data as an Excel workbook (Defect Leakage and By Release sheets) | `report.view` |
| GET | /reports/compliance-detail | structured JSON compliance report (summary + per-project detailed test case/defect tables), optional `period_from`/`period_to` — backs the browser print/PDF view (ADR-038) | manager, admin |
| GET | /reports/compliance-export | CSV compliance summary, now incl. a Reporting Period header row and per-project detailed test case/defect tables, optional `period_from`/`period_to` (ADR-038) | manager, admin |
| GET | /reports/compliance-export.xlsx | compliance summary as an Excel workbook (Compliance Summary, Period Trend, Quality Metrics, Cycle Time by Project sheets), optional `period_from`/`period_to` (ADR-071) | manager, admin (report.compliance_export) |
| GET | /reports/aggregate/export.xlsx | the aggregate pivot as an Excel workbook (Report + Data sheets, applied filters listed); same query params as /reports/aggregate (ADR-071) | report.view (scoped) |
| GET | /reports/traceability-matrix/export.xlsx | traceability matrix as an Excel workbook, `project_id` (ADR-071) | report.view |
| GET | /reports/quality-metrics | BRD success metrics from real data: step-level defect precision, average cycle time (overall and per project), step pass rate, review-gate coverage; `days` (1-365, default 30), `project_id`, `run_type` (Regression default, Sanity, Smoke, all); ratios are `null` when there is nothing to measure (ADR-071) | report.view (scoped) |
| GET | /reports/quality-metrics/export.xlsx | quality metrics as an Excel workbook; same params (ADR-071) | report.view (scoped) |

## Administration & Audit (FR-ADM-002)
| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /audit-logs | filterable (action, entity_type, entity_id, user_id, date_from, date_to), paginated (max 200/page), full record incl. metadata/prev_hash (ADR-029, ADR-039), read-only | admin (`audit.view`) |
| GET | /audit-logs/export | CSV export of the full (unpaginated, capped at 50k rows) filtered audit trail — same filters as the list endpoint (ADR-039) | admin (`audit.view`) |
| GET | /audit-logs/verify-chain | re-walks and recomputes the full hash chain server-side (streamed, flat memory), then checks the signed checkpoints; optional `?since_checkpoint=true` starts after the newest verified checkpoint and reports `skipped_count` (ADR-087); returns valid/checked_count/broken_at_id plus `checkpoints_checked` and `checkpoint_failure` (`null` or `{checkpoint_id, reason}`, reason one of `signature_invalid`, `anchor_missing`, `anchor_hash_mismatch`, `count_mismatch`, `checkpoint_chain_broken`); `valid` is false if either part fails (ADR-029, ADR-085) | admin (`audit.view`) |
| GET | /audit-logs/checkpoints | the tenant's signed audit checkpoints, oldest first; the scope is always the caller's own tenant (ADR-085) | admin (`audit.view`) |
| POST | /audit-logs/checkpoints | anchors the tenant chain head in a new HMAC-signed checkpoint; returns `{created, reason, checkpoint}` (`created=false`, `reason="no_new_events"` when unchanged); 409 if the chain or an earlier checkpoint already fails verification (ADR-085) | admin (`audit.view`) |
| GET | /audit-logs/checkpoints/export | the tenant's checkpoints as a downloadable JSON document `{scope, exported_at, checkpoints}` (hashes, counts and ids only) for off-box storage (ADR-085) | admin (`audit.view`) |
| GET | /settings | tenant self-service settings (`default_currency_code`, `default_timezone`, `ai_enabled`, `ai_provider`, `ai_api_key_configured`, `ip_allowlist`, `primary_domain`) (AI/SaaS roadmap Phase 1/3, ADR-043/ADR-045, GAP-80/GAP-72; `ip_allowlist` is Tier 4, ADR-054, PV-11.3) | admin (`tenant.settings.manage`) |
| PATCH | /settings | update tenant settings; partial updates supported, audit-logged (`tenant.settings_updated`); `ai_api_key` is write-only (never returned), `""` clears it; enabling AI requires a key already configured; `ip_allowlist` is a full replace (CIDR list, `[]` clears it); `primary_domain` (ADR-073): send a value to set it, `null` to clear it, omit it to leave it unchanged (an unknown value is a 422); the change is recorded in the audit event as `{from, to}` | admin (`tenant.settings.manage`) |
| GET | /settings/subscription | read-only view of the tenant's current plan/status/seat count — assignment is platform-admin-only (Tier 1, ADR-053) | admin (`tenant.settings.manage`) |
| GET | /settings/branding | tenant branding (`display_name`, `primary_color`, `has_logo`, `primary_domain`) (Tier 4, ADR-054, PV-11.4; `primary_domain` added by ADR-073 because every member's New Project form reads it) | all (authenticated) |
| PUT | /settings/branding | update display name/primary color | admin (`tenant.settings.manage`) |
| POST | /settings/branding/logo | multipart upload of a PNG/JPEG/SVG/WebP logo (2MB cap), stored via the Tier 1 storage abstraction | admin (`tenant.settings.manage`) |
| GET | /settings/branding/logo | stream the uploaded logo bytes | all (authenticated) |
| POST | /export | enqueue a tenant-wide data export job (zip of every entity's raw rows + manifest), via the Tier 1 background job queue (Tier 4, ADR-054, PV-11.5) | admin (`tenant.settings.manage`) |
| GET | /export/jobs/{id} | poll export job status/result | admin (`tenant.settings.manage`) |
| GET | /export/jobs/{id}/download | download the finished export archive | admin (`tenant.settings.manage`) |
| GET | /auth/sso/{tenant_id}/status | public: whether this tenant has SSO enabled (no issuer/client details exposed) (Tier 4, ADR-054, PV-11.1) | public |
| GET | /auth/sso/{tenant_id}/login | redirect to the tenant's configured OIDC authorization endpoint | public |
| GET | /auth/sso/{tenant_id}/callback | OIDC authorization-code callback; provisions/logs in the user, bypasses this app's own MFA (ADR-054) | public |
| GET | /sso/config | tenant SSO configuration (issuer/client_id, never the secret) | admin (`sso.manage`) |
| PUT | /sso/config | create/update SSO configuration (OIDC only — no SAML, ADR-054) | admin (`sso.manage`) |
| POST | /scim-tokens | create a new per-tenant SCIM bearer token (shown once) (Tier 4, ADR-054, PV-11.2) | admin (`sso.manage`) |
| GET | /scim-tokens | list this tenant's SCIM tokens (metadata only) | admin (`sso.manage`) |
| DELETE | /scim-tokens/{id} | revoke a SCIM token | admin (`sso.manage`) |
| GET/POST/PUT/PATCH/DELETE | /scim/v2/{tenant_id}/Users[/{id}] | minimal SCIM 2.0 server, Users only, bearer-token authenticated (not session-cookie); DELETE deactivates, never hard-deletes (ADR-054) | SCIM bearer token |
| PATCH | /platform/tenants/{id}/data-region | set a tenant's data-residency metadata (`us`/`eu`/`apac`/...); readiness only, no per-region deployment exists (Tier 4, ADR-054, PV-11.6, see `docs/DATA_RESIDENCY.md`) | platform admin |

## Access rules: release freezes and environment restrictions (ADR-092)
Off by default. `access_rule.manage` is Admin only. Blocked mutations return `403` with error code `blocked_by_access_rule` and the rule's reason as the message.

| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /access-rules | list the tenant's rules | admin (`access_rule.manage`) |
| POST | /access-rules | create a rule: `name`, `rule_type` (`freeze_window` or `environment_restriction`), optional `project_id`, `environment` (required for environment restrictions), `starts_at`/`ends_at` (timezone-aware, stored UTC; both required for a freeze, optional allowed window for an environment rule), `blocked_actions` (permission codes or prefixes, validated), `exempt_roles` (`admin` is always kept), `reason`, `enabled` | admin (`access_rule.manage`) |
| GET | /access-rules/{id} | one rule | admin (`access_rule.manage`) |
| PATCH | /access-rules/{id} | change any field (send null to clear `project_id` or a window bound); toggling `enabled` is audited as enabled/disabled | admin (`access_rule.manage`) |
| DELETE | /access-rules/{id} | delete a rule | admin (`access_rule.manage`) |
| POST | /access-rules/preview | dry run: would `action_code` for `role_code` (optionally `project_id`, `environment`, `at`) be blocked, and by which rule id and reason | admin (`access_rule.manage`) |
| GET | /access-rules/active | only the rules restricting the caller's own role right now (`reason`, `ends_at`, `blocked_actions`), for UI banners; an Admin always gets an empty list | any signed-in user |

## Documentation and User Guide (ADR-089, ADR-114)
Tenant `GET /docs` and `GET /docs/{slug}` were removed (404 for every caller); documentation is read through the platform console only.

| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | /user-guide | the User Guide as ordered sections `{sections: [{id, title, audience, markdown}]}`, filtered by the caller's permissions: `getting-started` and `tester` for everyone, `manager` needs `project.view.all`, `admin` needs `tenant.settings.manage`. Sections the caller may not read are not listed. `Cache-Control: private, no-store`; rate-limited | any signed-in user |
| GET | /platform/docs | every registered document (no audience filter): `{groups: [{id, title}], documents: [{slug, title, description, group, audience, min_level, source}]}`. `Cache-Control: private, no-store`; rate-limited | platform session (`mfa_verified`) |
| GET | /platform/docs/{slug} | one document: the summary fields plus `content` (Markdown). 404 for an unknown slug, 422 for a slug that is not lowercase letters, digits and hyphens (path-traversal attempts). `Cache-Control: private, no-store`; rate-limited | platform session (`mfa_verified`) |

## Tester visibility switches (ADR-093)

| Method | Path | Notes | Access |
|---|---|---|---|
| GET/PATCH | /settings | two extra booleans, both default `false`: `testers_see_assigned_cases_only` (a Tester sees only cases assigned to them, in runs assigned to them or started by them), `reports_hidden_from_testers` (a Tester gets 403 from every `/reports/*` endpoint). Each change is audited as `tenant.setting_changed` with `{key, value}` | admin (`tenant.settings.manage`) |
| GET | /auth/me | adds `tester_case_scope` and `reports_hidden`, effective for the caller (always false for Manager/Admin) | any signed-in user |

With the case switch on, a Tester gets 404 (not 403) for a case outside their scope on detail, history, versions, attachments and comments, and the case is left out of `/test-cases`, `/projects/{id}/test-cases` (totals and paging included), `/search`, module counts, requirement detail, the CSV/XLSX export and the dashboard counts. `/dashboard/*` stays open to Testers when Reports are hidden.

## Report builder (ADR-098)

All routes need `report.view` and return 403 to a Tester when Reports are hidden (ADR-093). Definition: `{source: test_cases|test_runs|defects, fields[], filters[{field, op, value}], group_by[], sort{field, dir}}`; unknown keys, fields, operators or wrongly typed values are 422. Limits: 12 fields, 8 filters, 2 group-by, 8KB definition, page size 100, export 5000 rows, 50 saved reports per user, 10s statement timeout.

| Method | Path | Purpose |
|---|---|---|
| GET | /report-builder/sources | the allowlist: per source the fields with type, operators, sortable, groupable, options |
| POST | /report-builder/preview | `{definition, page, page_size}` returns `{columns, rows, total, page, page_size}` |
| GET | /report-builder/reports | the caller's reports plus reports shared by others |
| POST | /report-builder/reports | `{name (1-80), definition, is_shared}`; 409 for a duplicate name or the 50 limit; audit `report.saved` |
| GET / PATCH / DELETE | /report-builder/reports/{id} | read; edit or delete (owner or Admin only, else 403; a private report of someone else is 404); audit `report.saved` / `report.deleted` |
| POST | /report-builder/reports/{id}/run?page=&page_size= | run the saved definition with the caller's own visibility |
| GET | /report-builder/reports/{id}/export.csv, export.xlsx | up to 5000 rows; formula-injection safe; audit `report.exported` |

## Custom dashboards (ADR-099)

Any signed-in user. A dashboard of another user is 404. The team default is readable by everyone and writable only with `tenant.settings.manage`. Widget types: kpi_summary, execution_trend, status_distribution, defect_aging, open_defects_by_severity, release_readiness, defect_leakage, flaky_tests, recent_activity, saved_report, my_assigned_cases; settings are validated per type and unknown keys are 422. Limits: 10 dashboards per user, 12 widgets, 1 KB settings.

| Method | Path | Purpose |
|---|---|---|
| GET | /dashboards | the caller's dashboards plus the team default, with `widget_count`, `is_team_default`, `can_edit` |
| POST | /dashboards | `{name (1-60)}`; 409 at the 10 limit; audit `dashboard.created` |
| GET | /dashboards/{id} | dashboard with ordered `widgets[{id, widget_type, size S/M/L, position, settings, project_access ok/denied}]` |
| PATCH | /dashboards/{id} | `{name}`; own only (team default: Admin only, else 403) |
| DELETE | /dashboards/{id} | own only (team default: Admin only); audit `dashboard.deleted` |
| PUT | /dashboards/{id}/widgets | `{widgets[{widget_type, size, settings}]}` replaces the whole ordered list atomically; 422 on a bad type, size, setting, unknown key, invisible project or unknown saved report |
| POST | /dashboards/{id}/team-default | Admin only. `{enabled: true}` publishes a copy of the dashboard as the single team default (replacing any previous one); `{enabled: false}` on the team default removes it; audit `dashboard.team_default_set` |

## My Work (ADR-121)

Read-only, scoped to the caller. Any signed-in user may call them (no permission code); they only return the caller's own assignments, filtered by the same project visibility as the run and test case lists (Admin and Manager: every project; others: projects they own or belong to; a Tester with the case-scope switch also only sees the cases that scope allows). Nothing is stored. Defects on the My Work page reuse `GET /defects` with `assignee_id` and `reported_by`.

| Method | Path | Purpose |
|---|---|---|
| GET | /my-work/summary | counts for the sidebar badge and the tab labels: `run_cases_pending, run_cases_in_progress, run_cases_failed, run_cases_blocked, run_cases_total, reviews_total` |
| GET | /my-work/run-cases | `{items, total}` (at most 200 items): run cases assigned to the caller in an unfinished, undeleted run with status pending, in_progress, failed or blocked; each has `id, run_id, run_name, run_paused, project_id, project_name, test_case_id, test_case_display_id, title, status, blocked_reason, started_at`; ordered in progress, failed, blocked, pending |
| GET | /my-work/reviews | `{items, total}` (at most 200): test cases in `ready_for_review` whose `reviewer_id` is the caller; `id, display_id, title, priority, project_id, project_name, created_at` |

## Saved views (ADR-096)

Private per-user filter sets for the Test Cases, Defects and Test Runs lists. Any signed-in user; only the owner's views are visible (another user's id is 404). Rate limited.

| Method | Path | Purpose |
|---|---|---|
| GET | /saved-views?list_key= | the caller's views, optionally for one list (`test_cases`, `defects`, `test_runs`) |
| POST | /saved-views | `{list_key, name (1-60), filters, sort?, columns?, is_default?}`. `columns` (ADR-117) is an ordered list of up to 40 column keys (lower-case letters, digits, underscore; de-duplicated; stored and returned as `columns`, null when not set). 422 for an unknown filter key, wrong value type, bad sort, a malformed `columns` list or filters over 2KB; 409 for a duplicate name or more than 25 views for that list |
| PATCH | /saved-views/{id} | rename, change filters, sort or `columns` (send `null` to clear them), set or clear `is_default` (setting it clears the previous default for that list) |
| DELETE | /saved-views/{id} | delete |

Allowed filter keys (string values): test_cases `search, priority, status, assigneeId, moduleId` (+ `sort` such as `title` or `-priority`); defects `projectId, status, severity, priority, labels` (comma-separated lists), `reportedBy, assigneeId, moduleId, testCaseId, createdFrom, createdTo, fixVersion, environment, resolution, search` (+ `sort`: `display_id`, `title`, `severity`, `priority`, `status`, `assignee`, `date_reported`, `created_at`, `fix_version`, optionally `-` prefixed; `columns` as for test cases); test_runs `projectId, activeOnly` (`true`/`false`).

Additions in ADR-097: the test case list endpoints take `quarantined=any|only|exclude` and every case payload carries `quarantined`, `quarantine_reason`, `quarantined_at`; run creation (`/projects/{id}/test-runs`, `/test-suites/{id}/create-run`, `/test-runs/{id}/cases`) takes `exclude_quarantined` (default false); `/reports/release-readiness` returns `quarantined_count`; `/reports/flaky-tests` rows return `quarantined`. Saved views for test_cases also accept the filter key `quarantined`.
