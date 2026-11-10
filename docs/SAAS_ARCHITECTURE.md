# SaaS Architecture — QTestHub

**Relationship to other architecture docs.** `docs/ARCHITECTURE.md` describes the module boundaries and request lifecycle of the application as built against the BRD. This document describes the *additional* SaaS-platform layer around it — subscription/billing placement, platform-vs-tenant administration, and cloud-deployment topology — and states plainly where the current implementation matches, partially matches, or diverges from the recommended shape. It does not repeat `ARCHITECTURE.md`'s content; read that first.

## 1. Recommended SaaS topology vs. current implementation

```
QTESTHUB SAAS PLATFORM
                  |
           Web Application
           React + TypeScript
                  |
            API Gateway            <- see note (a)
                  |
           FastAPI Backend
                  |
  +----------------+----------------+
  |                |                |
Authentication  Tenant Service   Subscription   <- see note (b)
  & RBAC           & Workspace      & Billing
  |                |                |
  +----------------+----------------+
                  |
          Core TMS Modules
                  |
+-------------------+-------------------+
|          |          |          |      |
Projects  Test Cases  Execution  Defects  Reports
|          |          |          |      |
+-------------------+-------------------+
                  |
            PostgreSQL
                  |
       Tenant Data Isolation
                  |
      Cloud Object/File Storage      <- see note (c)
```

**(a) API Gateway.** Not present as a distinct component. Today, `web` talks to `api` directly over plain HTTP inside the Docker Compose network, with no gateway layer (no rate-limiting-at-the-edge, no WAF, no centralized TLS termination, no request routing across services). This is appropriate for the current single-deployable modular monolith — introducing a gateway now would be premature infrastructure for one backend service. It becomes relevant once: (i) the app is deployed outside Docker Compose to a real cloud environment (a gateway/load balancer/TLS terminator is a deployment-layer concern, not an application-layer one — see §4), or (ii) a second backend service is ever extracted. Until then, FastAPI's own routing + the existing rate-limiter + a future reverse proxy at the deployment layer cover this role adequately. **No code change recommended now; a deployment-layer decision for later.**

**(b) Subscription & Billing module.** Does not exist in any form — confirmed by exhaustive grep (see `SAAS_GAP_ANALYSIS.md` SAAS-GAP-1). This is the one box in the reference diagram with genuinely zero current implementation. The recommended placement, when built, mirrors the existing module pattern exactly: `app/models/subscription.py`, `app/schemas/subscription.py`, `app/services/subscription_service.py`, `app/api/subscription.py` (tenant-facing, read-only: "what plan am I on, what are my limits") + an extension to `app/api/platform.py` (platform-admin-facing: assign/change a tenant's plan). It is a peer of Tenant Service, not a sub-feature of it — it should **not** be bolted onto `tenant_service.py`, to keep the eventual extraction-to-a-separate-service path (directive §1: "individual services can be extracted later if required") clean.

**(c) Cloud Object/File Storage.** Currently local filesystem (`backend/app/services/attachment_service.py`, Docker named volume), not object storage. This is `GAP-07` in `docs/KNOWN_GAPS.md`, already documented there as an intentional "local filesystem initially" decision per the original stack list, with the schema already described as storage-backend-agnostic (`Attachment.storage_path` is an opaque string, not filesystem-coupled). Swapping to S3-compatible storage is a service-layer change only (`attachment_service.py`'s `upload_attachment`/`get_attachment_for_download`/`delete_attachment`), not a schema migration — low architectural risk, but real engineering work, and only *necessary* once horizontal scaling of the `api` service is actually required (a single-replica deployment has no correctness problem with local disk, only a scaling ceiling).

Everything else in the reference diagram — Authentication & RBAC, Tenant Service & Workspace, Core TMS Modules (Projects/Test Cases/Execution/Defects/Reports), PostgreSQL, Tenant Data Isolation — matches the current implementation closely; see `docs/ARCHITECTURE.md` for the detailed module table.

## 2. Platform Administration vs. Tenant Administration — architecture

This is implemented as a genuine hard separation, not a permission flag:

- **Two separate identity tables**: `platform_admins` vs. `users`. A platform admin's credentials cannot authenticate against any tenant endpoint, and vice versa.
- **Two separate auth mechanisms**: tenant auth is session-cookie + MFA (`app/core/auth.py`); platform auth is HTTP Basic re-checked per request (`app/core/platform_auth.py`), with no session, no MFA (tracked as GAP-14 — see §3 below, this is a real weakness given what platform-admin access can *do*, even though it can't reach tenant *data*).
- **Two separate route prefixes**, enforced by two separate FastAPI dependencies (`require_platform_admin` vs. `require_permission`/`get_current_context`), confirmed to never cross-reference each other anywhere in `app/api/*.py`.
- **RLS makes the separation structural, not just a permission check**: even if a platform-admin request somehow reached a tenant-data endpoint, there is no `app.current_tenant` session variable set for that request, so Postgres RLS would return zero rows rather than leaking data. The directive asks for "controlled and audited support access" to tenant data for platform admins — this architecture instead makes such access *architecturally absent*, which is a stronger (if less flexible) answer to the same underlying concern. If a genuine support-access workflow is ever needed, it should be built as new, explicitly-scoped, audited functionality — not by weakening this separation.

Recommended architecture for the two items that **are** real gaps here (see `SAAS_GAP_ANALYSIS.md` for full detail):
- **GAP-13** (platform actions recorded with `audit_logs.user_id=None`): add a nullable `platform_admin_id` column to `audit_logs` (or a parallel `platform_audit_logs` table, to avoid a cross-identity-table FK on the tenant audit trail) — already anticipated in `docs/KNOWN_GAPS.md` GAP-13's own "closing condition" note.
- **GAP-14** (HTTP Basic, no session/MFA): give platform admins the same session+MFA treatment tenant users already have, reusing the existing `sessions`/`mfa_challenges` pattern with a `platform_admin_id` instead of `user_id` (or a parallel table, same reasoning as above) — `docs/KNOWN_GAPS.md` GAP-14 already flags this as the natural next step "if Platform Administration grows beyond tenant bootstrap."

## 3. Subscription Architecture — recommended shape (not built)

Per the directive, this must stay **configurable, not hardcoded**, and must **not** include payment-gateway integration without separate approval. The recommended foundation-only design:

```
plans                          tenant_subscriptions
--------------------------     --------------------------
id (pk)                        id (pk)
code (unique, e.g. "starter")  tenant_id (fk, unique)
name                           plan_id (fk)
max_users (nullable = unlimited)  status (trial|active|expired|cancelled)
max_projects (nullable)        trial_ends_at (nullable)
max_test_cases (nullable)      current_period_end (nullable)
features (jsonb — entitlement flags)  created_at / updated_at
is_active (bool)
```

- `plans` rows are seeded/configured data (like `roles`/`permissions` already are), never hardcoded in application logic — a limit check reads `tenant_subscriptions.plan_id → plans.max_users`, it never contains a literal number.
- Limit *enforcement* (e.g. blocking the 11th user on a 10-user plan) is a separate, later decision from the *data model* — the foundation phase should add the schema and a read-only "what's my plan" endpoint without wiring any enforcement, so existing BRD functionality is never weakened by a half-finished limit check (directive §8).
- No `payment_method`, `invoice`, or `stripe_customer_id`-shaped field should be added until billing is explicitly approved as its own phase — adding them now, unused, would itself be "silently introducing unapproved billing... functionality" in spirit, even if inert.

## 4. Cloud Deployment Architecture

Current: Docker Compose, 3 services (`db`/`api`/`web`), suitable for local development and small-scale single-node deployment. Gaps against a genuine cloud-ready topology:

- **No production frontend build.** `frontend/Dockerfile`'s only `CMD` runs `npm run dev` (the Vite dev server) — there is no multi-stage build that runs `npm run build` and serves the static output via nginx/`serve`/a CDN. This is the single highest-priority item in this section: a dev-server container is not something to deploy to customers.
- **No TLS termination anywhere in the stack.** Expected at the dev-compose layer (that's a deployment-environment concern, e.g. a cloud load balancer or an nginx/Caddy sidecar added at deploy time) — but the session cookie's `Secure` flag is already environment-conditional (`set_session_cookie`, `secure=settings.environment != "development"`), so the application layer is *ready* for HTTPS the moment a TLS-terminating proxy is placed in front of it. No application code change needed; a deployment-configuration task only.
- **No horizontal scaling story for the API tier** until object storage replaces local-disk attachments (§1(c)) and the in-memory rate limiter is reconsidered (it's single-process-only by its own code comment — multiple API replicas behind a load balancer would each track rate limits independently, weakening the control, not just an operational nuisance).
- **No background job runner.** CSV import (up to 2,000 rows, `csv_import_service.py`) and any future long-running tenant-admin action block a request-handling worker for their full duration. Recommended addition when this becomes a real bottleneck: a lightweight queue (the stack list already names Redis + Celery for "when needed" — this is that "when," once import volumes or feature count grow) — not required for the current BRD-scoped feature set to function correctly, only to scale.
- **No readiness probe distinct from liveness.** `/api/v1/health` returns a static `{"status": "ok"}` without checking DB connectivity. In a real orchestrated deployment (k8s or similar), this means the health check would report "healthy" even if the database connection pool were broken — recommend a `/api/v1/ready` (or extending `/health`) that does a cheap `SELECT 1`.
- **No error monitoring, no documented backup/restore procedure.** Both are operational-readiness gaps, not architectural ones — no code restructuring needed, just: adopt an error-tracking SDK (Sentry or equivalent) and write/automate a `pg_dump`-based backup runbook.

See `docs/SAAS_GAP_ANALYSIS.md` for all of the above prioritized with classification and effort notes.
