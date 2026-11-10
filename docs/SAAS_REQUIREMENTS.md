# SaaS Requirements — QTestHub

**Purpose.** This document captures the requirements from the "SaaS Product Vision — Mandatory" directive, kept separate from the existing BRD (`MASTER_SPEC.md`, `REQUIREMENT_TRACEABILITY.md`). Per that directive: *"The existing QTestHub BRD remains the primary source of truth for existing business functionality. Do not remove, weaken or replace any BRD requirement."* Nothing here supersedes a BR-numbered requirement — this is additive, platform-level scope.

Each requirement is scored against the codebase as it exists today (audited across three parallel read-only passes — see `docs/SAAS_GAP_ANALYSIS.md` for full evidence and citations) and classified per the directive's own scheme:

- **F — Required for initial SaaS foundation**: the architecture would be structurally wrong without it; retrofitting later is expensive.
- **L — Required before production launch**: the app could run today in a controlled/internal setting without it, but shipping it to real paying customers without this is irresponsible.
- **E — Future enhancement**: valuable, not blocking either of the above.

Status values: **Done**, **Partial**, **Missing**. A requirement already fully covered by an existing BRD mechanism is marked **Done (via BRD)** with a cross-reference, since the SaaS vision and the BRD overlap heavily on tenancy/security.

---

## SR-1. SaaS Architecture

| ID | Requirement | Status | Class | Notes |
|---|---|---|---|---|
| SR-1.1 | Multiple independent customer organizations | Done (via BRD) | — | `Tenant` model, every business table `tenant_id`-scoped (ADR-007). |
| SR-1.2 | Tenant-specific workspaces | Done (via BRD) | — | Tenant *is* the workspace in this design; no separate workspace-within-tenant concept exists or is needed for current scope. |
| SR-1.3 | Tenant-level data isolation | Done (via BRD) | — | PostgreSQL RLS on all 14 tenant-scoped tables + session-derived (never client-supplied) tenant context (ADR-007, ADR-015). |
| SR-1.4 | Tenant-specific users, roles, permissions | Partial | E | Users/role-assignment are tenant-scoped; *roles themselves* are a fixed 3-role global seed (admin/manager/tester) — no tenant-defined custom roles (GAP-05, intentional BRD-scope decision, not a bug). |
| SR-1.5 | Centralized platform administration | Done (via BRD) | — | `backend/app/api/platform.py`, `frontend/src/routes/PlatformAdmin.tsx`, fully separate from tenant auth (ADR-008). |
| SR-1.6 | Configurable subscription plans | Missing | F | Zero code exists — no plan/tier model, no entitlements, no limits. See SR-3. |
| SR-1.7 | Future billing/payment integration points | Missing | L | No stub fields, no placeholder schema. Explicitly **not** required to build the integration itself now (directive §3: "Do not integrate a payment gateway unless explicitly approved") — but the *schema room* to add it later without a breaking migration is itself a design decision that hasn't been made. |
| SR-1.8 | Horizontal scaling / cloud deployment readiness | Partial | L | Backend is stateless and env-configured (good); attachment storage is local-disk-only (GAP-07) which blocks multi-replica API scaling without a shared/network volume; frontend's Docker image runs the dev server, not a production static build. |
| SR-1.9 | Clear module boundaries | Done (via BRD) | — | `backend/app/{models,schemas,services,api,core}` consistently layered; no lower-layer-imports-route-layer violations found. |

## SR-2. Tenant Management

| ID | Requirement | Status | Class | Notes |
|---|---|---|---|---|
| SR-2.1 | Tenant registration and provisioning | Done (via BRD) | — | Platform-admin-driven (`POST /platform/tenants`), not self-service signup — acceptable for current scope; self-service signup is a distinct future product decision, not assumed here. |
| SR-2.2 | Tenant activation, suspension, deactivation | Done (via BRD) | — | `PATCH /platform/tenants/{id}/status`, enforced at login time too. |
| SR-2.3 | Tenant-specific configuration | Missing | L | `Tenant.default_currency_code`/`default_timezone` columns exist but have no read/write API or UI — set once at creation, never editable. |
| SR-2.4 | Tenant-specific user invitations | Missing | L | All users are directly created by an admin with an admin-set password. No email-verified invite/accept flow. |
| SR-2.5 | Tenant-specific project and test data | Done (via BRD) | — | Full FK chain, confirmed. |
| SR-2.6 | Tenant-aware file storage | Done (via BRD) | — | Path-partitioned per tenant (`{attachments_dir}/{tenant_id}/{test_case_id}/`); shares one physical volume across tenants (isolation is path-based, not storage-account-based — acceptable at current scale, revisit with SR-1.8). |
| SR-2.7 | Strict server-side tenant authorization | Done (via BRD) | — | `tenant_id` only ever derived from the verified session row, never client input (ADR-015). |
| SR-2.8 | Database-level tenant isolation via RLS | Done (via BRD) | — | Confirmed exhaustively — no tenant-scoped table found without `ENABLE`+`FORCE` RLS + policy. |

## SR-3. Subscription Architecture

**Status: Missing in its entirety. Classification: F for the data model/extension points; E for everything commercial.**

The directive is explicit that pricing/payment integration is *not* authorized without separate approval, and that limits must stay configurable rather than hardcoded. Accordingly:

| ID | Requirement | Status | Class |
|---|---|---|---|
| SR-3.1 | Plan/tier data model (Free Trial/Starter/Professional/Enterprise as *configurable* rows, not hardcoded) | Missing | F |
| SR-3.2 | Subscription lifecycle (active/trial/expired/cancelled) per tenant | Missing | F |
| SR-3.3 | Configurable entitlements (feature flags per plan) | Missing | L |
| SR-3.4 | Configurable limits (users/projects/storage) with soft/hard enforcement | Missing | L |
| SR-3.5 | Upgrade/downgrade workflow | Missing | E |
| SR-3.6 | Billing history / invoice records | Missing | E |
| SR-3.7 | Payment gateway integration | Missing, **not authorized** | E (explicitly deferred — do not build without separate approval per directive §3) |

See `docs/SAAS_GAP_ANALYSIS.md` SAAS-GAP-1 for the recommended foundation-only first step (a `plans`/`tenant_subscriptions` schema with no billing logic attached).

## SR-4. SaaS User Experience

| ID | Requirement | Status | Class | Notes |
|---|---|---|---|---|
| SR-4.1 | Clean, professional interface | Done | — | Delivered in this session's enterprise redesign (dark sidebar, consistent cards/tables/badges). |
| SR-4.2 | Responsive layouts | Missing | L | Sidebar is fixed-width with no collapse at any breakpoint; tables clip (`overflow-hidden`) instead of scrolling. Breaks visibly under ~768px. |
| SR-4.3 | Collapsible sidebar | Missing | L | No toggle, no persisted state, no icon-only mode. |
| SR-4.4 | Workspace switcher | N/A / Partial | — | A cross-*tenant* switcher doesn't map onto this architecture (a session is already tenant-bound by design, ADR-007/ADR-015) — switching tenants means logging in again, which is correct given the isolation model. Switching between *projects within* a tenant does exist (Projects page, Test Repository's project filter). |
| SR-4.5 | Global search | Missing | E | Only page-scoped filters exist; no cross-entity search or command palette. |
| SR-4.6 | Breadcrumb navigation | Done | — | `components/Breadcrumbs.tsx`, wired into the shell header. |
| SR-4.7 | Contextual actions | Partial | L | Present and role-gated on Projects/Execution Console/Admin/Test Repository; not found on the Defects list. |
| SR-4.8 | Reusable components | Done | — | Shared `components/ui/` primitives used consistently. |
| SR-4.9 | Consistent tables, filters, forms | Done | — | Verified consistent markup pattern across all major list pages. |
| SR-4.10 | Light and dark themes | Partial | L | Dark-mode tokens exist and are correctly wired (including all new redesign tokens) and follow OS preference; there is no in-app manual toggle. |
| SR-4.11 | Notifications and activity feeds | Partial | L | Dashboard's Recent Activity feed is real (audit-log-backed); the header notification bell is an intentional empty-state placeholder with no backend — a visible inconsistency worth closing. |
| SR-4.12 | Loading/empty/error/success states | Partial | L | Loading/empty/error states are consistently handled; there is **no toast/confirmation system anywhere** — successful mutations rely solely on a dialog closing or a list silently refreshing. |
| SR-4.13 | Accessible components | Partial | L | `@axe-core/playwright` WCAG2A/AA scanning exists but only covers the 5 pre-redesign pages; every page this session's redesign added or substantially reworked (Test Repository, Test Runs Overview, Execution Console, Settings, Audit Logs) has zero accessibility test coverage. |
| SR-4.14 | Minimal clicks for common workflows | Done (where measured) | — | Quick-create/inline-action patterns genuinely reduce clicks for test case creation and fail→defect reporting (see SAAS_GAP_ANALYSIS for click counts); not every workflow was re-measured. |

## SR-5. Platform Administration

| ID | Requirement | Status | Class | Notes |
|---|---|---|---|---|
| SR-5.1 | Manage tenants (create/list) | Done | — | |
| SR-5.2 | View tenant status | Done | — | |
| SR-5.3 | Activate/suspend tenants | Done | — | |
| SR-5.4 | Configure subscription plans | Missing | F | Depends on SR-3. |
| SR-5.5 | Monitor platform usage (cross-tenant metrics) | Missing | L | No aggregation endpoint exists across tenants. |
| SR-5.6 | View system health | Partial | L | `/api/v1/health` exists but is liveness-only (no DB connectivity check) — not a true readiness probe. |
| SR-5.7 | Monitor background jobs | Missing (structurally N/A) | L | No background job system exists at all yet (see SR-6.7); this requirement is blocked on that one. |
| SR-5.8 | Review platform-level audit events | Partial | L | Platform actions *are* audited, but with `user_id=None` — no individual platform-admin attribution (GAP-13). |
| SR-5.9 | Platform admin authentication strength | Missing | L | HTTP Basic re-checked per request, no session, no MFA, no credential rotation (GAP-14) — materially weaker than the tenant auth it gates access to tenant *provisioning* for. |
| SR-5.10 | Tenant Admin: org settings | Missing | L | Same gap as SR-2.3. |
| SR-5.11 | Tenant Admin: invite/manage users | Partial | L | Direct-create exists; no invite flow (SR-2.4). |
| SR-5.12 | Tenant Admin: assign roles/permissions | Done | — | |
| SR-5.13 | Tenant Admin: manage projects | Done | — | |
| SR-5.14 | Tenant Admin: tenant-specific settings | Missing | L | Duplicate of SR-2.3/SR-5.10. |
| SR-5.15 | Tenant Admin: view tenant usage/activity | Partial | L | Audit log exists; no distinct usage dashboard (moot without SR-3 limits to measure against). |
| SR-5.16 | Controlled/audited platform-admin support access to tenant data | Done (by stronger means) | — | There is no code path at all from platform-admin auth into tenant data (RLS + separate auth entirely) — the directive asks for this to be "controlled and audited"; this codebase instead makes it architecturally impossible, which satisfies the underlying intent (no support-driven data exposure) even though it doesn't literally implement an audited break-glass mechanism. If a future support workflow genuinely needs platform-admin read access to a tenant's data, that would be new, explicitly-scoped work, not an extension of today's design. |

## SR-6. Cloud Readiness

| ID | Requirement | Status | Class | Notes |
|---|---|---|---|---|
| SR-6.1 | Dockerized application | Partial | L | Compose + healthchecks on all 3 services exist; backend image is single-stage/root-user; frontend image runs the Vite **dev server** as its only CMD — no production build+static-serve stage exists at all. |
| SR-6.2 | Environment-based configuration | Done | — | Pydantic `BaseSettings`, no hardcoded secrets. |
| SR-6.3 | Externalized secrets | Done | — | `.env`-driven, `POSTGRES_PASSWORD` fails fast if unset. |
| SR-6.4 | Database migrations | Done | — | 16-migration Alembic chain, run automatically on container start. |
| SR-6.5 | Persistent object storage | Missing | L | Local filesystem only (GAP-07) — blocks multi-replica scaling. |
| SR-6.6 | Centralized application logging | Partial | L | Structured per-request logging exists but is plain-text (not JSON), stdout-only, no correlation/request ID, no shipping destination. |
| SR-6.7 | Health and readiness endpoints | Partial | L | `/api/v1/health` is liveness-only; no DB-connectivity readiness check. |
| SR-6.8 | Error monitoring | Missing | L | No Sentry/Rollbar/equivalent anywhere. |
| SR-6.9 | Database backup and restore | Missing | L | No script, no documented procedure anywhere in the repo. |
| SR-6.10 | Background job management | Missing | L | No Celery/RQ/Redis/task queue exists at all; CSV import (up to 2,000 rows) runs fully synchronously in-request. |
| SR-6.11 | Secure file uploads | Done | — | Extension allowlist + magic-byte content-sniffing (GAP-66, fixed this session) + size cap. |
| SR-6.12 | HTTPS deployment | Partial | L | No TLS/reverse-proxy config in the dev compose stack (expected at this layer); session cookie's `Secure` flag is already environment-conditional, so it will work correctly once a production `ENVIRONMENT` + TLS-terminating proxy are introduced. |
| SR-6.13 | Rate limiting | Partial | L | Only `POST /auth/login` and `POST /auth/mfa/verify` are rate-limited (10/min, IP-keyed, in-memory/non-distributed); every other endpoint is unthrottled. |
| SR-6.14 | Secure session management | Done | — | Idle timeout, absolute expiry, revocation, HttpOnly/SameSite=Lax/conditional-Secure cookie, all confirmed. |

## SR-7. Security and Compliance

Already thoroughly covered by the existing `docs/Security_Test_Report.md` (73 passing security tests this session) — this requirement set is **Done** with two caveats classified below. See that report for full detail; not re-litigated here.

| ID | Requirement | Status | Class | Notes |
|---|---|---|---|---|
| SR-7.1 | Strong authentication, MFA, RBAC, tenant isolation, password hashing, session expiry/revocation, audit logging, input validation, secure file handling, OWASP protections | Done | — | Verified via `Security_Test_Report.md` + direct code re-confirmation. |
| SR-7.2 | Rate limiting (as a security control, not just UX) | Partial | L | Same gap as SR-6.13 — the narrow scope is a real security gap (brute-force/DoS surface on unthrottled write endpoints), not just an operational one. |
| SR-7.3 | Backup and recovery procedures | Missing | L | Same as SR-6.9. |
| SR-7.4 | Keep security documentation current | Partial | L | `docs/Security_Test_Report.md` currently misreports the file-upload content-sniffing item as an open finding; it was fixed later in this same session (GAP-66) and the report was never updated. Needs a correction pass, not a new security fix. |

## SR-8. Scope and BRD Governance

| ID | Requirement | Status | Class |
|---|---|---|---|
| SR-8.1 | BRD remains primary source of truth; nothing removed/weakened | Done | — |
| SR-8.2 | Additional SaaS requirements tracked separately (this document + its companions) | Done (as of this document) | — |
| SR-8.3 | No unapproved billing/payment/SSO/commercial functionality introduced | Done | — | Confirmed nothing of the kind exists; must stay true going forward. |

## SR-9. Architecture Quality

| ID | Requirement | Status | Class | Notes |
|---|---|---|---|---|
| SR-9.1 | Separation of concerns / modular backend | Done | — | |
| SR-9.2 | Reusable frontend components | Done | — | |
| SR-9.3 | API versioning | Partial | E | `/api/v1` is a static prefix with no actual version-negotiation mechanism — fine today, worth a real strategy before a breaking v2 is ever needed. |
| SR-9.4 | Database constraints and indexes | Done | — | |
| SR-9.5 | Transaction management | Done | — | |
| SR-9.6 | Automated unit/integration tests | Done | — | 163 backend tests, real Postgres, not mocks. |
| SR-9.7 | Tenant isolation tests | Done | — | |
| SR-9.8 | Centralized exception handling | Partial | L | `AppError` and `RateLimitExceeded` are handled with a consistent envelope; there is **no generic `Exception`/500 handler**, so a genuine bug produces Starlette's default (inconsistent) error shape instead of the app's `{"data":null,"error":{...}}` envelope. |
| SR-9.9 | API documentation | Done | — | FastAPI auto-docs enabled by default (`/docs`, `/redoc`, `/openapi.json`); hand-written `API_SPECIFICATION.md` is a reasonable high-level companion. |

---

See `docs/SAAS_ARCHITECTURE.md` for how these requirements map onto the recommended vs. current architecture, and `docs/SAAS_GAP_ANALYSIS.md` for the prioritized remediation plan with full evidence citations.
