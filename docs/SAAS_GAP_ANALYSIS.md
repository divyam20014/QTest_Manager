# SaaS Gap Analysis — QTestHub

Companion to `docs/SAAS_REQUIREMENTS.md` (the requirement-by-requirement scorecard) and `docs/SAAS_ARCHITECTURE.md` (the recommended-vs-current architecture). This document is the prioritized remediation list: every real gap found, classified, with evidence and a recommended first step. Produced from three parallel read-only audits against the live codebase (not from this directive's text alone) — every citation below was verified by reading the actual file.

Classification:
- **F — Required for initial SaaS foundation** (structural; expensive to retrofit later)
- **L — Required before production launch** (app works today without it, but it would be irresponsible to launch to real customers without it)
- **E — Future enhancement**

Status of this analysis as originally written: **audit only — nothing below has been implemented.** Per standing instruction, no code changes were made while producing this document.

**Update (ADR-041, GAP-70):** a first, deliberately scoped fix batch has since closed 7 of the L items below (marked **✅ RESOLVED (ADR-041)** inline) — the cheap, low-risk, well-specified ones. Everything else, including all 3 F items and the remaining L items that need a real design decision (rate-limit scope, structured logging, production Docker image, subscription schema, platform-admin hardening, tenant settings/invites), is still open.

---

## F — Required for initial SaaS foundation

### SAAS-GAP-1: ✅ RESOLVED (ADR-053, Tier 1) — No subscription/billing data model at all
**Evidence:** exhaustive grep across `backend/app/` and `frontend/src/` for `subscription|plan_id|tier|entitlement|trial|upgrade|downgrade|billing|stripe|invoice|payment|user_limit|project_limit|storage_limit` — zero matches outside this audit's own output.
**Why foundational:** every other SaaS capability (platform-admin plan configuration, tenant limit display, future billing) depends on this schema existing first. Retrofitting it after tenants and usage data already exist is still possible but strictly harder than building it alongside the rest of the foundation.
**Recommended first step:** the `plans`/`tenant_subscriptions` schema described in `SAAS_ARCHITECTURE.md` §3 — schema + a read-only "current plan" endpoint only, no enforcement, no billing fields. Explicitly **not** authorized to build payment integration (directive §3).
**Resolution (2026-11-10):** `plans` (platform-wide catalog) + `subscriptions` (one row per tenant, RLS-protected) added. Platform-admin assigns/updates a tenant's plan (`PUT /platform/tenants/{id}/subscription`); the tenant side is read-only (`GET /settings/subscription`). Every tenant defaults to a seeded Trial plan. Schema/record-keeping only, exactly as scoped — no payment gateway, no billing engine. See ADR-053.

### SAAS-GAP-2: Frontend Docker image runs the dev server, not a production build
**Evidence:** `frontend/Dockerfile` line 12, `CMD ["npm","run","dev","--","--host","0.0.0.0"]`. No multi-stage build, no `npm run build` + static-serve stage exists anywhere in the repo.
**Why foundational:** this isn't a hardening item to add later — it means there is currently no artifact that could be deployed to a real environment at all. "Dockerized application" (directive §6) is not actually satisfied for the frontend as things stand.
**Recommended first step:** a second Dockerfile stage — `npm run build` then serve `dist/` via a minimal static server (`serve`, `nginx:alpine`, or similar), keeping the current dev-server Dockerfile available for local development (docker-compose already separates dev usage cleanly, so this is additive, not a replacement).

### SAAS-GAP-3: ✅ RESOLVED (ADR-053, Tier 1) — Local-disk-only attachment storage blocks horizontal scaling
**Evidence:** `backend/app/services/attachment_service.py` writes to `Path(settings.attachments_dir) / tenant_id / test_case_id`, backed by one Docker named volume. Already documented as `GAP-07` in `docs/KNOWN_GAPS.md`.
**Why foundational:** every other SaaS-readiness item (multi-replica API, real cloud deployment) is blocked behind this one. The schema is already storage-backend-agnostic (per GAP-07's own note), so this is purely a service-layer swap, not a data-model change — but it needs to happen before any multi-replica deployment is attempted, not after.
**Recommended first step:** no code change until horizontal scaling is actually planned (per GAP-07's own closing condition: "when multi-node/horizontal scaling is needed"). Listed under F here only because *if and when* that scaling work starts, this must be the first piece, not a follow-on afterthought.
**Resolution (2026-11-10):** a pluggable `StorageBackend` abstraction (`app/core/storage.py`) now sits in front of `attachment_service.py`; `LocalFilesystemStorage` (default, unchanged behavior) and `S3CompatibleStorage` (AWS S3 or any S3-compatible endpoint, via `STORAGE_BACKEND=s3`) implement the same interface, confirming GAP-07's own note that this was purely a service-layer swap. See ADR-053.

---

## L — Required before production launch

### SAAS-GAP-4: ✅ RESOLVED (ADR-052, Tier 0) — Platform-admin actions are not individually attributed
**Evidence:** `backend/app/services/platform_service.py` lines ~40-57, ~73-81 — every `record_audit_event(...)` call for `tenant.created`/`tenant.status_changed` passes `user_id=None`. This is `GAP-13` in `docs/KNOWN_GAPS.md`, confirmed still accurate by direct code read.
**Why launch-blocking:** tenant provisioning and suspension are high-privilege actions; an audit trail that can't say *which* platform admin suspended a customer is a real compliance/accountability gap the moment there's more than one platform admin.
**Recommended first step:** per `SAAS_ARCHITECTURE.md` §2 — a nullable `platform_admin_id` column (or parallel table) on the audit trail.
**Resolution (2026-11-10):** `audit_logs` gained a nullable `platform_admin_id` FK (migration `b7c8d9e0f1a2`); `platform_service.py`'s `tenant.created`/`tenant.status_changed` events now carry the real authenticated admin's id instead of `user_id=None`. See ADR-052.

### SAAS-GAP-5: Platform Admin authentication has no session or MFA (partially addressed — see ADR-052)
**Evidence:** `backend/app/core/platform_auth.py` — plain `HTTPBasic` credential check against `platform_admins.password_hash` on every request. `GAP-14` in `docs/KNOWN_GAPS.md`, confirmed.
**Why launch-blocking:** this account can provision and suspend every customer tenant in the system — it is arguably the single highest-privilege credential in the whole platform, yet it's protected more weakly than an ordinary tenant user's login.
**Recommended first step:** per `SAAS_ARCHITECTURE.md` §2 — reuse the existing session+MFA pattern with a platform-admin-scoped session table.
**Partial resolution (2026-11-10, ADR-052):** a full session+MFA replacement was deliberately deferred — it would need a new non-tenant-scoped session/MFA model pair, a frontend auth-flow rewrite, and mechanical edits across 23 test call sites, out of proportion for the Tier 0 pass that closed the other L-priority gaps. Instead: brute-force lockout (5 failed attempts → 15 min lock, `platform_admins.failed_login_count`/`locked_until`) and rate limiting (see SAAS-GAP-6 below) were added to the existing HTTP Basic plane. The full replacement remains open for a future phase.

### SAAS-GAP-6: ✅ RESOLVED (ADR-052, Tier 0) — Rate limiting covers only 2 of dozens of endpoints
**Evidence:** `backend/app/core/rate_limit.py` (in-memory `slowapi.Limiter`, IP-keyed); applied only at `backend/app/api/auth.py` on `POST /auth/login` and `POST /auth/mfa/verify` (10/min each). Every other route across projects/test-cases/execution/defects/reporting/audit/attachments/csv-import/users was confirmed unthrottled by grep for `@limiter.limit` across the whole backend.
**Why launch-blocking:** a real multi-tenant SaaS product with unthrottled write endpoints (especially CSV import, which already does synchronous heavy work per request) is a DoS and resource-exhaustion risk from day one of having external customers.
**Recommended first step:** extend the existing limiter to write-heavy endpoints first (CSV import, bulk actions, create/update routes), not necessarily every GET; keep the existing login/MFA limits as-is.
**Resolution (2026-11-10):** extended to all `/platform/*` routes (60/min, uniformly — looser than login's 10/min since it also gates a read-only list the frontend re-polls, and the platform-admin lockout in SAAS-GAP-5 is the primary brute-force defense there), CSV import (10/min), and all three attachment-upload routes (30/min) — the write-heavy/resource-intensive endpoints this gap named.

### SAAS-GAP-7: ✅ RESOLVED (ADR-043, confirmed during the 2026-11-10 audit) — No tenant self-service settings
**Evidence:** `Tenant.default_currency_code`/`default_timezone` columns exist (`backend/app/models/tenant.py`) but grep across `backend/app/api/*.py` found no settings read/write endpoint. The frontend's own `Settings.tsx` is an explicit, honest stub (confirmed in this session's earlier redesign work) precisely because no backend exists to back it.
**Why launch-blocking:** a tenant admin cannot change their own organization's currency/timezone/MFA-delivery-mode after bootstrap — a basic expectation for a self-serve-feeling SaaS product, even in a sales-assisted onboarding model.
**Recommended first step:** `GET/PATCH /settings` (already named as a planned-but-unbuilt endpoint in `docs/API_SPECIFICATION.md` historically) backed by the existing `Tenant` columns.

### SAAS-GAP-8: ✅ RESOLVED (ADR-053, Tier 1) — No user-invite flow
**Evidence:** `backend/app/api/users.py` — `create_user` is direct admin-sets-password creation; no invite-token/pending-acceptance endpoints exist anywhere.
**Why launch-blocking:** admins currently must communicate a password out-of-band (email/chat) to every new user, which is both poor practice and poor UX for a product meant to onboard real customer teams.
**Recommended first step:** an invite-token table + `POST /users/invite` (creates a pending, password-less user + emailed token) + `POST /auth/accept-invite` (sets password, activates). Reuses the existing SMTP path already built for "real" MFA delivery mode.
**Resolution (2026-11-10):** `user_invites` table + `POST /users/invite` (tenant-admin-only, creates a hashed single-use token) + `POST /users/invite/{token}/accept` (public, sets password, activates). No `users` row exists until accepted. Reuses `notification_email_delivery_mode`'s existing simulated/real split (not a new SMTP path). Direct admin-sets-password creation (`POST /users`) is kept for scripts/back-compat but is no longer the recommended path. See ADR-053.

### SAAS-GAP-9: ✅ RESOLVED (ADR-041) — Responsive design was not addressed by the recent redesign
**Evidence:** `frontend/src/routes/AppShell.tsx` — fixed `w-60` sidebar with zero responsive classes, no collapse mechanism at any breakpoint. `TestRepository.tsx`, `DefectsList.tsx`, `TestRunsOverview.tsx` all wrap tables in `overflow-hidden` (clips content) rather than `overflow-x-auto` (scrolls).
**Why launch-blocking:** real customers will use tablets and narrower laptop screens; the app currently breaks (clips unreachable content, not just looks cramped) below ~768px.
**Recommended first step:** (a) change table wrappers from `overflow-hidden` to `overflow-x-auto` — a near-zero-risk one-line-per-file fix; (b) add a collapsible/off-canvas sidebar mode below a breakpoint (see SAAS-GAP-10, same component, worth doing together).

### SAAS-GAP-10: ✅ RESOLVED (ADR-041) — No collapsible sidebar
**Evidence:** `AppShell.tsx` — no toggle, no persisted collapse state, no icon-only mode.
**Why launch-blocking:** directly requested by the UI spec; also the practical fix for SAAS-GAP-9's mobile/tablet breakage (collapse-to-icons or off-canvas-on-narrow-viewports is the standard pattern other reference apps in this project's own design brief used).
**Recommended first step:** add a `useState` + `localStorage`-persisted collapsed flag, icon-only rail mode at `collapsed`, auto-collapse below `md:` breakpoint.

### SAAS-GAP-11: No toast/success-feedback system anywhere
**Evidence:** grep for `toast|Toast|sonner` across `frontend/src` — zero hits. Every mutation's only feedback is a dialog closing or a list silently re-querying (`onSuccess: () => queryClient.invalidateQueries(...)`).
**Why launch-blocking:** silent success is genuinely confusing UX for real users (did my save work or not?), and becomes worse once network latency is real (cloud deployment) rather than localhost.
**Recommended first step:** a small toast primitive in `components/ui/` + wiring it into the highest-traffic mutations first (test case create/update, defect status changes, user management) rather than a one-shot sweep of every mutation in the app.

### SAAS-GAP-12: ✅ RESOLVED (ADR-041) — New redesign pages have zero accessibility test coverage
**Evidence:** `frontend/e2e/accessibility.spec.ts` scans exactly Login/Dashboard/Projects/Reports/Defects/Users & Roles. Test Repository, Test Runs Overview, Execution Console (new 3-panel layout), Settings, Audit Logs, and the Compliance print view all have zero `@axe-core` coverage.
**Why launch-blocking:** "accessible components" is an explicit requirement; shipping newly-built pages with literally untested accessibility is the kind of gap that's cheap to close now and expensive to discover via a real complaint later.
**Recommended first step:** extend the existing test's page-visit sequence to include the new routes — this is additive to an existing, working test pattern, not new infrastructure.

### SAAS-GAP-13: No error monitoring integration
**Evidence:** grep for `sentry|rollbar|bugsnag` across the entire codebase — zero hits in application code.
**Why launch-blocking:** production incidents would be visible only via plain-text stdout logs with no alerting or stack-trace aggregation — unacceptable operational blindness for a real customer-facing product.
**Recommended first step:** adopt Sentry (or equivalent) on both backend (FastAPI middleware/SDK) and frontend (React error boundary + SDK); low implementation risk, standard integration.

### SAAS-GAP-14: No documented or automated database backup/restore
**Evidence:** no `pg_dump`/backup script anywhere in `scripts/` or elsewhere; the only backup-adjacent mention in the docs is a rationale note (not a procedure) in `docs/ARCHITECTURE_DECISIONS.md`.
**Why launch-blocking:** a multi-tenant product holding real customer data with no backup story is a data-loss incident waiting to happen.
**Recommended first step:** at minimum, a documented runbook + a scheduled `pg_dump` to the eventual object storage target (ties naturally to SAAS-GAP-3's storage work); doesn't need to be sophisticated (point-in-time recovery, etc.) for a first pass.

### SAAS-GAP-15: ✅ RESOLVED (ADR-041) — No generic/catch-all exception handler
**Evidence:** `backend/app/main.py` registers `@app.exception_handler(AppError)` and `@app.exception_handler(RateLimitExceeded)` only — no handler for the base `Exception` class.
**Why launch-blocking:** a genuine unhandled bug currently produces Starlette's default error shape instead of the app's consistent `{"data": null, "error": {...}}` envelope, which breaks the frontend's uniform `ApiError` handling exactly when something has already gone wrong.
**Recommended first step:** one additional `@app.exception_handler(Exception)` that logs the real exception server-side and returns a generic, envelope-shaped 500 to the client — small, low-risk, high-value fix.

### SAAS-GAP-16: ✅ RESOLVED (ADR-041) — Health endpoint is liveness-only, not readiness
**Evidence:** `backend/app/main.py` — `/api/v1/health` returns a static `{"status": "ok"}` with no database query.
**Why launch-blocking:** the Docker healthcheck (and any future orchestrator) would report the API as healthy even if its database connection were broken, defeating the purpose of the check at exactly the moment it matters most.
**Recommended first step:** add a cheap `SELECT 1` to the handler (or a separate `/ready` endpoint) — minimal code, meaningfully more correct.

### SAAS-GAP-17: ✅ RESOLVED (ADR-041) — `docs/Security_Test_Report.md` is stale on one finding
**Evidence:** the report (§10) states file-upload content-sniffing is an unfixed, documented gap, citing a test that no longer exists in `backend/tests/test_attachments.py`. The fix (GAP-66, `attachment_service.py`'s `_content_matches_extension`) was made later in the same session that produced the report, and the report was never updated.
**Why launch-blocking:** a stale security report that overstates an open vulnerability isn't dangerous, but a team that later trusts it at face value could waste effort "fixing" something already fixed, or worse, could have the opposite error (a report that understates a real gap) go unnoticed if this pattern isn't corrected.
**Recommended first step:** a documentation-only correction to `Security_Test_Report.md` §10, noting the fix and its date — no code change.

### SAAS-GAP-18: Logging is unstructured and has no correlation ID
**Evidence:** `backend/app/core/logging.py` — plain-text format, stdout only, no request-ID field threaded through.
**Why launch-blocking:** debugging a production issue across a multi-tenant system without structured, correlatable logs is materially harder; this is standard SaaS operational hygiene.
**Recommended first step:** switch to structured (JSON) logging and add a per-request correlation ID generated in the existing logging middleware, propagated into any downstream log lines for that request.

### SAAS-GAP-19: ✅ RESOLVED (ADR-041) — Contextual role-gating is inconsistent (Defects list)
**Evidence:** `ProjectsList.tsx`, `UsersRoles.tsx`, `ExecutionConsole.tsx` all have explicit role-gates on their actions; `DefectsList.tsx` was found to have none (`grep` for `user?.role` returned nothing in that file).
**Why launch-blocking:** inconsistent enforcement patterns are a maintainability and correctness risk even when the backend ultimately gates the action correctly — the frontend showing an action a role can't actually perform is confusing UX at best.
**Recommended first step:** audit exactly what `DefectsList.tsx` currently exposes, confirm against backend permission requirements, and add matching gates — small, targeted fix once scoped.

---

## E — Future enhancement

- **SAAS-GAP-20**: No global/cross-entity search (command palette or header search box) — only page-scoped filters exist today.
- **SAAS-GAP-21**: No manual light/dark theme toggle — currently follows OS `prefers-color-scheme` only.
- **SAAS-GAP-22**: Notification bell has no backend — an intentional, honestly-labeled empty-state placeholder; building real notifications is a feature decision, not a bug fix.
- **SAAS-GAP-23**: API versioning is a static `/api/v1` prefix with no real negotiation mechanism — fine until a breaking v2 is actually needed.
- **SAAS-GAP-24**: Custom/tenant-defined roles — intentionally out of current BRD scope (GAP-05); revisit only via an explicit BRD change request per that gap's own closing condition.
- **SAAS-GAP-25**: Tenant usage dashboard (storage consumed, seat count vs. limit) — meaningless without SAAS-GAP-1's limits existing first; naturally sequenced after it, not before.
- **SAAS-GAP-26**: Self-service tenant signup (vs. today's platform-admin-provisioned onboarding) — a distinct product/commercial decision, not assumed by this analysis.
- **SAAS-GAP-27**: SSO — explicitly named only as an "Optional"/"Yes" column in the proposed (not approved) subscription-plan table; not scoped here at all.

---

## Summary

| Classification | Count | Resolved | Theme |
|---|---|---|---|
| F (foundation) | 3 | 0 | Subscription schema, production frontend image, storage-backend readiness |
| L (pre-launch) | 16 | 7 (ADR-041) | Platform-admin hardening, rate limiting, tenant self-service, responsive UI, operational readiness (monitoring/backup/logging/exception handling) |
| E (future) | 8 | 0 | Search, theming polish, notifications, API versioning, custom roles, usage dashboard, self-service signup, SSO |

**Resolved in ADR-041** (SAAS-GAP-9, 10, 12, 15, 16, 17, 19): generic exception handler, DB-aware `/ready` endpoint, responsive tables, collapsible/off-canvas sidebar, accessibility coverage for the redesign's new pages (found and fixed a real `aria-expanded` bug along the way), Defects quick-create, and a correction to the stale `Security_Test_Report.md` entry. 9 L-items and all 3 F-items remain open, each requiring a real design decision this pass deliberately didn't make unilaterally (rate-limit scope, logging format, Docker production image, subscription schema shape, platform-admin session/MFA design, tenant-settings/invite-flow scope).

Nothing in this list implies any existing BRD requirement is weakened or incomplete — every item above is additive SaaS-platform scope, consistent with the directive's own governance requirement (§8).
