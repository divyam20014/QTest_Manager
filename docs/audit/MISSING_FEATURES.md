# QTestHub — Missing Features

Grouped by module. Only genuinely absent or structurally-blocked capabilities are listed here (items already "Partially Implemented" with a real, usable subset are included only if the missing portion is itself significant — see `REQUIREMENT_GAP_ANALYSIS.md` for the full partial-credit detail). Priority reflects business/compliance/security impact, not implementation effort.

---

## 1. Subscription & Billing (SR-3, SAAS-GAP-1)
**Expected functionality**: a configurable plan/tier model (Free Trial/Starter/Professional/Enterprise), per-tenant subscription lifecycle (active/trial/expired/cancelled), configurable entitlements and usage limits, upgrade/downgrade workflow, billing history, payment gateway integration.
**Current implementation**: none. Direct grep across `backend/app/models/` and `backend/app/api/` for `subscription|plan_id|tier|entitlement|trial|billing|stripe|invoice|payment|user_limit|project_limit|storage_limit` returns zero matches outside documentation.
**What's missing**: the entire module — schema, API, and UI.
**Impact**: every other SaaS commercial capability (plan configuration, tenant limit display, future billing) depends on this schema existing first; retrofitting after tenants/usage data already exist is possible but strictly harder.
**Priority**: **Critical** for the schema/data-model piece (classified F by the project's own SaaS requirements); payment integration itself is explicitly **not authorized** without separate approval and should stay deferred.

## 2. Production-ready Frontend Deployment Artifact (SR-6.1, SAAS-GAP-2)
**Expected functionality**: a deployable frontend build (static assets served by nginx/a lightweight static server).
**Current implementation**: `frontend/Dockerfile` has a single stage whose only `CMD` is `npm run dev -- --host 0.0.0.0` — the Vite dev server. No `npm run build` stage, no static-serve stage exists anywhere in the repo (confirmed by reading the Dockerfile directly).
**What's missing**: a second Dockerfile stage (or separate production Dockerfile) that builds `dist/` and serves it statically.
**Impact**: there is currently no artifact that could be deployed to a real (non-localhost) environment at all — "Dockerized application" is not actually satisfied for the frontend.
**Priority**: **Critical** (F-classified) — blocks any real deployment.

## 3. Object/Cloud Storage for Attachments (SR-6.5, SAAS-GAP-3)
**Expected functionality**: attachment bytes stored in a horizontally-scalable backend (S3-compatible or similar), not a single Docker-local volume.
**Current implementation**: `backend/app/services/attachment_service.py` writes to `Path(settings.attachments_dir) / tenant_id / test_case_id` on local disk, one Docker named volume. Schema is already storage-backend-agnostic per the project's own `KNOWN_GAPS.md` GAP-07.
**What's missing**: a storage-client abstraction swap; no schema change needed.
**Impact**: blocks any multi-replica/horizontally-scaled API deployment.
**Priority**: **High** (F-classified, but the project's own note correctly says this need only be built when horizontal scaling is actually planned — not urgent for a single-instance deployment today).

## 4. Automation & CI/CD Integration (PV-5)
**Expected functionality**: inbound webhook endpoints for CI result ingestion, CI tool integration (Jenkins/GitHub Actions/etc.), and — critically — a machine-to-machine authentication plane (API keys/service tokens).
**Current implementation**: zero. Only human session-cookie auth and a separate platform-admin HTTP-Basic auth plane exist.
**What's missing**: the entire module, including the new auth plane it depends on.
**Impact**: QTestHub cannot currently participate in any automated test pipeline — a significant functional gap for a QA platform aimed at real engineering teams.
**Priority**: **High** — but correctly sequenced to require its own security review before any endpoint is built, given it's a new attack surface.

## 5. Enterprise SaaS Identity & Compliance Features (PV-11)
**Expected functionality**: SSO (SAML/OIDC), SCIM provisioning, IP allowlisting, tenant branding, tenant-wide data export, data residency controls.
**Current implementation**: none for any of the six items — confirmed by direct grep (`saml|oidc|sso|scim`) and by reading the `Tenant` model (only `name`/`status`/`default_currency_code`/`default_timezone`/`created_at`).
**What's missing**: all six, independently.
**Impact**: blocks sale into enterprise accounts that require SSO/SCIM as a procurement gate; blocks GDPR-style tenant-wide portability requests (today only a per-user erase action exists, which is erasure, not export).
**Priority**: **High** for SSO specifically if any enterprise sales motion is planned (also needs its own dedicated security review per the roadmap's own note); **Medium** for the rest.

## 6. Platform-Admin Security Hardening (SR-5.8, SR-5.9, SAAS-GAP-4/5)
**Expected functionality**: individual attribution of platform-admin actions in the audit trail; session + MFA for the platform-admin credential (today the single highest-privilege credential in the system).
**Current implementation**: `backend/app/services/platform_service.py` records `tenant.created`/`tenant.status_changed` audit events with `user_id=None`; `backend/app/core/platform_auth.py` is plain HTTP Basic re-checked per request, no session, no MFA.
**What's missing**: a `platform_admin_id` audit column (or parallel table); a session+MFA layer for platform-admin auth, mirroring the tenant-side pattern already built.
**Impact**: a compliance/accountability gap the moment there is more than one platform admin; the highest-privilege credential in the platform is protected more weakly than an ordinary tenant user login.
**Priority**: **High** — this is a real security/compliance gap, not cosmetic.

## 7. Operational Readiness: Monitoring, Backup, Structured Logging (SR-6.6/6.8/6.9/6.10)
**Expected functionality**: error-monitoring integration (Sentry/equivalent), documented/automated database backup and restore, structured (JSON) logging with correlation IDs, a background job queue (CSV import currently runs fully synchronously in-request).
**Current implementation**: none of the four. Confirmed by grep (`sentry|rollbar|bugsnag` — zero hits), by the absence of any backup script anywhere in `scripts/` or elsewhere, and by reading `backend/app/core/logging.py` (plain-text, stdout-only, no correlation ID).
**What's missing**: all four, each independent.
**Impact**: a production incident today would be visible only via plain stdout with no alerting; a real data-loss event has no backup/restore procedure to recover from; multi-tenant log correlation is materially harder without structured logs.
**Priority**: **Critical** for backup/restore (data-loss risk); **High** for error monitoring and structured logging.

## 8. Rate Limiting Coverage (SR-6.13/7.2, SAAS-GAP-6)
**Expected functionality**: throttling on write-heavy and resource-intensive endpoints beyond login/MFA.
**Current implementation**: `backend/app/core/rate_limit.py`'s `slowapi` limiter is applied only to `POST /auth/login` and `POST /auth/mfa/verify` (confirmed by reading `app/api/auth.py` and cross-checking `SAAS_GAP_ANALYSIS.md`'s own grep for `@limiter.limit`). Every other route — CSV import (already doing synchronous heavy work per request), bulk actions, create/update routes — is unthrottled.
**What's missing**: extended rate limiting on at least CSV import and other write-heavy endpoints.
**Impact**: a real DoS/resource-exhaustion risk the moment external customers have direct access.
**Priority**: **High**.

## 9. Tenant User-Invite Flow (SR-2.4/5.11, SAAS-GAP-8)
**Expected functionality**: an invite-token-based onboarding flow (admin sends an invite, user sets their own password).
**Current implementation**: `backend/app/api/users.py`'s `create_user` is direct admin-sets-password creation only; no invite/accept endpoints exist.
**What's missing**: an invite-token table, `POST /users/invite`, `POST /auth/accept-invite`.
**Impact**: admins must currently communicate passwords out-of-band — poor security practice and poor onboarding UX for real customer teams.
**Priority**: **Medium** (L-classified pre-launch item).

## 10. QA Manager Intelligence Depth (PV-7)
**Expected functionality**: release-readiness scoring, a purpose-built assignee workload/capacity view, module/folder-level test case grouping with quality rollups, flaky-test/regression-stability trend analytics.
**Current implementation**: only a generic Aggregate Report groupby slice touches workload reporting; `TestCase` has no module/folder/tag field at all (flat per-project), which structurally blocks any sub-project rollup; only a 30-day pass/fail trend exists, no flaky-test detection.
**What's missing**: a `TestCase` schema addition (module/folder) is the prerequisite for most of this module; the readiness/workload/trend analytics themselves are additive once that exists.
**Impact**: a genuine differentiator for a "QA Manager Intelligence" product pillar is currently absent — only generic reporting exists.
**Priority**: **Medium** (not blocking existing functionality; valuable for the commercial AI/SaaS vision).

## 11. Defect Intelligence Depth (PV-6.1, 6.3, 6.6)
**Expected functionality**: automated duplicate-defect similarity detection, reopened-defect analysis, external tracker (Jira/ADO) sync.
**Current implementation**: only a manual `duplicate_of` tag exists (no similarity algorithm); the defect status model (`ADR-026`) is strictly forward-only with no "reopened" state, structurally blocking that specific analysis; no external-tracker integration code exists.
**What's missing**: duplicate-detection logic; a schema/design decision to introduce a "reopened" concept (reversing a deliberate prior design choice); Jira/ADO sync.
**Impact**: moderate — these are enhancement-tier capabilities on top of an already-functional defect lifecycle.
**Priority**: **Medium** for duplicate detection and external sync; reopened-defect analysis needs an explicit design decision before it can even be scheduled, since it reverses ADR-026.

## 12. Test Assets Beyond Attachments (PV-8.1–8.3)
**Expected functionality**: a dedicated `Environment` entity (vs. today's free-text field), `Build`/`Release` tracking, and a test-data repository (masking/synthetic data).
**Current implementation**: `environment` is a free-text `String` column on `Defect` only; no `Build`/`Release` model anywhere; no test-data-management capability of any kind.
**What's missing**: all three, independently.
**Impact**: moderate — these are maturity features common in enterprise QA tools but not required for the core BRD-scoped workflow, which already functions without them.
**Priority**: **Low-Medium**; the test-data repository in particular is flagged by the project's own roadmap as its largest remaining greenfield effort in this area.

## 13. Collaboration Depth: Timelines, Review Workflow, Configurability (PV-9.3–9.6)
**Expected functionality**: bespoke per-entity activity timelines (beyond generic audit-log reuse), a review-request/approval workflow, tenant-configurable statuses/severities/priorities, and a general custom-fields mechanism.
**Current implementation**: the Defect History card directly reuses the generic hash-chained audit log rather than a purpose-built timeline; no review-request mechanism exists; all status/severity/priority values are hardcoded `CheckConstraint` enums; the only JSONB column in the schema (`audit_logs.event_metadata`) is audit-specific, not a general extensibility mechanism.
**What's missing**: all four, independently, with tenant-configurable enums/custom fields deliberately sequenced last since it is "the most structurally invasive change in the whole roadmap" per the project's own `DEVELOPMENT_ROADMAP.md`.
**Impact**: low for existing BRD-scoped operation (hardcoded enums work fine for the current single-domain product); becomes more significant if multiple customer tenants need different workflow vocabularies.
**Priority**: **Low** — correctly sequenced last by the project's own roadmap.

## 14. UX Polish Items (SR-4.5, 4.10, 4.12; SAAS-GAP-11, 20, 21)
**Expected functionality**: global/cross-entity search, a manual light/dark theme toggle, a toast/success-feedback system for mutations.
**Current implementation**: none of the three exist (confirmed by grep for `toast|Toast|sonner` — zero hits; only page-scoped filters exist for search; theme follows OS preference only).
**What's missing**: all three, each independently small in scope.
**Impact**: silent mutation success ("did my save work?") is a real UX confusion point once network latency is non-trivial (cloud deployment vs. localhost); the other two are convenience items.
**Priority**: **Low-Medium** for the toast system specifically (classified L — pre-launch — by the project's own analysis, since silent success becomes materially worse once deployed beyond localhost); **Low** for search and theme toggle.

## 15. AI QA Assistant / AI Defect Assistant (PV-3.4/3.5)
**Expected functionality**: chat-style AI helpers for QA workflows and defect triage, named in the original strategic vision.
**Current implementation**: none — and this is **by deliberate decision**, not oversight. The project's own `DEVELOPMENT_ROADMAP.md` states the approving stakeholder's note committed only to the first three AI capabilities (generation, review, impact analysis), explicitly leaving these two for "a future proposal and approval."
**What's missing**: both, entirely.
**Impact**: none on current product viability — core test management works identically with or without any AI feature, and the three committed AI capabilities are fully delivered.
**Priority**: **Not scheduled** — requires a fresh approval decision before it belongs on any roadmap, per the project's own governance rule.

## 16. Insurance QA Pack (PV-10.1)
**Expected functionality**: a template library of claims/underwriting/policy-admin test case templates.
**Current implementation**: none — only the existing fixed 5-value `Project.domain` enum.
**What's missing**: the entire template library.
**Impact**: none on current functionality; explicitly optional in the original proposal.
**Priority**: **Low** — correctly sequenced last, most valuable once Requirements Management and module/folder grouping (item 10 above) exist to template against.
