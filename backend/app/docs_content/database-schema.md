# Database Schema — QTestHub v2.4

PostgreSQL. All PKs are `UUID DEFAULT gen_random_uuid()` (pgcrypto/`uuid-ossp`). All tenant-owned tables carry `tenant_id UUID NOT NULL REFERENCES tenants(id)` and a Row-Level Security policy (ADR-007). All timestamps are `TIMESTAMPTZ` (UTC) unless noted (ADR-013). Every schema change ships as an Alembic migration — no destructive change without an explicit migration + backfill plan.

## Platform-level tables (no tenant_id, no RLS)

### `tenants`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| status | TEXT NOT NULL CHECK IN ('pending','approved','suspended') | |
| default_currency_code | CHAR(3) NOT NULL DEFAULT 'USD' | ADR-013 |
| default_timezone | TEXT NOT NULL DEFAULT 'UTC' | ADR-013 |
| primary_domain | TEXT NULL CHECK IN ('Motor','Health','Travel','Life','Property','Other') | BRD gap Phase 4, ADR-073 (migration `c9d0e1f2a3b4`). Optional primary insurance domain chosen at signup / in Settings; only pre-selects a new project's Domain, never restricts it. NULL = not set |
| workspace_config | JSONB NULL | ADR-125 (migration `a6c8e0b2d4f7`): the tenant's workspace defaults `{sidebar: {order, hidden}, project_tabs: {order, hidden}, view_modes: {list_key: [modes]}}` (sidebar entries, default project tabs, list views). NULL = built-in defaults; validated by the API (`schemas/workspace.py`). Covered by the existing tenants RLS |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### `platform_admins`
Bootstrap-only (ADR-008). Not a tenant role.
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| email | CITEXT UNIQUE NOT NULL | |
| password_hash | TEXT NOT NULL | Argon2id |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| failed_login_count | SMALLINT NOT NULL DEFAULT 0 | password-failure lockout (ADR-052) |
| locked_until | TIMESTAMPTZ | set by password **or** MFA lockout |
| is_active | BOOLEAN NOT NULL DEFAULT true | |
| mfa_secret_encrypted | TEXT | Fernet ciphertext of the base32 TOTP secret; never plaintext (ADR-074). While `mfa_enabled_at` is NULL it is only a *pending* enrolment secret |
| mfa_enabled_at | TIMESTAMPTZ | NULL = MFA not enrolled; set when the first code is confirmed |
| mfa_last_used_step | BIGINT | highest accepted TOTP time step -- a code is single-use (replay protection) |
| mfa_failed_count | SMALLINT NOT NULL DEFAULT 0 | wrong TOTP/recovery/enrolment codes since the last success; 5 locks the account |
| enrolment_code_hash | TEXT | ADR-080, migration `a7e3c1d9b2f4`. SHA-256 of the one-time enrolment code (plaintext shown once, never stored). NULL = no code (enrolled, or none issued). Cleared when enrolment completes |
| enrolment_code_expires_at | TIMESTAMPTZ | ADR-080. Code is invalid at or after this time (`PLATFORM_ENROLMENT_CODE_TTL_HOURS`, default 24) |
| password_reset_code_hash | TEXT | ADR-081, migration `b4d8f2a6c1e9`. SHA-256 of the one-time password-reset code issued by another admin (plaintext shown once, never stored). NULL = no reset pending; while set the old password cannot sign in. Cleared when the reset completes or an operator sets the password |
| password_reset_code_expires_at | TIMESTAMPTZ | ADR-081. Code is invalid at or after this time (`PLATFORM_PASSWORD_RESET_CODE_TTL_HOURS`, default 24); an expired unused code still blocks the old password until re-issued |

### `platform_sessions` (ADR-074)
Server-side Platform Admin session. No tenant column, no RLS (platform table, same grants as `platform_admins`).
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| admin_id | UUID FK platform_admins ON DELETE CASCADE | indexed |
| token_hash | TEXT UNIQUE NOT NULL | SHA-256 of the cookie token; the raw token is never stored |
| stage | TEXT NOT NULL | `password_ok` (grants no API access) \| `mfa_verified` |
| created_at / last_seen_at | TIMESTAMPTZ | idle timeout (`PLATFORM_SESSION_IDLE_MINUTES`, default 30) is measured from `last_seen_at`, which is rewritten at most once a minute (ADR-083) |
| expires_at | TIMESTAMPTZ NOT NULL | absolute: 10 min for `password_ok`, 8 h for `mfa_verified` |
| mfa_verified_at | TIMESTAMPTZ | |
| revoked_at | TIMESTAMPTZ | logout, deactivation, password change, MFA reset, lockout |
| ip_address | TEXT | sign-in IP; compared on every request only when `PLATFORM_SESSION_BIND_IP` is on (ADR-083) |
| user_agent | TEXT | display string truncated to 120 characters; never used for checks |
| ua_hash | TEXT | ADR-083, migration `d6f0b4c8e2a3`: SHA-256 of the sign-in User-Agent; a mismatch revokes the session and is audited `session_binding_failed`. NULL on sessions created before the migration (check skipped) |
| step_up_at | TIMESTAMPTZ | ADR-083: last TOTP / recovery-code verification on this session (set at MFA sign-in and by `POST /platform/auth/step-up`); sensitive actions need it within `PLATFORM_STEP_UP_MINUTES` (default 5) |

### `platform_audit_events` (ADR-082)
Insert-only, hash-chained audit trail for the Platform Admin plane. No tenant column, no RLS; the app role has SELECT + INSERT only (UPDATE/DELETE/TRUNCATE revoked). No FK to `platform_admins`, so rows outlive admin changes. Migration `c5e9a3b7d1f2`.
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | generated by the app and part of the hashed payload |
| created_at | TIMESTAMPTZ NOT NULL | strictly increasing along the chain; indexed with `id` |
| event_type | TEXT NOT NULL | e.g. `login_failed`, `mfa_success`, `admin_created`; indexed |
| actor_admin_id | UUID | NULL for a failed sign-in with an unknown email |
| actor_email | TEXT | normalised (trimmed, lower-case, max 254) |
| target_admin_id | UUID | admin acted upon, for management events |
| ip | TEXT | caller IP from the request; NULL for CLI |
| outcome | TEXT NOT NULL | CHECK `success` \| `failure` |
| details | JSONB | whitelisted scalar keys only (`reason`, `method`, `source`, `target_email`, `status`) |
| prev_hash / record_hash | TEXT NOT NULL | SHA-256 chain, genesis `0` x 64; writers serialised by an advisory lock |

### `audit_chain_checkpoints` (ADR-085)
HMAC-signed anchors over the head of a hash chain (GAP-01 mitigation). Holds ids, counts and hashes only, never audit content, so there is no RLS; the API filters by `scope`. No FK to `tenants`, so rows outlive a tenant. The app role has SELECT + INSERT only (UPDATE/DELETE/TRUNCATE revoked). Migration `e7a1c5d9b3f4`.
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| scope | TEXT NOT NULL | `platform` or `tenant:<uuid>` (CHECK); indexed with `created_at, id` |
| last_record_id | UUID NOT NULL | the anchored `audit_logs` / `platform_audit_events` row (no FK) |
| last_created_at | TIMESTAMPTZ NOT NULL | that row's timestamp |
| record_count | INTEGER NOT NULL | rows of the chain up to and including the anchor |
| head_hash | TEXT NOT NULL | the anchored row's `record_hash` |
| prev_checkpoint_hash | TEXT NOT NULL | previous checkpoint of the same scope, genesis `0` x 64 |
| checkpoint_hash | TEXT NOT NULL | SHA-256 over `scope\|record_count\|head_hash\|prev_checkpoint_hash\|created_at` plus the anchor id and timestamp |
| signature | TEXT NOT NULL | HMAC-SHA256 of `checkpoint_hash` with `AUDIT_CHECKPOINT_HMAC_KEY` (key kept outside the database) |
| created_at | TIMESTAMPTZ NOT NULL | strictly increasing within a scope |

### `platform_admin_recovery_codes` (ADR-074)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| admin_id | UUID FK platform_admins ON DELETE CASCADE | indexed; UNIQUE (admin_id, code_hash) |
| code_hash | TEXT NOT NULL | SHA-256 of the 80-bit recovery code; plaintext is shown once at enrolment |
| created_at | TIMESTAMPTZ | |
| used_at | TIMESTAMPTZ | NULL = still usable; each code works once |

## Identity & Access (FR-AUTH, FR-ADM-001)

### `roles`
Seeded, fixed set per BRD §3.2 (ADR-014). `tenant_id` nullable — rows are global seed data, not per-tenant.
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| code | TEXT UNIQUE NOT NULL | `admin` \| `manager` \| `tester` |
| name | TEXT NOT NULL | |

### `permissions`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| code | TEXT UNIQUE NOT NULL | e.g. `project.create`, `testcase.approve`, `defect.close`, `user.erase` (Admin only, ADR-086) |
| description | TEXT | |

### `role_permissions`
| Column | Type | Notes |
|---|---|---|
| role_id | UUID FK roles | PK part |
| permission_id | UUID FK permissions | PK part |

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| email | CITEXT NOT NULL | UNIQUE (tenant_id, email) — FR-ADM-001 |
| name | TEXT NOT NULL | pseudonymizable, ADR-009 |
| role_id | UUID NOT NULL FK roles | |
| password_hash | TEXT NOT NULL | Argon2id, never returned by API |
| is_active | BOOLEAN NOT NULL DEFAULT true | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| pseudonymized_at | TIMESTAMPTZ NULL | set when the user's personal data is erased (ADR-086, `POST /users/{id}/erase`); exposed in the API as `erased_at`. An erased row has name `Erased user`, email `erased-<hex>@erased.invalid`, `is_active=false` and an unusable password hash; it is never deleted because other rows reference it |

Constraint: application layer must block deleting/deactivating the last active `admin` role user in a tenant (FR-ADM-001).

### `sessions`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | session token identifier (opaque cookie value references this) |
| tenant_id | UUID NOT NULL FK tenants | |
| user_id | UUID NOT NULL FK users | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| expires_at | TIMESTAMPTZ NOT NULL | |
| mfa_verified | BOOLEAN NOT NULL DEFAULT false | |
| revoked_at | TIMESTAMPTZ NULL | |

### `mfa_challenges`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | |
| user_id | UUID NOT NULL FK users | |
| code_hash | TEXT NOT NULL | never store plaintext code |
| delivery_mode | TEXT NOT NULL CHECK IN ('real','simulated') | ADR-011 |
| attempt_count | SMALLINT NOT NULL DEFAULT 0 | lockout at 3, FR-AUTH-003 |
| expires_at | TIMESTAMPTZ NOT NULL | |
| verified_at | TIMESTAMPTZ NULL | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

## Project Management (FR-PROJ)

### `projects`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| name | TEXT NOT NULL | UNIQUE (tenant_id, lower(name)) — FR-PROJ-001 |
| domain | TEXT NOT NULL CHECK IN ('Motor','Health','Travel','Life','Property') | |
| status | TEXT NOT NULL CHECK IN ('On Track','At Risk','Delayed','Completed') | |
| priority | TEXT NOT NULL CHECK IN ('Low','Medium','High','Critical') | |
| manager_name | TEXT NOT NULL | |
| start_date | DATE NOT NULL | |
| end_date | DATE NOT NULL | CHECK (end_date >= start_date) |
| budget | NUMERIC(14,2) NOT NULL CHECK (budget >= 0) | |
| currency_code | CHAR(3) NOT NULL | ADR-013 |
| region | TEXT NOT NULL | free text, GAP open re: enum vs free text |
| owner_id | UUID NOT NULL FK users | |
| nav_config | JSONB NULL | ADR-122: `{order, hidden}` project tab order and hidden tabs, validated by the API against a fixed key list; NULL = default tabs |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### `project_members`
| Column | Type | Notes |
|---|---|---|
| project_id | UUID FK projects | PK part |
| user_id | UUID FK users | PK part |
| added_at | TIMESTAMPTZ NOT NULL DEFAULT now() | FR-PROJ-002 |

Index: `(project_id)`, `(user_id)` for "projects assigned to me" queries.

## Test Case Repository & Versioning (FR-TC)

### `test_cases`
The authoring-level document (ADR-001).

`row_version INTEGER NOT NULL DEFAULT 1` (ADR-136, migration `b1d3f5a7c9e2`) moves once per saved change and is compared with a caller's `expected_version`.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| project_id | UUID NOT NULL FK projects | |
| title | TEXT NOT NULL CHECK (char_length(title) >= 5) | |
| priority | TEXT NOT NULL CHECK IN ('Low','Medium','High','Critical') | |
| status | TEXT NOT NULL CHECK IN ('draft','ready_for_review','approved','deprecated') | ADR-001 |
| assignee_id | UUID NULL FK users | |
| current_version_id | UUID NULL FK test_case_versions | set after first version created |
| quarantined | BOOLEAN NOT NULL DEFAULT false | manual flaky-test quarantine (ADR-097, migration `d7f3b9a1c5e2`) |
| quarantine_reason | TEXT NULL | required (3-500 chars) when quarantining, cleared on release |
| quarantined_by | UUID NULL FK users | who quarantined it |
| quarantined_at | TIMESTAMPTZ NULL | when |
| created_by | UUID NOT NULL FK users | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### `test_case_versions`
Immutable snapshots (ADR-003).
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| test_case_id | UUID NOT NULL FK test_cases | |
| version_number | INTEGER NOT NULL | UNIQUE (test_case_id, version_number) |
| title | TEXT NOT NULL | snapshot of title at this version |
| approved_by | UUID NULL FK users | set when this version was approved |
| approved_at | TIMESTAMPTZ NULL | |
| created_by | UUID NOT NULL FK users | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### `test_case_version_steps`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | join key everywhere (ADR-002) |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| test_case_version_id | UUID NOT NULL FK test_case_versions | |
| step_number | INTEGER NOT NULL | 1-based, display only, UNIQUE (test_case_version_id, step_number) |
| action | TEXT NOT NULL CHECK (char_length(action) > 0) | |
| expected | TEXT NOT NULL CHECK (char_length(expected) > 0) | |

### `attachments`
Generic, polymorphic (ADR-012).
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| owner_type | TEXT NOT NULL CHECK IN ('test_case','test_case_version','defect','execution_step') | |
| owner_id | UUID NOT NULL | polymorphic, no FK constraint (validated in service layer) |
| file_name | TEXT NOT NULL | |
| mime_type | TEXT NOT NULL | |
| storage_path | TEXT NOT NULL | |
| size_bytes | BIGINT NOT NULL | |
| checksum_sha256 | TEXT NOT NULL | |
| uploaded_by | UUID NOT NULL FK users | |
| uploaded_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index: `(owner_type, owner_id)`.

## Test Execution (FR-EXEC) — normalized per ADR-004

### `test_runs`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| project_id | UUID NOT NULL FK projects | |
| name | TEXT NOT NULL CHECK (char_length(name) >= 3) | |
| run_type | TEXT NOT NULL CHECK IN ('Regression','Sanity','Smoke') | |
| executed_by | UUID NOT NULL FK users | run creator/owner |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| finished_at | TIMESTAMPTZ NULL | set by Finish Run or automatically when every case has a final verdict (ADR-070) |
| paused_at | TIMESTAMPTZ NULL | |
| deleted_at | TIMESTAMPTZ NULL | soft delete (ADR-070, migration `d1e2f3a4b5c6`); every ORM SELECT excludes non-null rows |
| deleted_by | UUID NULL FK users | who deleted it |
| original_run_id | UUID NULL FK test_runs | set on a run created by rerun-failed, points at the source run (ADR-096, migration `c6e2a8f4b1d7`) |

### `test_run_cases`
One row per test case bundled into a run; pins the version (ADR-003).
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| test_run_id | UUID NOT NULL FK test_runs | |
| test_case_id | UUID NOT NULL FK test_cases | |
| test_case_version_id | UUID NOT NULL FK test_case_versions | pinned at creation |
| status | TEXT NOT NULL DEFAULT 'pending' CHECK IN ('pending','in_progress','passed','failed','blocked','ignored') | ADR-001 |
| assigned_to | UUID NULL FK users | |
| due_date | DATE NULL | ADR-123 (migration `e3a5c7d9f1b4`): the assignment-level due date; a run case is overdue when it is past due and still `pending` / `in_progress` in an open run. Partial index `ix_test_run_cases_tenant_due (tenant_id, due_date) WHERE due_date IS NOT NULL` |
| blocked_reason | TEXT NULL | required explanation while status = 'blocked'; cleared on unblock (ADR-070) |
| started_at | TIMESTAMPTZ NULL | |
| completed_at | TIMESTAMPTZ NULL | |

UNIQUE (test_run_id, test_case_id).

### `execution_steps`
One row per step per run-case (ADR-004); the authoritative timing + verdict record (FR-EXEC-002, BR-09).
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| test_run_case_id | UUID NOT NULL FK test_run_cases | |
| test_case_version_step_id | UUID NOT NULL FK test_case_version_steps | the exact pinned step (ADR-002) |
| verdict | TEXT NULL CHECK IN ('pass','fail','ignore') | NULL = not yet executed |
| opened_at | TIMESTAMPTZ NULL | server timestamp when tester began the step |
| closed_at | TIMESTAMPTZ NULL | server timestamp when verdict recorded |
| duration_ms | INTEGER NULL | computed server-side = closed_at - opened_at (ADR-013) |
| executed_by | UUID NULL FK users | |

UNIQUE (test_run_case_id, test_case_version_step_id).

## Defect Management (FR-DEF) — traceability per the 5-dimension requirement in the architecture notes

### `defects`

`row_version INTEGER NOT NULL DEFAULT 1` (ADR-136, migration `b1d3f5a7c9e2`) moves once per saved change and is compared with a caller's `expected_version`.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| project_id | UUID NOT NULL FK projects | |
| test_case_id | UUID NULL FK test_cases | NULL for fully standalone defects |
| test_case_version_id | UUID NULL FK test_case_versions | traceable version (architecture note requirement) |
| test_run_id | UUID NULL FK test_runs | |
| test_case_version_step_id | UUID NULL FK test_case_version_steps | replaces raw `stepIndex` (ADR-002) |
| title | TEXT NOT NULL CHECK (char_length(title) >= 5) | |
| severity | TEXT NOT NULL CHECK IN ('Low','Medium','High','Critical') | |
| status | TEXT NOT NULL DEFAULT 'New' CHECK IN ('New','Open','Fixed','Verified','Closed') | §7.2 state machine |
| description | TEXT NULL | |
| reported_by | UUID NOT NULL FK users | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| closed_at | TIMESTAMPTZ NULL | |
| deleted_at | TIMESTAMPTZ NULL | soft delete (ADR-070, migration `d1e2f3a4b5c6`); every ORM SELECT excludes non-null rows |
| deleted_by | UUID NULL FK users | who deleted it |

### `defect_links`
Many-to-many linkage (ADR-005) — supports duplicate defects on one step and one defect spanning multiple references.
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| defect_id | UUID NOT NULL FK defects | |
| linkable_type | TEXT NOT NULL CHECK IN ('execution_step','test_case','defect') | |
| linkable_id | UUID NOT NULL | polymorphic |
| link_type | TEXT NOT NULL DEFAULT 'relates_to' CHECK IN ('relates_to','duplicate_of','caused_by') | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index: `(linkable_type, linkable_id)`, `(defect_id)`.

### `access_rules` (ADR-092, migration `a9c3e7b1d5f2`)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| name | TEXT NOT NULL | |
| enabled | BOOLEAN NOT NULL DEFAULT true | |
| rule_type | TEXT NOT NULL CHECK IN ('freeze_window','environment_restriction') | |
| project_id | UUID NULL FK projects | NULL = tenant-wide |
| environment | TEXT NULL | environment_restriction only; case-insensitive match |
| starts_at / ends_at | TIMESTAMPTZ NULL | UTC. freeze_window: the blocked window (both required). environment_restriction: optional ALLOWED window |
| blocked_actions | TEXT[] NOT NULL | permission codes or dotted prefixes, validated against `permissions` on write |
| exempt_roles | TEXT[] NOT NULL DEFAULT '{admin}' | `admin` is always present |
| reason | TEXT NOT NULL | shown to blocked users; not copied into the audit log |
| created_by | UUID NULL FK users | |
| created_at / updated_at | TIMESTAMPTZ NOT NULL | |

Index `ix_access_rules_tenant_enabled (tenant_id, enabled)`. The migration also seeds the `access_rule.manage` permission to the Admin role.

### `saved_views` (ADR-096, migration `c6e2a8f4b1d7`)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| user_id | UUID NOT NULL FK users | owner; views are private |
| list_key | TEXT NOT NULL CHECK IN ('test_cases','test_repository','defects','test_runs','requirements','projects') | ADR-132 (migration `a7c9e1f3b5d8`) added `test_repository`; ADR-124 (migration `f5b7d9a1c3e5`) widened the check; the view mode (`view` = list / board / calendar) is one more allowlisted key inside `filters`, no new column |
| name | VARCHAR(60) NOT NULL | UNIQUE (user_id, list_key, name) |
| filters | JSONB NOT NULL DEFAULT '{}' | allowlisted keys with string values, max 2KB (validated in the API) |
| sort | VARCHAR(50) NULL | |
| is_default | BOOLEAN NOT NULL DEFAULT false | partial unique index on (user_id, list_key) WHERE is_default |
| created_at, updated_at | TIMESTAMPTZ NOT NULL | |

### `saved_reports` (ADR-098, migration `e8a4c2f6b9d1`)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| user_id | UUID NOT NULL FK users | owner |
| name | VARCHAR(80) NOT NULL | UNIQUE (user_id, name) |
| source | TEXT NOT NULL CHECK IN ('test_cases','test_runs','defects') | |
| definition | JSONB NOT NULL | structured definition, validated against the allowlist on write and on every run; never SQL |
| is_shared | BOOLEAN NOT NULL DEFAULT false | shared = read, run and export for the tenant; only owner or Admin edit |
| created_at, updated_at | TIMESTAMPTZ NOT NULL | |

### `dashboards` (ADR-099, migration `f9b3d5a7c1e2`)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| owner_user_id | UUID FK users | NULL only for the team default (CHECK ties it to `is_team_default`) |
| project_id | UUID NULL FK projects ON DELETE CASCADE | ADR-123 (migration `e3a5c7d9f1b4`): set on a **project dashboard layout**: either one user's own layout of that project (owner set) or the project default (owner NULL, `is_team_default` false). The owner/default CHECK allows that third shape; partial UNIQUE indexes `uq_dashboards_project_user (project_id, owner_user_id)` and `uq_dashboards_project_default (project_id) WHERE owner_user_id IS NULL` allow one layout per user and one default per project. Org dashboards keep `project_id` NULL and never list or open project layouts |
| name | VARCHAR(60) NOT NULL | 1-60 characters |
| is_team_default | BOOLEAN NOT NULL DEFAULT false | partial UNIQUE index on (tenant_id) WHERE is_team_default: one per tenant |
| created_at, updated_at | TIMESTAMPTZ NOT NULL | |

### `dashboard_widgets` (ADR-099, migration `f9b3d5a7c1e2`)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| dashboard_id | UUID NOT NULL FK dashboards ON DELETE CASCADE | index (dashboard_id, position) |
| widget_type | VARCHAR(40) NOT NULL | fixed catalogue, validated by the API |
| size | CHAR(1) NOT NULL CHECK IN ('S','M','L') | 1, 2, 3 columns of 3 |
| position | INTEGER NOT NULL | order within the dashboard |
| settings | JSONB NOT NULL DEFAULT '{}' | at most 1 KB, validated per widget type (unknown keys rejected) |

## Tasks (ADR-127, migrations `b7d1f3a5c9e2`, `c8e2a4b6d0f1`, `d1f4a6c8e0b3`)

### `task_statuses`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| code | VARCHAR NOT NULL | UNIQUE (tenant_id, code); lowercase slug, never changes |
| label | VARCHAR NOT NULL | tenant-editable display name |
| category | VARCHAR NOT NULL CHECK IN ('todo','in_progress','done') | the fixed meaning the code relies on |
| color | VARCHAR NULL | `#rrggbb` |
| sort_order | INTEGER NOT NULL DEFAULT 0 | |
| is_default | BOOLEAN NOT NULL DEFAULT false | partial UNIQUE index on (tenant_id) WHERE is_default |

Seeded with To Do (default), In Progress, Done for every existing tenant and at tenant creation.

### `tasks`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | UNIQUE (id, project_id) so children can reference it |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| project_id | UUID NOT NULL FK projects | |
| parent_task_id | UUID NULL | composite FK (parent_task_id, project_id) -> tasks (id, project_id): a sub-task is in its parent's project |
| depth | INTEGER NOT NULL DEFAULT 0 | CHECK 0..4; CHECK (parent is null and depth = 0) or (parent not null and depth > 0); trigger `trg_tasks_depth`: depth = parent.depth + 1, and a task cannot be moved under itself or its own descendants |
| display_seq / display_id | INTEGER / TEXT NULL | `TASK_000001`; UNIQUE (tenant_id, display_id); immutable (trigger `trg_tasks_display_id_immutable`); counter kind `task` in `entity_counters` |
| title | VARCHAR NOT NULL | CHECK 3..255 characters |
| description | TEXT NULL | |
| status_id | UUID NOT NULL FK task_statuses | |
| priority | VARCHAR NOT NULL DEFAULT 'Medium' | `field_options` key `task_priority`, validated in the service |
| assignee_id | UUID NULL FK users | a member of the project |
| release_id | UUID NULL FK releases | same project; set NULL when the release is deleted |
| start_date / due_date | DATE NULL | CHECK start <= due; a sub-task's due date cannot exceed its parent's (service) |
| completed_at | TIMESTAMPTZ NULL | set while the status category is `done` |
| created_by | UUID NOT NULL FK users | |
| created_at / updated_at | TIMESTAMPTZ NOT NULL | |
| deleted_at | TIMESTAMPTZ NULL | soft delete: every ORM select excludes it (`models/soft_delete.py`) |

Indexes: `ix_tasks_project_parent (project_id, parent_task_id) WHERE deleted_at IS NULL`, `ix_tasks_status`, `ix_tasks_assignee WHERE deleted_at IS NULL`.

### `task_test_case_links`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS |
| task_id | UUID NOT NULL FK tasks | |
| test_case_id | UUID NOT NULL FK test_cases | same project (service); UNIQUE (task_id, test_case_id); index on test_case_id |
| linked_by / linked_at | UUID FK users / TIMESTAMPTZ | |

### Columns and constraints added elsewhere
- `requirements.task_id`, `defects.task_id` UUID with composite FK `(task_id, project_id) -> tasks (id, project_id)` (a record can only point at a task of its own project) and a partial index WHERE task_id IS NOT NULL. `defects.task_id` is nullable. `requirements.task_id` is NOT NULL since ADR-128 (migration `e2f5b7c9d1a3`, which filed every requirement that had no task under a new per-project task first).
- `tasks.is_requirements_home` BOOLEAN NOT NULL DEFAULT false (ADR-128): the project's "Unassigned requirements" task; partial UNIQUE index `uq_tasks_requirements_home (project_id) WHERE is_requirements_home AND deleted_at IS NULL`.
- `comments.owner_type` and `attachments.owner_type` accept `'task'`; `entity_counters.kind` accepts `'task'`; `field_options.field_key` accepts `'task_priority'`.
- Permissions `task.manage`, `task.transition`, `task_status.manage` (see ADR-127 for the role grants).

## Audit (FR-ADM-002) — insert-only, hash-chained (ADR-006)

### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK tenants | RLS; platform-level actions use a reserved NULL-tenant partition exempted from tenant RLS but still insert-only |
| user_id | UUID NULL FK users | NULL for system-initiated actions |
| action | TEXT NOT NULL | e.g. `project.created`, `testcase.approved`, `defect.status_changed` |
| entity_type | TEXT NOT NULL | |
| entity_id | UUID NOT NULL | |
| metadata | JSONB NULL | non-PII contextual detail only |
| prev_hash | TEXT NOT NULL | |
| record_hash | TEXT NOT NULL | sha256(prev_hash \|\| canonical_json(row)) |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

DB grants: application role has `INSERT, SELECT` only on `audit_logs`; `UPDATE`/`DELETE` are revoked (ADR-006). No service-layer method exists to mutate or delete a row.

## Indexing summary (beyond PK/UNIQUE above)
- All `tenant_id` columns: btree index (RLS predicate performance).
- `test_cases(project_id, status)`, `test_run_cases(test_run_id, status)`, `execution_steps(test_run_case_id)`, `defects(project_id, status, severity)`, `audit_logs(tenant_id, created_at DESC)` for dashboard/reporting query paths (FR-DASH, FR-REP).
- ADR-123 (migration `e3a5c7d9f1b4`, built CONCURRENTLY): `ix_test_run_cases_tenant_due (tenant_id, due_date) WHERE due_date IS NOT NULL` for the overdue and upcoming-milestone queries and `ix_releases_tenant_project_date (tenant_id, project_id, release_date) WHERE release_date IS NOT NULL` for upcoming releases. The project aggregates (`/reports/project-test-status`, `module-coverage`, `tester-performance`) reuse `ix_test_run_cases_tenant_case`, `ix_test_runs_tenant_project` and `ix_test_cases_tenant_project_created` (ADR-113).

## Row-Level Security policy shape (applies to every tenant-owned table except `sessions` and `mfa_challenges`, see ADR-015)
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```
The backend sets `app.current_tenant` from the authenticated session at the start of every request-scoped transaction (ADR-007); it is never taken from client input.

## Changes for ADR-139 to ADR-141

- `projects`: `domain`, `manager_name`, `start_date`, `end_date`, `budget`, `region` are nullable and the domain check is gone (`c2e4a6b8d0f1`). The date-order and non-negative budget checks remain. `archived_at TIMESTAMPTZ`, `archived_by UUID FK users`, partial index `ix_projects_archived` (`d3f5b7a9c1e2`).
- `tenants.project_domains JSONB NULL`: the organization's domains; NULL = the built-in list.
- Triggers `archived_guard_<table>_<insert|update|delete>` on 27 tables that hold project records; they raise SQLSTATE `QT001`.
- `users`: unique `(id, tenant_id)`, so other tables can require a user of the same tenant.
- `teams(id, tenant_id, name, lead_user_id, created_at)`: unique `(tenant_id, lower(name))`; `(lead_user_id, tenant_id)` references users.
- `team_members(id, tenant_id, team_id, user_id, created_at)`: unique `(team_id, user_id)`; composite foreign keys to the team and the user of the same tenant. Both tables have forced row-level security.
