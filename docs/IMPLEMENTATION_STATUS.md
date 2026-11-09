# Implementation Status

Living document. Update at the end of every phase: what was completed, what tests pass, what remains. Read this + `ARCHITECTURE.md` first whenever resuming work after context loss.

## Phase plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture analysis, DB schema, module boundaries, BRD ambiguity resolution (this phase) | **Done** |
| 1 | Repo scaffolding: Docker Compose (api/db/web), FastAPI skeleton, Alembic baseline migration for all tables in `DATABASE_SCHEMA.md`, Vite+React+TS skeleton, CI-equivalent lint/type/test commands wired | **Done** |
| 2 | Platform Administration + Authentication + User Management (FR-AUTH, FR-ADM-001, tenant bootstrap ADR-008) | **Done** |
| 3 | Project Management (FR-PROJ) | Not Started |
| 4 | Test Case Management + Versioning + Approval workflow (FR-TC-001, FR-TC-003) | Not Started |
| 5 | CSV Bulk Import/Export (FR-TC-002) | Not Started |
| 6 | Test Execution Engine (FR-EXEC-001/002/003) | Not Started |
| 7 | Defect Management + step-level traceability (FR-DEF-001/002) | Not Started |
| 8 | Dashboard + Reporting & Analytics + Compliance export (FR-DASH, FR-REP) | Not Started |
| 9 | Audit log hardening, RLS verification, security review, accessibility pass, Playwright E2E suite across all journeys in BRD §9 | Not Started |

## Phase 0 deliverables (this phase)
- [x] `docs/MASTER_SPEC.md`
- [x] `docs/ARCHITECTURE.md`
- [x] `docs/DATABASE_SCHEMA.md`
- [x] `docs/API_SPECIFICATION.md` (inventory level)
- [x] `docs/REQUIREMENT_TRACEABILITY.md` (skeleton, all Not Started)
- [x] `docs/ARCHITECTURE_DECISIONS.md` (14 ADRs resolving all identified BRD ambiguities)
- [x] `docs/KNOWN_GAPS.md`
- [x] `docs/IMPLEMENTATION_STATUS.md` (this file)

## Phase 1 deliverables (this phase)
- [x] `backend/` — FastAPI skeleton (`app/main.py`, `/api/v1/health`), SQLAlchemy models for all 19 tables in `DATABASE_SCHEMA.md`, `app/core/{config,db,security}.py`.
- [x] Alembic migrations, applied and verified against a real PostgreSQL instance:
  - `f5d4daf618a8` — baseline schema (all tables, constraints, indexes, the `test_cases ↔ test_case_versions` circular FK).
  - `7bca6b69ef88` — RLS policies on every tenant-scoped table (ADR-007), least-privilege `qtesthub_app` role with UPDATE/DELETE revoked on `audit_logs` (ADR-006), RBAC seed data (ADR-014).
- [x] `alembic check` reports zero drift between models and DB.
- [x] Verified end-to-end: cross-tenant RLS isolation (app role sees only its `SET app.current_tenant` tenant, zero rows with no context set), and `UPDATE`/`DELETE` on `audit_logs` rejected with `permission denied` for the app role.
- [x] Backend tooling green: `pytest` (1 passed), `ruff check` (clean), `mypy` (no issues).
- [x] `frontend/` — Vite + React 19 + TypeScript skeleton, Tailwind v4, shadcn/ui wiring (`components.json`, `cn` helper, a `Button` component), React Router, TanStack Query, React Hook Form + Zod installed, Vitest + Testing Library, Playwright config.
- [x] Frontend tooling green: `vitest run` (1 passed), `tsc -b` (clean), `oxlint` (clean), production `vite build` succeeds, `playwright test --list` resolves the smoke spec.
- [x] `docker-compose.yml` (db/api/web) built and run successfully together: migrations ran automatically on container start, `GET /api/v1/health` returned `200` through the published port, the Vite dev server served the app shell on `:5173`.

## Known issue found and fixed during this phase
An `op.create_table(...)` with an embedded `use_alter=True` circular foreign key (`test_cases.current_version_id → test_case_versions.id`) does **not** auto-emit the deferred `ALTER TABLE` — Alembic's autogenerate confirmed the FK was silently absent from the live schema. Fixed by explicitly adding `op.create_foreign_key(...)` after both tables exist in the baseline migration; re-verified with `alembic check` showing no further drift.

## Phase 2 deliverables (this phase)
- [x] `app/core/auth.py` — session-cookie resolution (`get_current_context`), `require_permission(code)` RBAC dependency, cookie helpers.
- [x] `app/core/audit.py` — hash-chained `record_audit_event()` with a per-tenant advisory lock (ADR-016) for concurrency safety.
- [x] `app/core/platform_auth.py` + `scripts/seed_platform_admin.py` — HTTP Basic auth against the RLS-exempt `platform_admins` table, seeded out-of-band (ADR-008).
- [x] `app/services/{platform,auth,user}_service.py`, `app/api/{platform,auth,users}.py` — full `/platform/tenants`, `/auth/*`, `/users/*` surfaces from `API_SPECIFICATION.md`.
- [x] Enforced in code and verified by tests: GAP-10's password policy (12 chars + upper/lower/digit), FR-ADM-001's last-admin deletion guard, ADR-009's GDPR pseudonymization, FR-AUTH-003's MFA 3-attempt lockout, ADR-007's tenant isolation at the API layer.
- [x] 9 integration tests (`tests/test_auth_flow.py`) against a real, freshly-migrated PostgreSQL test database (not mocks) — full bootstrap→login→MFA→me flow, logout revocation, generic invalid-credentials error, MFA lockout, cross-tenant isolation on `/users`, last-admin guard, duplicate-email rejection, GDPR erase. All passing; `ruff`/`mypy` clean.
- [x] Full stack re-verified live via `docker compose up`: all 4 migrations ran automatically, and the complete bootstrap → login → MFA verify → `/auth/me` → `/users` flow was exercised over real HTTP against the running `qtesthub_app` role.

## Real bugs found and fixed during this phase (all via actual execution, not inspection)
1. **RLS chicken-and-egg on session lookup**: resolving a session cookie requires reading `sessions` before the tenant is known, but RLS requires the tenant to be known first. Fixed by exempting `sessions`/`mfa_challenges` from RLS (ADR-015) — security for those two tables rests on the row id being an unguessable UUID, same trust model as a password-reset token.
2. **`SET LOCAL` doesn't accept bind parameters** — `set_tenant_context` was passing `:tenant_id` as a parameter to a `SET LOCAL` statement, which PostgreSQL rejects outright. Fixed using `set_config('app.current_tenant', :tenant_id, true)`, which does support parameters.
3. **Empty-string GUC after commit** — a transaction-local custom GUC placeholder reverts to `''` (not `NULL`) once its transaction commits, so the RLS policy's `::uuid` cast threw on the very next transaction. Fixed with `NULLIF(current_setting(...), '')::uuid` (migration `567fa7545de9`).
4. **`expire_on_commit=True` (SQLAlchemy default) broke every commit-then-respond route** — after a service's `db.commit()`, FastAPI building the response from the same ORM object triggered a refresh query in a new transaction with no tenant context, which RLS denied, surfacing as `ObjectDeletedError`. Fixed by setting `expire_on_commit=False` on `SessionLocal` — a systemic fix, not a one-off, since this pattern (commit once, then serialize) is used by every service in this codebase.
5. **Email-only login is architecturally impossible** under correct RLS, since `users.email` is only unique per tenant. Resolved via ADR-017: login requires an explicit `tenant_id` in the request.
6. **`UserOut.model_validate(user)` can't work** — the ORM `User` model has `role_id`, not a `role` code string, so direct validation from the ORM object always failed. Fixed with an explicit `user_service.to_out()` serializer that resolves the role code.

## Open items before Phase 3 can start
See `KNOWN_GAPS.md` → "Open questions requiring explicit stakeholder confirmation," plus GAP-11 (dev-only plaintext credentials in compose/`.env.example` — fine for local dev, must not reach any real deployment). The `region` field type (free text vs. enum) should be confirmed before Project Management is marked `Done`. GAP-10 (password policy) is now resolved per the decision already recorded there (12-char minimum + complexity, enforced in `app/schemas/common.py`).
