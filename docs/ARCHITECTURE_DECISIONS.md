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

## ADR-017: Login requires an explicit tenant identifier; there is no global email lookup
**Status:** Decided

`users.email` is only unique **per tenant** (`uq_users_tenant_email`, ADR-007/DATABASE_SCHEMA) — the same email may legitimately belong to different people at different carriers. Since `users` correctly keeps tenant RLS (ADR-007), a login request of just `(email, password)` can't resolve which tenant to even query: without `app.current_tenant` set, RLS returns zero rows for every tenant, and there is no RLS-exempt global email→tenant index to fall back on (deliberately — that would reintroduce a cross-tenant enumeration surface, ADR-007's whole point).

**Decision:** `POST /auth/login` requires `tenant_id` explicitly in the payload, alongside `email`/`password` (the same pattern as Slack's workspace URL or Okta's org-specific login page). The backend sets `app.current_tenant` to the supplied `tenant_id` *before* querying `users`; if the tenant, email, or password is wrong, the result is identical in every case ("Invalid credentials") — the RLS-scoped query simply returns no matching row, so no tenant/email enumeration is possible (satisfies FR-AUTH-002's "clear, non-leaking error feedback"). How the frontend obtains `tenant_id` before showing the login form (subdomain routing, a saved "organization" picker, a magic link) is a UI concern for a later phase, not a backend contract change.

## ADR-014: Roles and permissions are modeled as data, not hardcoded enums, without contradicting "no custom roles in v1"
**Status:** Decided

The BRD's RBAC matrix (§3.2) is fixed to exactly `Admin/Manager/Tester` with no mention of custom roles, yet §4 of the master prompt lists `roles`/`permissions` as tables to evaluate.

**Decision:** `roles` and `permissions` tables exist and are seeded with exactly the three BRD roles and their fixed permission grants (matching §3.2 verbatim), queried by the backend's authorization layer instead of hardcoding role checks in route handlers. Tenants cannot create custom roles or alter the seeded permission set in this phase — the tables exist for correctness/auditability of authorization, not for a role-builder feature. Any future custom-RBAC feature is a scope change requiring the BRD's formal change-request process (§13).
