# Architecture — QTestHub Enterprise TMS

## Style
Modular monolith. One FastAPI deployable, one PostgreSQL database, internally organized into independent modules with explicit boundaries (own models/schemas/routes/services/repository), to keep operational simplicity while avoiding a tangled codebase. No premature microservices split.

```
React + TypeScript (Vite, Tailwind, shadcn/ui) SPA
                |  REST (JSON), HTTP-only session cookie
                v
FastAPI application
  ├─ api/            route handlers per module (thin: parse, authorize, call service)
  ├─ services/        business logic per module
  ├─ repositories/     tenant-scoped data access per module
  ├─ models/           SQLAlchemy ORM models
  ├─ schemas/          Pydantic request/response models
  └─ core/             auth, tenancy context, audit hook, config
                |
                v
PostgreSQL (RLS enabled) — Docker Compose for local/dev
Filesystem volume — attachments (ADR-012)
```

## Module boundaries (backend)
Matches the 12 modules named in the brief; each owns its slice of the schema in `DATABASE_SCHEMA.md` and does not reach into another module's tables directly — cross-module reads go through that module's service, not raw ORM joins, except for read-optimized reporting queries (Reporting module is explicitly allowed to query across modules read-only).

| Module | Owns tables | Depends on |
|---|---|---|
| Authentication | sessions, mfa_challenges | Tenant Mgmt, User Mgmt |
| Tenant Management | tenants, platform_admins | — |
| User Management | users, roles, permissions, role_permissions | Tenant Mgmt |
| Project Management | projects, project_members | User Mgmt |
| Test Case Management | test_cases | Project Mgmt, User Mgmt |
| Test Case Versioning | test_case_versions, test_case_version_steps | Test Case Mgmt |
| CSV Import/Export | (writes through Test Case Mgmt + Versioning services) | Test Case Mgmt, Project Mgmt, User Mgmt |
| Test Execution | test_runs, test_run_cases, execution_steps | Test Case Versioning, Project Mgmt |
| Defect Management | defects, defect_links | Test Execution, Test Case Mgmt, Project Mgmt |
| Reporting | (read-only cross-module queries) | all of the above |
| Dashboard | (read-only cross-module queries) | all of the above |
| Audit Management | audit_logs | consumed by all modules via one `record_audit_event()` call, never written directly |
| (cross-cutting) Attachments | attachments | referenced by Test Case, Defect, Execution modules |

## Tenant isolation (ADR-007)
Two independent, redundant layers — one is not trusted alone:
1. Every repository method requires a `TenantContext` object (derived only from the verified session, never request body/query params) and auto-applies `tenant_id = ctx.tenant_id`.
2. PostgreSQL RLS policies as a backstop in case application code has a bug.

## Request lifecycle
1. Client sends request with HTTP-only session cookie.
2. `core/auth` middleware resolves the session → `(tenant_id, user_id, role)`, rejects if missing/expired/MFA-incomplete for protected routes.
3. A DB transaction is opened; `SET LOCAL app.current_tenant = :tenant_id` runs first.
4. Route handler → service (authorization check against `role_permissions`) → repository (tenant-scoped query).
5. On any state-changing action, the service calls `audit.record_audit_event(...)` inside the same transaction (append-only, hash-chained — ADR-006) so an audit record and its triggering change commit atomically or not at all.
6. Response uses a consistent envelope (see API_SPECIFICATION.md).

## Test execution architecture (ADR-004)
`test_runs` (the cycle) → `test_run_cases` (bundled case, pinned to a `test_case_version_id` per ADR-003) → `execution_steps` (one row per step, authoritative timing + verdict, ADR-002/ADR-013). Rollup `test_run_cases.status` is recomputed server-side from its `execution_steps` verdicts (any `fail` ⇒ case `failed`), never trusted from the client, satisfying FR-EXEC-002's "marking any step Fail automatically flags the test case verdict as Failed."

## Versioning architecture (ADR-003)
`test_cases` is the stable identity; `test_case_versions` + `test_case_version_steps` are immutable snapshots. Approving a case or editing an approved case always produces a new version row; nothing is ever mutated in place once a version exists. Executions always reference a pinned version, so reporting/audits reconstruct exactly what was tested.

## CSV import architecture (FR-TC-002, GAP-09)
Staged, transactional, chunked:
1. Upload → persisted to a staging table/temp storage with a batch id.
2. Full validation pass (project exists, assignee resolves, step pipe/semicolon parsing) produces a per-row report before any write to `test_cases`.
3. Valid rows are inserted in a single DB transaction per batch (or chunked sub-transactions for very large files) so a mid-batch failure cannot corrupt partial state; invalid rows are reported back without blocking valid ones (per FR-TC-002 acceptance criteria).

## Frontend architecture
- Vite + React + TypeScript SPA, React Router for navigation matching the application hierarchy (Platform Admin vs Tenant Workspace shells).
- TanStack Query owns all server state/caching; no client-side Redux-style duplication of server data.
- React Hook Form + Zod schemas mirror backend Pydantic validation for immediate UX feedback, but the backend is always the authority (never trust client-side validation alone).
- shadcn/ui + Tailwind for the component system; Recharts for FR-DASH/FR-REP visualizations.
- Browser storage (`localStorage`) used only for: unsent draft recovery (ADR-010), remembered UI preferences (last filter, collapsed panel) — never as the source of truth for tenant data.

## Security architecture summary
- Argon2id password hashing; HTTP-only, `SameSite=Lax`, `Secure` session cookies (no tokens in `localStorage`).
- MFA (ADR-011) as a second step before a session is marked usable for non-auth routes.
- RBAC enforced server-side from `roles`/`permissions` tables (ADR-014); frontend hides controls as a UX nicety only, never as the actual gate.
- RLS + tenant-scoped repositories (ADR-007).
- Audit trail (ADR-006) on every privileged mutation.

## Deployment
Docker Compose: `api` (FastAPI/uvicorn), `db` (PostgreSQL + named volume), `web` (built Vite static bundle served via a lightweight server or the same reverse proxy). Alembic migrations run as a pre-start step, never auto-generated against prod without review.
