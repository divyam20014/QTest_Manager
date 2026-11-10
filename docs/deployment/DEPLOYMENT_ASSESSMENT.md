# QTestHub — Deployment Assessment

Written for: whoever picks up deployment-hardening work on this repo next.
Produced for the "Production Deployment Preparation" pass (ADR-056), a
gap-analysis pass on top of five prior tiers of work (ADR-052 through
ADR-055) that already built most of what a from-scratch production-readiness
directive would normally ask for. This document records what was found, so
later sections of this pass (and future readers) don't re-derive it.

## 1. Stack, as it actually exists today

- **Backend**: FastAPI + SQLAlchemy 2.0 (Python 3.12), Alembic migrations,
  PostgreSQL 16 with row-level security for tenant isolation. Runs via
  `uvicorn` (ASGI), one process per container, no async framework-level
  autoscaling built in.
- **Frontend**: React + TypeScript + Vite. Dev: Vite dev server
  (`frontend/Dockerfile`). Production: a real multi-stage build
  (`frontend/Dockerfile.prod`) producing a static bundle served by
  `nginx:1.27-alpine`.
- **Database/ORM/migrations**: SQLAlchemy ORM, Alembic for schema migrations
  (sequential revision chain, currently well past 50 migrations across six
  tiers of feature work). Two Postgres roles per ADR-006: an owner role for
  migrations, a least-privileged `qtesthub_app` role for runtime queries
  (UPDATE/DELETE revoked on `audit_logs` specifically, enforcing
  append-only at the database grant level, not just application code).
- **Session/auth**: DB-backed opaque session tokens (a `sessions` table row,
  cookie value = its UUID), not signed JWTs — there is no server-side signing
  secret to manage for this reason. `HttpOnly`, `SameSite=Lax`,
  `Secure` (true whenever `ENVIRONMENT != "development"`). Login requires
  password + MFA (email-delivered or simulated-for-dev one-time code) before
  a session is treated as authenticated. Platform Administration (tenant
  provisioning) is a deliberately separate identity plane (ADR-008): HTTP
  Basic against a dedicated `platform_admins` table, with its own lockout
  (ADR-052) rather than a shared session mechanism.
- **File storage**: pluggable (ADR-053) — `LocalFilesystemStorage` (default,
  a Docker volume at `/data/attachments`) or `S3CompatibleStorage` (AWS S3 or
  any S3-compatible endpoint), selected by `STORAGE_BACKEND`.
- **External services**: SMTP (optional, for MFA/notification/invite email —
  fails loudly if "real" delivery mode is selected without SMTP configured,
  rather than silently not sending), Sentry (optional, error monitoring,
  no-op if `SENTRY_DSN` unset), an OIDC identity provider (optional, per
  tenant, for SSO), Google's Gemini API (optional, per tenant, for AI test
  case generation/review — tenant-supplied API key, encrypted at rest with a
  Fernet key).
- **Logging/error handling**: structured JSON logs to stdout (one object per
  line: timestamp, level, service, logger, message, request_id when
  available) since ADR-052. A generic exception handler returns a sanitized
  500 to the client and logs the real exception server-side — no stack
  traces or internal details ever reach a response body.

## 2. What the prior tiers already built (do not rebuild)

| Area | Already exists at | Notes |
|---|---|---|
| Production Dockerfiles | `backend/Dockerfile`, `frontend/Dockerfile.prod` | Multi-stage frontend build, non-root backend execution, healthchecks, pinned base image versions |
| Production compose | `docker-compose.prod.yml` | Separate Compose **project name** (`qtesthub-prod`) from the dev `docker-compose.yml` — deliberately, after an incident during Tier 0 verification where a prod compose file without an explicit `name:` shared a project with dev and `down -v` deleted dev data |
| `.env.example` | repo root | Every required var, placeholder values only |
| DB connection pooling | `backend/app/core/db.py`, `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`/etc. | Settings-driven, dev defaults unchanged |
| DB backup/restore | `scripts/db_backup.sh`, `scripts/db_restore.sh` | `pg_dump -Fc`, retention pruning, typed-confirmation-required restore |
| File backup | `scripts/attachments_backup.sh` | Tars the local-backend attachments volume |
| Structured logging | `backend/app/core/logging.py` | JSON, request-ID correlation middleware in `app/main.py` |
| Error monitoring | Sentry, optional | `SENTRY_DSN` env var, no-op when unset |
| Reverse proxy / HTTPS | `deploy/nginx/reverse-proxy.conf` | TLS termination, cert-mountable (no ACME automation — no real domain in this environment) |
| Rate limiting | `backend/app/core/rate_limit.py` + per-route application | Login/MFA, CSV import, attachment upload, all platform routes |
| Health/readiness | `GET /api/v1/health`, `GET /api/v1/ready` | Readiness does a real `SELECT 1`, not just liveness |

## 3. Requested vs. actual file layout — a deliberate, documented decision

The directive asked for `Dockerfile.frontend`/`Dockerfile.backend`/
`docker-compose.yml` (production) at the repo root. This repo instead has:
`backend/Dockerfile`, `frontend/Dockerfile.prod`, `docker-compose.prod.yml`
(production) alongside `docker-compose.yml` (development, actively used and
referenced throughout five prior tiers of documentation and tooling).

**Decision: keep the existing names.** Renaming would mean either (a)
repointing the dev `docker-compose.yml`'s meaning to production — a breaking
change to every existing doc, script, and muscle-memory command that assumes
`docker-compose.yml` is the dev file — or (b) relocating the Dockerfiles to
the repo root, which changes their build context and every `COPY` path
inside them, requiring a full re-verification this pass's remaining time
budget is better spent on (the actual security/backup/logging work below).
This matches the directive's own instruction to adapt the requested
structure "where necessary" and not rebuild working infrastructure
unnecessarily.

What *is* new this pass, at the exact paths requested: `deployment/nginx/`,
`deployment/scripts/` (`backup_database.sh`, `restore_database.sh`,
`backup_files.sh` — thin delegates to the canonical `scripts/*.sh`, so
there's one source of truth and no drift risk; `health_check.sh` and
`verify_backup.sh` are genuinely new), `deployment/README.md`, and this
`docs/deployment/` folder.

## 4. What this pass added

See `docs/ARCHITECTURE_DECISIONS.md` ADR-056 for the full list with
reasoning. Summary: startup secret validation (fails loudly on
`ENVIRONMENT=production` with insecure config), session-ID rotation on MFA
completion, security-event log lines, nginx security headers/request-size
limits/timeouts, a real backup-verification script, and the fix for the
`worker` container's long-standing false "unhealthy" Docker status (it was
inheriting the `api` image's HTTP-based healthcheck despite never serving
HTTP).

## 5. Known limitations, stated plainly

- No real domain/TLS certificate exists in this environment — HTTPS
  configuration is validated structurally (nginx config is syntactically
  valid, expects a cert at a documented path) but not against a real
  browser/certificate.
- No real external OIDC IdP or SCIM client exists in this environment — SSO
  and SCIM (Tier 4) are validated against spec shapes and stubs, not a real
  Okta/Azure AD/Google Workspace tenant. This was already disclosed when
  Tier 4 shipped and remains true.
- No real cloud object storage account exists in this environment — the S3
  storage backend is validated by code review and unit tests against a
  mocked client, not a real bucket.
