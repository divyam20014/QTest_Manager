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
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### `platform_admins`
Bootstrap-only (ADR-008). Not a tenant role.
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| email | CITEXT UNIQUE NOT NULL | |
| password_hash | TEXT NOT NULL | Argon2id |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

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
| code | TEXT UNIQUE NOT NULL | e.g. `project.create`, `testcase.approve`, `defect.close` |
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
| pseudonymized_at | TIMESTAMPTZ NULL | set when GDPR erasure applied (ADR-009) |

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
| finished_at | TIMESTAMPTZ NULL | |

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

## Row-Level Security policy shape (applies to every tenant-owned table except `sessions` and `mfa_challenges`, see ADR-015)
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```
The backend sets `app.current_tenant` from the authenticated session at the start of every request-scoped transaction (ADR-007); it is never taken from client input.
