# Architecture Decision Records (ADR)

Status legend: **Decided** (binding for implementation), **Open** (needs stakeholder sign-off before the affected module is built).

BRD source: BRD-QTH-INS-2026-V2.4. These ADRs resolve ambiguities in that document per the architecture-review notes supplied alongside it. None of these change business intent; they fix *how* an ambiguous or under-specified requirement is implemented.

---

## ADR-001: Test case lifecycle split into authoring/approval vs. execution state
**Status:** Decided

The BRD (FR-TC-001, §7.2) lists `Draft, Ready for Review, Approved, In Progress, Assigned, Passed, Failed, Blocked` as one lifecycle, but these are two different concerns: the *document* (is this test case trustworthy enough to run) and *a specific execution of it in a run* (did it pass this time).

**Decision:**
- `test_cases.status` (authoring/approval, governs FR-TC-003 approval gate): `draft`, `ready_for_review`, `approved`, `deprecated`.
- `test_run_cases.status` (per-run execution verdict, FR-EXEC-001): `pending`, `in_progress`, `passed`, `failed`, `blocked`, `ignored`.
- A test case can be `approved` and simultaneously have many `test_run_cases` rows in different states across concurrent/historical runs.
- Editing an `approved` test case creates a new `test_case_versions` row (see ADR-003) and does not change `status` unless the manager explicitly re-drafts it.

## ADR-002: Step references use foreign keys, not raw array indices
**Status:** Decided

The BRD uses 1-based `order` for `TestStep` but a 0-based example (`stepIndex: 2` for "Step 3") for defect linkage — a direct contradiction if indices are used as the join key.

**Decision:** Steps are rows, not array members. `test_case_version_steps.id` (UUID) is the join key everywhere a step must be referenced (`execution_steps.test_case_version_step_id`, `defects.test_case_version_step_id`). `step_number` is retained purely as a **1-based, human-facing display/ordering column** (matches BRD `order` field) and is never used as a lookup key. This eliminates the off-by-one ambiguity entirely rather than picking a side.

## ADR-003: Immutable test case versioning with execution pinning
**Status:** Decided

**Decision:** Every approval-worthy edit to an approved test case writes a new immutable row to `test_case_versions` (+ `test_case_version_steps` snapshot of all steps at that point), and `test_cases.current_version_id` advances. A `test_run_case` stores `test_case_version_id` captured **at run-case creation time**, so historical executions always report against the exact step text that was actually run, even if the test case is edited or re-approved later. `history` as a loose JSON blob (as the BRD literally describes) is rejected in favor of normalized version rows — required for FR-DEF compliance-grade traceability (defect → exact version → exact step).

## ADR-004: Execution state is normalized, not a single JSON blob
**Status:** Decided

The BRD's `TestRun.results` / `stepResults` / `executionTimes` maps are a denormalized, single-document shape. Per the supplied architecture guidance, this is explicitly rejected for the relational implementation.

**Decision:** Four normalized entities: `test_runs` (the cycle) → `test_run_cases` (one row per test case bundled into the run, carries the pinned `test_case_version_id` and rollup `status`) → `execution_steps` (one row per step per run-case, carries verdict `pass|fail|ignore`, `duration_ms`, `executed_by`, `executed_at`). This is required for concurrent execution safety, step-level reporting (FR-REP-001), and because a single wide JSON column cannot be indexed or queried efficiently at the volumes implied by FR-TC-002 (2,000+ cases).

## ADR-005: Defect-step linkage is many-to-many via a join table
**Status:** Decided

BRD FR-EXEC-003 implies one defect per failed step, but FR-DEF-002 and real triage practice require multiple defects to reference one step (duplicate reports) and, less commonly, one root-cause defect to span several steps/cases.

**Decision:** `defects` holds the primary context (`project_id`, `test_case_id`, `test_run_id`, `reported_by`, etc.) for the defect that was created *from* a specific execution event. `defect_links` is a separate join table (`defect_id`, `linkable_type`, `linkable_id`) enabling a defect to additionally reference other `execution_steps`, `test_cases`, or other `defects` (duplicate-of) without losing the original creation context. The "pill badge on the failed step" (FR-EXEC-003) is rendered from `execution_steps.id -> defect_links`, not from a single FK column on the step.

## ADR-006: Audit log is insert-only with hash chaining, not provably tamper-proof against DBAs
**Status:** Decided — residual risk tracked in KNOWN_GAPS

**Decision:** `audit_logs` rows are never updated or deleted by any application code path (no UPDATE/DELETE route exists in the service layer). Each row stores `prev_hash` and `record_hash = sha256(prev_hash || canonical_json(row))`, forming a hash chain per tenant, enabling detection of row tampering or deletion-by-renumbering. Database grants additionally `REVOKE UPDATE, DELETE` on `audit_logs` for the application role; only a separate, non-application migration role can alter the table. **This mitigates but does not cryptographically prevent** tampering by someone holding raw superuser/DBA credentials — that requires external WORM log shipping (e.g., write-once object storage) which is out of scope for this phase and recorded in `KNOWN_GAPS.md`.

## ADR-007: Tenant isolation enforced at both ORM query layer and PostgreSQL RLS
**Status:** Decided

**Decision:** `tenant_id` is never accepted from request payloads; it is derived server-side from the authenticated session on every request. Two independent layers enforce isolation so a bug in one does not cause a breach:
1. **Application layer:** a SQLAlchemy base repository that injects `WHERE tenant_id = :session_tenant_id` on every tenant-scoped query automatically.
2. **Database layer:** PostgreSQL Row-Level Security policies on every tenant-owned table, keyed to a `current_setting('app.current_tenant')` session variable set by the backend at the start of each request's DB transaction.
Platform-level tables (`tenants`, platform superuser accounts) are exempt from RLS and are only reachable via a separate Platform Administration API surface (see ADR-008).

**Addendum (migration `567fa7545de9`):** the policy predicate must be `tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid`, not a bare cast. A custom GUC placeholder that has only ever been set via `set_config(..., true)` (transaction-local) reverts to `''` — not `NULL` — once that transaction commits, so a bare `::uuid` cast throws `invalid_text_representation` on the next transaction instead of just failing the predicate (deny). `NULLIF(..., '')` converts the empty string to `NULL` first, so the comparison safely evaluates to `NULL`/false (default-deny) as intended.

**Addendum (SQLAlchemy session config):** `app.current_tenant` is transaction-LOCAL by construction (`set_config(..., true)`), so it does not survive past a `db.commit()`. `SessionLocal` is therefore created with `expire_on_commit=False` (`app/core/db.py`): the common service pattern — do work, `commit()` once, then have the route build a response from the same already-loaded objects — must not trigger a post-commit attribute refresh, because that refresh would run in a new transaction with no tenant context and RLS would deny it. Any service that truly needs to re-query after a commit must re-call `set_tenant_context` first.

**Addendum (Phase 6, recurring gotcha — read this before writing any read-after-write logic in a service):** `SessionLocal` also sets `autoflush=False`. A Python-side attribute assignment on an ORM object (e.g. `step.verdict = "fail"`) is **not** visible to a subsequent `db.execute(select(...))` in the same session unless something flushes first — the SELECT reads what's still committed in the database, not the pending in-memory change. This bit `execution_service.record_verdict()`: it set `step.verdict` then immediately called a helper that re-queried all of that case's step verdicts to recompute the case's rollup status, silently using the *previous* verdict and producing a wrong status. **Rule of thumb:** after mutating an object's columns, call `db.flush()` before any subsequent same-transaction query whose result depends on that mutation — don't rely on autoflush, it's off.

**Addendum (Phase 4, recurring gotcha — read this before writing any new `to_out`/serializer):** `expire_on_commit=False` only protects *attribute access* on already-loaded objects — it does **not** help a serializer that issues a **new** query against another RLS-protected table after a commit (e.g. building a `TestCaseOut` by querying `test_case_versions`/`test_case_version_steps` fresh, after the service that created the case already committed). That new query runs in a new transaction with no tenant context and RLS silently returns zero rows (`NoResultFound`/empty list), not an error that points at the cause. **Rule of thumb:** any `to_out()`/serializer function that itself queries an RLS-protected table must re-assert `set_tenant_context(db, str(<tenant_id known from the already-loaded object>))` as its first line, unconditionally — it's cheap (one `SELECT set_config`) and correct whether or not a commit happened in between. `project_service.to_out` escaped this only because `project_members` (its one extra query) happens to be RLS-exempt by omission, not by design — don't rely on that; prefer the explicit re-assertion in every new serializer.

## ADR-008: First-tenant-admin bootstrap via a Platform Owner role, outside tenant RBAC
**Status:** Decided

The BRD's RBAC matrix only defines `Admin/Manager/Tester` *within* a tenant, but someone must create tenant #1's first Admin, and the BRD says only "Admin" can create tenants (circular for tenant zero).

**Decision:** Introduce a `platform_owner` concept (a flag on a user row with no `tenant_id`, or a small dedicated `platform_admins` table — finalized in DATABASE_SCHEMA.md) used exclusively by the Platform Administration surface. A platform owner can create a tenant and provision its first tenant Admin user. Platform owners cannot access any tenant's test/project data — they are provisioning-only, keeping the "all insurance data is tenant-scoped" guarantee intact. Seeded via a one-time migration/CLI command, not a public signup form.

## ADR-009: GDPR/CCPA erasure reconciled with immutable audit trail via pseudonymization
**Status:** Decided

**Decision:** "Right to be forgotten" purges PII (`name`, `email`, free-text fields that may contain PII) from `users` and from the human-readable fields of historical `audit_logs`/`defects`/etc. by replacing them with a stable pseudonym (`user_<uuid>`), while the row itself, its `user_id` FK, timestamp, and action type are retained. The hash chain (ADR-006) is computed over a canonical form that already excludes mutable PII fields, so pseudonymization does not break chain verification. Full physical deletion of a user row is only permitted if the tenant has zero retained audit/compliance obligations for that user — flagged `KNOWN_GAPS` pending legal sign-off on retention periods per jurisdiction.

## ADR-010: Offline-first claim reinterpreted as resilient synchronous writes, not disconnected operation
**Status:** Decided

The BRD simultaneously requires "offline-first local storage" and "cloud-native multi-tenant" with no sync protocol defined — these are incompatible as literally written for a shared multi-tenant Postgres backend.

**Decision:** The product is server-authoritative (PostgreSQL is the single source of truth, per the stated constraint in the master prompt). "Offline-first" is satisfied as: (a) every execution-step toggle (FR-EXEC-002) is written synchronously to the backend immediately, with sub-50ms perceived latency via optimistic UI update + background confirm; (b) in-progress, not-yet-submitted form state (e.g., a defect being drafted) is held in browser storage only as a recovery buffer against accidental tab close, per the explicit "browser storage only for temporary UI state" engineering principle. True disconnected (no network) operation is **out of scope** for this phase; see `KNOWN_GAPS.md`.

## ADR-011: MFA implemented as a real, configurable mechanism; "simulation" means test-mode only
**Status:** Decided

**Decision:** `mfa_challenges` implements a genuine 6-digit TOTP-or-OTP challenge per FR-AUTH-003 (code, expiry, attempt counter, lockout after 3 failures). A per-tenant/per-environment config flag (`mfa_delivery_mode: real | simulated`) controls whether the code is actually sent via an email/SMS provider or simply logged/returned in non-production environments for test automation — the data model and enforcement logic are identical either way. No push-notification or hardware-key MFA in this phase.

## ADR-012: Attachments stored on disk/object storage, not as Base64 in PostgreSQL
**Status:** Decided

The BRD's `Attachment.data: string (Base64 data URL)` is rejected for storage (bloats the DB, breaks backup/restore performance, contradicts the engineering principle against storing blobs as the "primary database" content).

**Decision:** Client may still *upload* as Base64 or multipart; the backend decodes and writes bytes to a filesystem path (local volume now, swappable for object storage later per the "File Storage: local filesystem initially" stack note) and stores only `attachments(id, tenant_id, owner_type, owner_id, file_name, mime_type, storage_path, size_bytes, checksum, uploaded_by, uploaded_at)` in PostgreSQL.

## ADR-013: Currency, numeric precision, date/time conventions
**Status:** Decided

**Decision:** `projects.budget` is `NUMERIC(14,2)` plus a required `projects.currency_code CHAR(3)` (ISO 4217), defaulted from a per-tenant setting — never a bare float. All instants (`created_at`, `executed_at`, audit timestamps) are `TIMESTAMPTZ` stored in UTC; all calendar-only fields (`start_date`, `end_date`) are `DATE` with no timezone, interpreted in the tenant's configured timezone for display only. Millisecond execution timings (FR-EXEC-002/BR-09) are stored as `INTEGER duration_ms`, computed server-side from step-open/step-close `TIMESTAMPTZ` pairs rather than trusting a client-reported duration.

## ADR-015: `sessions` and `mfa_challenges` are exempt from tenant RLS
**Status:** Decided

Resolving a session cookie into a user requires looking the row up **before** the tenant is known — but ADR-007's RLS policy requires `app.current_tenant` to already be set to read any tenant-scoped row, which is circular for exactly these two tables.

**Decision:** `sessions` and `mfa_challenges` are excluded from the `tenant_isolation` RLS policy (migration `8c1a5e9a7b3f`); every other tenant-owned table keeps it. Security for these two tables instead rests on the session/challenge id being an unguessable random UUID primary key (the same trust model as a password-reset token) plus application-level checks (`expires_at`, `revoked_at`, `attempt_count`). Once a session row is resolved, its `tenant_id` becomes the trusted, server-derived context for the rest of the request (`set_tenant_context`), so every other table's RLS still applies normally from that point on. An admin-facing "list my tenant's active sessions" view filters by `tenant_id` explicitly in the query, same as any other tenant-scoped read — RLS is simply not the enforcement mechanism for these two bootstrap tables.

## ADR-016: Audit hash-chain writes are serialized per tenant with an advisory lock
**Status:** Decided

Two concurrent transactions appending audit rows for the same tenant could both read the same "last hash" before either commits, corrupting the hash chain (ADR-006).

**Decision:** `record_audit_event()` takes `pg_advisory_xact_lock(hashtext(tenant_id))` before reading the previous row's hash and inserting the new one. The lock is automatically released at transaction end (commit or rollback), serializing audit appends per tenant without blocking unrelated tenants or non-audit work.

## ADR-018: Manager's project edit/delete/member-management authority is scoped to assigned projects; viewing is tenant-wide
**Status:** Decided

BRD §3.2 lists "Create/Edit/Delete Projects: Manager — Yes (Assigned)" and "Allocate Team Members: Manager — Yes" (no qualifier) — the parenthetical appears on some rows but not others, and the BRD never defines what "assigned" means operationally for a Manager (project ownership? membership? both?).

**Decision:** "Assigned" means the Manager is either the project's `owner_id` or a row in `project_members` for that project. This gate applies uniformly to `PATCH /projects/{id}`, `DELETE /projects/{id}`, and both member-management endpoints for the Manager role — the member-management row's missing "(Assigned)" qualifier is treated as an omission, not an intentional broader grant, since allowing an unassigned Manager to add/remove members on a project they have no other authority over would be an inconsistent privilege escalation path. Admin bypasses this check entirely (BRD's "Global tenant visibility"). **Viewing** (`GET /projects`, `GET /projects/{id}`) is tenant-wide for both Admin and Manager — only Tester's visibility is restricted to assigned projects (FR-PROJ-002's explicit acceptance criterion: "Testers only see assigned projects in project selectors"). The project creator is automatically added to `project_members` on creation, so a Manager who creates a project is immediately "assigned" to it and can edit/delete what they just made.

## ADR-019: Test case authority is project-assignment-gated only for Tester, not Manager
**Status:** Decided

ADR-018 scoped *project-entity* edit/delete to "assigned" Managers because the BRD explicitly marks those RBAC rows "(Assigned)". The test case rows in the same matrix (`Create & Edit Test Cases`, `Delete Test Cases`, `Approve Test Cases`) carry no such qualifier for Manager — only Tester's rows are qualified ("Own Drafts Only" for delete) and FR-PROJ-002 explicitly restricts Tester's *project visibility* to assigned projects.

**Decision:** Test case operations (`create`, `edit`, `submit-review`, `approve`) are gated purely by the `testcase.*` permission flags for **Admin and Manager** (tenant-wide authority, no project-assignment check), matching the BRD matrix's lack of a qualifier for those roles. **Tester** is additionally required to be assigned to the test case's project (owner or `project_members` row) — consistent with Tester's restricted project visibility elsewhere. `DELETE /test-cases/{id}` is the one operation with an explicit extra rule for every role: Admin/Manager may delete any case; **Tester may delete only their own `draft`-status cases** ("Own Drafts Only," BRD §3.2) — enforced in the service layer rather than via the permission-flag dependency, since it's a data-ownership condition, not a role-wide grant.

## ADR-020: Editing a draft mutates in place; editing an approved case always forks a new version and reverts to Draft
**Status:** Decided

FR-TC-001's acceptance criterion only explicitly covers one case: "Adding or modifying steps on an approved test case automatically increments the version counter and archives the previous state." It doesn't say what happens when editing a `draft` or `ready_for_review` case (never yet approved, never yet pinned by any execution), nor what the case's `status` becomes after a post-approval edit.

**Decision:**
- While `test_cases.status` is `draft` or `ready_for_review`: edits (title, priority, assignee, steps) mutate the **current** `test_case_versions`/`test_case_version_steps` rows in place — no new version is created, since nothing has been approved or executed against this version yet, so there is no history to protect (ADR-003 only requires preserving versions once they matter for traceability).
- While `status` is `approved`: **any** edit creates a new `test_case_versions` row (version N+1, fresh step snapshot) and reverts `test_cases.status` to `draft`, matching the state machine diagram in BRD §7.2 ("Rejection / Rework" arrow back to `[Draft] (Version Increments +1)"). The case must go through `submit-review` → `approve` again before it can be used in a new test run. Already-created `test_run_cases` rows keep pointing at the old, now-superseded version (ADR-003's pinning), so in-flight/historical executions are unaffected.

## ADR-021: CSV import is tenant-scoped (not project-scoped) and processed synchronously, not staged/polled
**Status:** Decided — corrects a Phase 0 planning error

**Problem found during implementation:** the Phase 0 `API_SPECIFICATION.md` put CSV import under `POST /projects/{id}/test-cases/import`. But FR-TC-002's CSV header list includes a per-row **Project Name** column with its own acceptance criterion ("Project name is verified against active tenant projects") — meaningless if the endpoint already pins the project via the URL path. The BRD's own design intends a single CSV to span **multiple projects** within one tenant (consistent with the "250 legacy underwriting cases" bulk-migration journey, which doesn't imply a single project).

**Decision:**
- `POST /test-cases/import` is **tenant-scoped**, not project-scoped. Each row resolves its own project by name (case-insensitive, matching `uq_projects_tenant_name_ci`); a row whose project doesn't exist in the tenant is a per-row validation error, not a whole-batch failure.
- Authorization is per-row: for each resolved project, the normal ADR-019 rule applies (Admin/Manager tenant-wide; Tester must be assigned to that specific project) — so one CSV can partially succeed for a Tester across several projects they're variously assigned to or not.
- `GET /projects/{id}/test-cases/export.csv` stays project-scoped (export naturally pins to one project's test cases; no BRD ambiguity there).

**Second decision, same ADR — synchronous processing, not a staged batch + polling design:** the originally-drafted `GET /test-cases/import/{batchId}/report` polling endpoint is dropped. NFR 8.1 caps the requirement at 2,000 rows in under 2.5s — well within what a single synchronous request can parse, validate, and commit. Building a staging table, a background job, and a polling endpoint for that volume would be unrequested infrastructure (no job queue is in the approved tech stack). `POST /test-cases/import` parses the whole CSV, validates every row, inserts all valid rows in one transaction, and returns the full per-row report directly in the response body — "staged" (ARCHITECTURE.md's import architecture) now means "validated in memory before any row is written," not "written to a separate DB staging table."

## ADR-022: Finishing a test run is a Manager/Admin sign-off gate; a new `testrun.finish` permission is added
**Status:** Decided

BRD §3.2 only lists "Create & Launch Test Runs: Yes/Yes/Yes" (all three roles) — there is no separate RBAC row for *closing* a run. But closing a run computes and locks final verdicts (FR-EXEC-001: "Finishing a run sets `finishedAt` and calculates final run verdicts"), which is a formal sign-off action analogous to test case approval (`testcase.approve`, Manager/Admin-only).

**Decision:** A new permission, `testrun.finish`, is seeded for Admin and Manager only (not Tester) — symmetric with the approval gate, and consistent with the Manager persona's BRD-stated responsibility for "test run assignment" and sign-off, versus the Tester persona's "test run execution." Creating and executing a run remains open to all three roles via the existing `testrun.create`/`executionstep.record` permissions; only the final close-out is gated.

## ADR-023: Execution steps are pre-created (verdict=NULL) at test-run-case creation, not lazily on first open
**Status:** Decided

**Decision:** When a test case is bundled into a run (`test_run_cases` row created), one `execution_steps` row is created immediately for every step of the pinned `test_case_version` (`verdict=NULL`, `opened_at=NULL`). This guarantees `GET /test-run-cases/{id}/steps` always returns the complete step list immediately after run creation — matching FR-EXEC-001's "unexecuted test cases default to Pending" — rather than requiring the client to infer unexecuted steps from an initially-empty list. `POST /execution-steps/{id}/open` and `.../verdict` act on these pre-existing rows (UPDATE, not INSERT).

## ADR-024: Test-run-case status is recomputed from scratch from step verdicts, not tracked incrementally; steps are re-verdictable
**Status:** Decided

BRD Journey 4 describes re-executing a previously-failed step after a fix and marking it Pass **within the same test run** ("Tester marks Step 3 as Pass. The test case status turns Passed") — so `POST /execution-steps/{id}/verdict` must be callable more than once per step, not just on first submission.

**Decision:** `record_verdict()` always recomputes `test_run_cases.status` from the full current set of that case's `execution_steps` verdicts, rather than incrementally patching state: `status = 'failed'` if any step is `fail`; else `'passed'` if every step has a non-null verdict (`pass`/`ignore` both count as resolved); else `'in_progress'` if at least one step has a verdict; else `'pending'`. This is idempotent and self-correcting — re-verdicting a step (e.g., Fail → Pass after a fix) naturally flips the case's rollup status without any special-case "undo" logic. `started_at` is set once, on the first verdict ever recorded for the case, and never cleared; `completed_at` is refreshed to now whenever the recomputed status is `passed`/`failed`, and cleared otherwise (e.g., a corrected verdict that reopens the case).

**Addendum (Phase 10.9):** the backend's re-verdict support had no corresponding frontend control. `ExecutionConsole.tsx`'s `StepCard` only rendered the Pass/Fail/Ignore buttons for the one step with `verdict === null` (`isCurrent`) — once a step had *any* verdict, including a `Fail` that Journey 4 describes fixing and re-running, there was no way to invoke `POST /execution-steps/{id}/verdict` a second time from the UI at all. Caught by the Phase 10.9 E2E suite (`journey4-defect-lifecycle.spec.ts`) attempting to re-verdict a failed step and finding no button to click — not a test-script mistake, a real shipped gap from Phase 10.5. Fixed by adding a "Re-run step" disclosure control to any step that already has a verdict and isn't current, revealing the same three verdict buttons on demand (not shown unconditionally, to avoid accidental misclicks on a settled step).

## ADR-025: Only `approved` test cases can be bundled into a test run
**Status:** Decided

The BRD's state machine (§7.2) shows `Approved → Assigned/In Progress → Passed/Failed/Blocked` as the only path into execution — `draft`/`ready_for_review` cases never appear on that path, and FR-TC-003 exists specifically to gate "formal execution" behind Manager/Admin sign-off.

**Decision:** `POST /projects/{id}/test-runs` rejects (per-row validation error, not a whole-request failure) any `test_case_id` whose current `status` isn't `approved`. This also means the version pinned into `test_run_cases.test_case_version_id` (ADR-003) is always an approved, reviewed version — never a draft snapshot.

## ADR-026: Defect status transitions are strictly sequential; no skipping, no reopening
**Status:** Decided

FR-DEF-001 states the transitions "follow the defined state machine: New → Open → Fixed → Verified → Closed," and §7.2's diagram shows only forward arrows — no path back from `Closed`/`Verified` to an earlier state, and no explicit "reopen" transition.

**Decision:** `PATCH /defects/{id}/status` only accepts a transition to the **immediate next** status in that fixed sequence (`New→Open→Fixed→Verified→Closed`) — no skipping ahead (e.g. `New→Fixed` directly) and no moving backward. There is deliberately no "reopen a closed defect" transition: if a fixed/verified issue recurs, BRD Journey 3's pattern (a failed execution step opens a *new* defect, FR-EXEC-003) is the supported path, not resurrecting an old one — inventing a reopen transition the BRD never describes would be scope creep. Per BRD §3.2, only the transition *to* `Closed` is role-gated (Manager/Admin only, via the existing `defect.close` permission); every other transition is available to any of the three roles that can otherwise access the defect (consistent with "Log Defects: Yes/Yes/Yes" and the matrix's silence on gating `Open`/`Fixed`/`Verified` specifically — BRD Journey 4 shows a Manager performing `Verified`→`Closed`, but nothing in the RBAC matrix restricts Tester from the earlier transitions, so this implementation doesn't invent that restriction either).

## ADR-027: Reporting/Dashboard scope, metric definitions, and the "assignee" dimension
**Status:** Decided

Several things FR-DASH/FR-REP leave unstated:

1. **Tester's viewing scope on the Dashboard.** The RBAC matrix's only explicit qualifier is on the *Reporting* row ("View Executive Reporting & Charts: ... Tester Restricted to Assigned"); the Dashboard FRs carry no such qualifier. **Decision:** apply the same assigned-projects restriction to both, for consistency with every other module in this codebase (ADR-019 et al.) — a QA Director-style "organization at a glance" view for a Tester role would otherwise be the one inconsistent exception in the whole system.
2. **What "Status (Passed, Failed, Pending, Blocked)" refers to.** Those four values are `test_run_cases.status`, not `test_cases.status` (whose enum is `draft/ready_for_review/approved/deprecated` — a different lifecycle entirely, ADR-001). **Decision:** the `status` reporting metric aggregates `test_run_cases.status`.
3. **What "Assignee" means for the Defects grouping dimension.** `defects` has no assignee column (BRD's own schema for `Defect` doesn't include one) — the closest analogous person-dimension is `reported_by`. **Decision:** grouping defects "by Assignee" groups by `reported_by`. For the `priority` metric (test cases), Assignee is `test_cases.assignee_id`; for the `status` metric (test run cases), Assignee is `test_run_cases.assigned_to` (frequently `NULL`/"Unassigned," since no run-case assignment endpoint exists yet — not a gap, just an unused optional column).
4. **PDF generation (resolves GAP-08).** FR-REP-002's own acceptance criterion describes a "Printable view [that] strips navigation menus and formats tables cleanly across standard A4/Letter page bounds" — that is browser print-CSS behavior, a frontend concern, not a server-rendered PDF file. **Decision:** the backend generates the CSV compliance export only (`GET /reports/compliance-export`, CSV with a tenant/timestamp/reporting-officer header per FR-REP-002); no PDF-generation library is added to the stack. "PDF" is produced by the browser's native print-to-PDF against a print stylesheet, built when the Reporting screen's UI is implemented.

## ADR-028: `GET /users` is readable by anyone who can manage project members, not just `user.manage` holders
**Status:** Decided — found while building the Projects UI (Phase 10.2)

FR-PROJ-002 lets a Manager "Allocate Team Members to Projects," but `GET /users` was gated solely by `user.manage` (Admin-only, ADR-014's seed). A Manager assigning a teammate to a project has no way to see who exists in the tenant to pick from — the UI for a BRD-required feature was otherwise unbuildable.

**Decision:** `GET /users` accepts either `user.manage` (Admin) or `project.members.manage` (Admin/Manager) — a new `require_any_permission(*codes)` dependency (`app/core/auth.py`), analogous to the existing `require_permission`. This exposes only the same basic directory fields `UserOut` already returns (id, email, name, role, is_active, created_at — never `password_hash`), which is ordinary tenant-directory information, not a privilege escalation: a Manager already has tenant-wide authority over projects and test cases (ADR-019); knowing colleagues' names/emails/roles to assign them is strictly narrower than that. Tester still cannot list users (neither permission is seeded for Tester).

## ADR-029: Audit log read access is a new `audit.view` permission, Admin-only
**Status:** Decided — found while building the Administration UI (Phase 10.8)

BR-13 had a write path (every module appends to the hash chain, ADR-006) and one narrow read surface (`/dashboard/activity-stream`, the last 10 events for the Dashboard card), but no endpoint for browsing or filtering the full tenant audit trail — the BRD's "Administration → Audit Logs" screen (`docs/MASTER_SPEC.md` module map) had nothing to call. No existing permission code fit: `report.view` is granted to all three roles (Tester included, per the seed migration), but the BRD's RBAC line is unambiguous — "**Admin**: full tenant control, user/role management, **audit access**, all project/testing operations" names audit access as an Admin-specific capability, not a reporting one.

**Decision:** added `audit.view` as its own permission (migration `a3c9e1f2b4d7`), granted to `admin` only — not folded into `report.view` (wrong audience) and not into `user.manage` (orthogonal: an Admin managing users and an Admin auditing the tenant are different concerns that happen to share a role today, but modeling them as one permission would make a future "compliance auditor" role, who needs `audit.view` without `user.manage`, impossible without a migration). `GET /audit-logs` supports `action`/`entity_type`/`user_id` filtering and pagination (capped at 200/page); a separate `GET /audit-logs/verify-chain` endpoint re-walks the full chain and recomputes every hash server-side (the same algorithm `test_audit_integrity.py` already exercised against real data in Phase 9), surfacing tamper-evidence as a UI-visible pass/fail rather than only a test assertion — this is what makes the hash chain's value visible to an actual compliance officer, not just to the test suite.

## ADR-017: Login requires an explicit tenant identifier; there is no global email lookup
**Status:** Decided

`users.email` is only unique **per tenant** (`uq_users_tenant_email`, ADR-007/DATABASE_SCHEMA) — the same email may legitimately belong to different people at different carriers. Since `users` correctly keeps tenant RLS (ADR-007), a login request of just `(email, password)` can't resolve which tenant to even query: without `app.current_tenant` set, RLS returns zero rows for every tenant, and there is no RLS-exempt global email→tenant index to fall back on (deliberately — that would reintroduce a cross-tenant enumeration surface, ADR-007's whole point).

**Decision:** `POST /auth/login` requires `tenant_id` explicitly in the payload, alongside `email`/`password` (the same pattern as Slack's workspace URL or Okta's org-specific login page). The backend sets `app.current_tenant` to the supplied `tenant_id` *before* querying `users`; if the tenant, email, or password is wrong, the result is identical in every case ("Invalid credentials") — the RLS-scoped query simply returns no matching row, so no tenant/email enumeration is possible (satisfies FR-AUTH-002's "clear, non-leaking error feedback"). How the frontend obtains `tenant_id` before showing the login form (subdomain routing, a saved "organization" picker, a magic link) is a UI concern for a later phase, not a backend contract change.

## ADR-014: Roles and permissions are modeled as data, not hardcoded enums, without contradicting "no custom roles in v1"
**Status:** Decided

The BRD's RBAC matrix (§3.2) is fixed to exactly `Admin/Manager/Tester` with no mention of custom roles, yet §4 of the master prompt lists `roles`/`permissions` as tables to evaluate.

**Decision:** `roles` and `permissions` tables exist and are seeded with exactly the three BRD roles and their fixed permission grants (matching §3.2 verbatim), queried by the backend's authorization layer instead of hardcoding role checks in route handlers. Tenants cannot create custom roles or alter the seeded permission set in this phase — the tables exist for correctness/auditability of authorization, not for a role-builder feature. Any future custom-RBAC feature is a scope change requiring the BRD's formal change-request process (§13).

## ADR-030: Login/MFA rate limiting via `slowapi`, per-client-IP, in-memory storage
**Status:** Decided — found during a post-Phase-10 security hardening pass (GAP-16)

GAP-16 flagged that `POST /auth/login` had no throttling at all — only the post-login MFA code had a 3-attempt lockout — and explicitly required an explicit decision before adding anything, since no rate-limiting library was in the originally approved stack.

**Decision:** `slowapi` (a FastAPI/Starlette-native wrapper over the `limits` library), keyed by client IP via its built-in `get_remote_address`, at 10 requests/minute on both `POST /auth/login` and `POST /auth/mfa/verify` (`app/core/rate_limit.py`). A 429 response is normalized into the app's standard `{"data": null, "error": {...}}` envelope (`app/main.py`'s `RateLimitExceeded` handler), not slowapi's default plain-text response. In-memory storage was chosen over a Redis-backed one since no cache layer exists in the stack and this is a single-process deployment; the gap's own closing condition explicitly names per-IP as an acceptable option, with a Redis-backed limiter reserved for if this needs to scale to multiple processes. A per-`(tenant_id, email)` key would be more precise but isn't a drop-in `key_func` — slowapi's key functions read the request/connection, not the JSON body — so it's deferred rather than built speculatively.

Testing note: rate limiting is **disabled by default** for the whole backend test suite (`conftest.py`'s `_disable_rate_limiting` autouse fixture) — with it left on, 74+ tests' worth of logins against the same TestClient "IP" would trip the limiter well before the suite finishes. The one dedicated test (`test_rate_limiting.py`) explicitly re-enables and resets the limiter for just itself.

## ADR-012 addendum: test case attachments implemented (GAP-15 closed)
The schema and storage design below were decided in Phase 0 but not built until a post-Phase-10 pass. Implementation matches the decision as written: `app/services/attachment_service.py` writes bytes to `{attachments_dir}/{tenant_id}/{test_case_id}/{uuid}_{filename}` (capped at 10MB, rejecting empty uploads), computes a SHA-256 checksum, and stores only metadata in `attachments`. Access is **not** independently permissioned — an attachment is never more visible than the test case it belongs to, so `list`/`upload`/`download`/`delete` all re-run `test_case_service.get_test_case()`'s existing 404 + ADR-019 project-visibility check (Tester must be assigned) rather than duplicating that logic. Upload/delete additionally require the `testcase.edit` permission; list/download only require being authenticated (the project-visibility check does the real gating). Scoped to `owner_type='test_case'` only for this pass, though the table's polymorphic design (`test_case_version`/`defect`/`execution_step` are also valid owner types) was left unchanged for future reuse.
