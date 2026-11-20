# QTestHub — Production Deployment Guide

Written for: whoever is deploying QTestHub to a real environment for the first
time (an ops/platform engineer, not a QTestHub end user). Produced as part of
Tier 0 (ADR-052) of the post-audit remediation plan.

This guide assumes Docker and Docker Compose (v2) are available on the target
host, and that you own a domain if you intend to serve HTTPS (recommended for
any real deployment).

## 1. What you're deploying

Five containers, defined in `docker-compose.prod.yml` (distinct from the
dev-focused `docker-compose.yml` at the repo root — do not use the dev file
for a real deployment):

| Service | What it is | Reachable from |
|---|---|---|
| `db` | PostgreSQL 16 | only other containers (no host port) |
| `api` | FastAPI backend | only other containers |
| `worker` | background job queue worker (Tier 1 / ADR-053 — same image as `api`, different entrypoint) | nothing (outbound DB connections only) |
| `web` | nginx serving the built frontend, proxies `/api/` to `api` | only other containers |
| `proxy` | nginx reverse proxy, TLS termination | the public internet (ports 80/443) |

Attachment storage defaults to the local `qtesthub_attachments` volume; set
`STORAGE_BACKEND=s3` (plus `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT_URL`/
`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`) to use AWS S3 or an S3-compatible
service instead — see `.env.example` and ADR-053.

## 2. Environment configuration

1. Copy `.env.example` (repo root) to `.env`.
2. Replace every `CHANGE_ME` placeholder with a real, randomly generated
   value. In particular:
   - `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` — long random strings (e.g.
     `openssl rand -base64 32`). These are two **different** passwords for
     two different Postgres roles (ADR-006: the app connects as a
     least-privilege role, migrations run as the owner role).
   - `AI_CREDENTIAL_ENCRYPTION_KEY` — generate with:
     ```
     python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
     ```
     Back this up somewhere durable outside the `.env` file itself (e.g. your
     secrets manager) — losing it makes any tenant's saved AI provider
     credentials, SSO client secrets and Platform Admin MFA secrets permanently
     undecryptable. It may be a comma-separated list for rotation: see section 5a.
   - `AUDIT_CHECKPOINT_HMAC_KEY` (ADR-085) — signs the audit-chain checkpoints.
     Generate with:
     ```
     python -c "import secrets; print(secrets.token_urlsafe(48))"
     ```
     At least 32 characters and different from every other secret. Keep it in
     your secrets manager, **not** in the database or in a backup stored with it:
     the protection exists only while a database administrator cannot read this
     key. `api` and `worker` both need the same value. The application refuses
     to start in production without it. Changing it makes every earlier
     checkpoint fail `signature_invalid`, so export the checkpoints first and
     keep the old key to verify them; there is no rotation procedure yet.
   - `CORS_ALLOW_ORIGINS` — the exact origin(s) your frontend is served from,
     as a JSON array string, e.g. `["https://app.example.com"]`.
3. **Never commit `.env`.** It is already listed in `.gitignore`. Treat it as
   a secret: inject it via your platform's secret store (e.g. a Docker
   secret, a Kubernetes Secret, your cloud provider's secrets manager) rather
   than leaving a plaintext file on disk long-term, where your infrastructure
   supports that. At minimum, restrict its file permissions (`chmod 600 .env`)
   and never check it into version control, a CI log, or a support ticket.

## 3. First-time (empty environment) deployment

From the repo root, with `.env` in place:

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

This brings up `db` first (waits for its healthcheck), then `api` (which runs
`alembic upgrade head` automatically on container start — see §4 — then
waits for its own `/api/v1/ready` healthcheck), then `web`, then `proxy`.

Verify:
```bash
docker compose -f docker-compose.prod.yml ps        # all healthy
curl -k https://<your-host>/api/v1/ready            # {"data":{"status":"ready"}}
curl -k https://<your-host>/                        # frontend HTML
```

**Platform Admin MFA (ADR-074).** Sign-in to `/platform-admin` needs the admin's password *and* a code from an authenticator app; HTTP Basic is no longer accepted. Seed the first admin without `--totp-secret` (that flag is refused when `ENVIRONMENT=production`); the seed script prints a **one-time enrolment code** (ADR-080, shown once, valid `PLATFORM_ENROLMENT_CODE_TTL_HOURS` hours, default 24). Sign in at `/platform-admin` straight away, enter that code, enrol an authenticator, and store the 10 recovery codes safely. Pass the enrolment code to any other person separately from their password. Platform MFA secrets are encrypted with `AI_CREDENTIAL_ENCRYPTION_KEY`: the application now refuses to start in production if it is unset or not a valid Fernet key, and **rotating it makes stored MFA secrets unreadable** (reset each admin with `python -m scripts.reset_platform_admin_mfa --email ...`, which prints a fresh one-time enrolment code, and have them re-enrol). The platform session cookie is `Secure` and `SameSite=Strict`, so the console and the API must be served over HTTPS from the same site (for example `app.example.com` and `api.example.com`), and `CORS_ALLOW_ORIGINS` must list the console origin exactly (it is also checked as the allowed `Origin` for state-changing platform requests).

**Platform Admin session hardening (ADR-083).** Migration `d6f0b4c8e2a3` adds `ua_hash` and `step_up_at` to `platform_sessions` (run `alembic upgrade head`; sessions that exist during the upgrade skip the User-Agent check until they expire). Settings: `PLATFORM_SESSION_IDLE_MINUTES` (default 30; the application refuses to start in production outside 1..1440), `PLATFORM_STEP_UP_MINUTES` (default 5; same bounds) and `PLATFORM_SESSION_BIND_IP` (default `false`; set `true` only if admins have stable addresses, otherwise a mobile or VPN address change signs them out; behind a proxy set `TRUST_PROXY_HEADERS` correctly or every request looks like the proxy's address). The User-Agent binding is always on and there is no setting that disables step-up. Watch the platform audit trail for `session_binding_failed` (possible cookie theft), `session_idle_expired`, `step_up_failed` and `session_revoked`.

**Platform Admin password change and reset (ADR-081).** Admins change their own password in the console (current password plus a fresh authenticator code); another admin can force a reset, which ends the target's sessions, blocks their old password and issues a one-time reset code valid `PLATFORM_PASSWORD_RESET_CODE_TTL_HOURS` hours (default 24). Migration `b4d8f2a6c1e9` adds `password_reset_code_hash` / `password_reset_code_expires_at` to `platform_admins` (run `alembic upgrade head`). The two endpoints are limited to 5-10 requests per minute per IP and `AUTH_RATE_LIMIT_MULTIPLIER` must stay 1 in production (already enforced). Never log or relay reset codes in the same channel as a password. WebAuthn is not supported.

Then provision your first tenant via the Platform Administration API (there
is no seeded tenant) — see `docs/ADMINISTRATOR_GUIDE.md` §1.

## 4. Database migrations

Migrations run automatically on every `api` container start
(`alembic upgrade head && uvicorn ...`, see `backend/Dockerfile`). For a
**first deployment** this creates the full schema from scratch. For an
**upgrade** of an existing deployment:

1. **Back up first** (§5) — always, before any migration.
2. Pull the new image/code, then `docker compose -f docker-compose.prod.yml up -d api`.
   The container re-runs `alembic upgrade head`, which only applies
   migrations after the currently-recorded revision — already-applied
   migrations are no-ops.
3. Confirm: `docker compose -f docker-compose.prod.yml logs api | grep -i alembic`
   shows the upgrade completing without error, and `/api/v1/ready` returns
   `200`.

**Rolling back a migration** (only if a deployed migration must be reverted):
```bash
docker compose -f docker-compose.prod.yml run --rm api alembic downgrade -1
```
Review the specific migration's `downgrade()` function first — a downgrade
that drops a column is itself destructive to any data already written into
it since the upgrade.

## 5. Backup & restore

See `scripts/db_backup.sh`, `scripts/db_restore.sh`, and
`scripts/attachments_backup.sh` (repo root). None of these scripts embed
credentials — they read `POSTGRES_HOST`/`POSTGRES_USER`/`PGPASSWORD`/etc.
from the calling environment.

**Recommended schedule:** a nightly `db_backup.sh` + `attachments_backup.sh`
run (e.g. via cron or your platform's scheduled-job feature), with
`BACKUP_RETENTION_DAYS` (default 14) pruning old dumps automatically. Store
the resulting files somewhere durable and off-host (e.g. object storage) —
these scripts write locally; shipping the output elsewhere is a separate,
environment-specific step.

**Restore** (`scripts/db_restore.sh <dump-file>`) is destructive — it drops
and recreates the target database. Run it only against a database you intend
to overwrite, and run `alembic upgrade head` afterward (§4) to confirm the
restored schema matches what the running application code expects.

There is no object storage layer yet (attachment files live on a Docker
volume, see `ADR-012`/the implementation audit's finding #3) — the
attachments tar backup above is the only durable copy today; losing the
`qtesthub_attachments` volume without a recent tar backup loses uploaded
files (not database rows, which reference them by path).

## 5a. Rotating `AI_CREDENTIAL_ENCRYPTION_KEY` (ADR-084)

The Fernet key encrypts three things at rest: Platform Admin TOTP secrets
(`platform_admins.mfa_secret_encrypted`), tenant AI provider API keys
(`tenants.ai_api_key_encrypted`) and tenant SSO client secrets
(`sso_configs.client_secret_encrypted`). `AI_CREDENTIAL_ENCRYPTION_KEY` accepts a
**comma-separated list**: the first key encrypts, every key decrypts. Rotation is
therefore zero-downtime: add the new key in front, re-encrypt, drop the old key.
Production startup rejects a malformed or empty entry (the error names the
position, never a key value).

1. **Back up first.** Take a database backup (section 5) and keep a copy of the
   current key in your secrets manager.
2. **Generate the new key**:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
3. **Deploy `NEW,OLD`** (new key first, no spaces needed) to the api and worker
   services and restart them. Existing data keeps working; new writes use `NEW`.
4. **Dry run** (writes nothing; reports per column how many values exist, how many
   are already on the new key, how many need rotating, how many are undecryptable):
   `docker compose -f docker-compose.prod.yml exec api python -m scripts.rotate_encryption_key`
5. **Apply** (one transaction, all or nothing; idempotent, safe to re-run):
   `docker compose -f docker-compose.prod.yml exec api python -m scripts.rotate_encryption_key --apply`
   The script refuses to start if any value cannot be decrypted by any configured
   key (exit code 2, counts only). Add the missing old key and retry.
6. **Verify** the old key is no longer needed:
   `docker compose -f docker-compose.prod.yml exec api python -m scripts.rotate_encryption_key --verify`
   Exit 0 means every value decrypts with the first key alone.
7. **Deploy `NEW` only** and restart. Keep the old key in the secrets manager for
   as long as your backups from before step 5 are retained: restoring such a backup
   needs the old key.

**If the key is lost** (every key that encrypted the data): Platform Admin MFA
secrets become unreadable, so those admins cannot pass MFA; recover them with
`docker compose exec api python -m scripts.reset_platform_admin_mfa --email <email>`
(or Reset MFA from another admin). Tenant AI provider keys and SSO client secrets
cannot be recovered and must be re-entered by the tenant administrator. Nothing else
is affected.

**Cadence:** rotate at least annually, whenever someone with access to the key
leaves, and immediately if the key may have been exposed. The scripts never print a
key, a secret or a ciphertext; do not paste keys into tickets or chat.

## 5b. Audit-chain checkpoints (ADR-085, GAP-01)

The `worker` service writes an HMAC-signed checkpoint for every tenant's audit
chain and for the platform audit chain every `AUDIT_CHECKPOINT_INTERVAL_SECONDS`
(default 3600; `0` turns the worker loop off). A scope with no new events since
its last checkpoint is skipped, so the run is cheap. A scope whose chain already
fails verification is refused and logged as
`security_event=audit_checkpoint_not_written`: alert on it.

Run it by hand, or from cron instead of (or as well as) the worker:

```
docker compose -f docker-compose.prod.yml exec -T api python -m scripts.audit_checkpoint --dry-run
docker compose -f docker-compose.prod.yml exec -T api python -m scripts.audit_checkpoint
docker compose -f docker-compose.prod.yml exec -T api python -m scripts.audit_checkpoint --scope platform
docker compose -f docker-compose.prod.yml exec -T api python -m scripts.audit_checkpoint --scope tenant:<uuid>
```

It prints one line per scope (`created`, `unchanged`, `would_create`, `refused`)
and exits 1 if any scope was refused or failed. Checkpoints are also available on
demand from the Audit Logs page and the Platform Admin Audit tab.

**Sizing the verify call (ADR-087).** Chain verification streams rows (flat memory, about 16 s per 100,000 events on a slow dev laptop, linear in log size) and holds one API request for that time; raise your proxy timeout accordingly for very large tenants, or use `GET /audit-logs/verify-chain?since_checkpoint=true`. Measure on your own hardware with `python -m scripts.audit_chain_loadtest` (run from `backend/` against a non-production Postgres; it creates and drops its own database and refuses `ENVIRONMENT=production`).

**Export off the box.** The checkpoints protect the audit trail only against
someone who cannot also change the checkpoint store. Periodically download
`GET /api/v1/audit-logs/checkpoints/export` (per tenant, as a tenant admin) and
`GET /api/v1/platform/audit-events/checkpoints/export` (as a platform admin) and
keep the files where the database administrator cannot modify them, ideally an
object-lock/WORM bucket. This is what exposes deletion of the newest checkpoints.
Nothing does this automatically yet (KNOWN_GAPS GAP-01).

## 6. Reverse proxy & HTTPS

`deploy/nginx/reverse-proxy.conf` is mounted into the `proxy` service and
expects a certificate/key pair at `/etc/nginx/certs/fullchain.pem` and
`/etc/nginx/certs/privkey.pem` (point `TLS_CERT_DIR` in `.env` at the host
directory holding them — e.g. certbot's
`/etc/letsencrypt/live/<your-domain>/`).

Obtaining the certificate itself (ACME/Let's Encrypt issuance, DNS
validation, renewal automation) is domain-specific and deliberately **not**
automated by this repo — run certbot (or use your CA/cloud provider's
preferred flow) against your real domain, then point `TLS_CERT_DIR` at its
output. For a quick smoke test without a real domain/certificate yet, comment
out the `return 301 https://...` redirect and the `443` server block in
`deploy/nginx/reverse-proxy.conf`, leaving only plain port 80 — do **not**
leave a production deployment running this way.

## 7. Health checks, logging, error monitoring

- **Liveness:** `GET /api/v1/health` — process is up.
- **Readiness:** `GET /api/v1/ready` — process is up AND the database is
  reachable. Point your orchestrator's readiness probe here, not `/health`.
- **Logs:** the backend emits one JSON object per line (`timestamp`,
  `level`, `logger`, `message`, `request_id`) to stdout — point your log
  aggregator (e.g. CloudWatch, Loki, Datadog) at the container's stdout, no
  extra configuration needed. Every request gets an `X-Request-ID` (honoring
  one your proxy/client already set, generating one otherwise), echoed back
  on the response and attached to every log line emitted while handling that
  request — use it to correlate a user-reported error with your logs.
- **Error monitoring:** optional Sentry integration, off by default. Set
  `SENTRY_DSN` in `.env` to enable; leave blank to skip entirely (no
  behavior change, no extra outbound network calls).

## 7a. Startup configuration validation (deployment-hardening pass)

With `ENVIRONMENT=production`, the `api` container refuses to start (with a
clear error listing every problem at once, not just the first) if:

- `MFA_DELIVERY_MODE` is still `simulated` — that mode returns the one-time
  code directly in the `/auth/login` response body, which is correct for
  dev/test and a critical leak in production.
- `MFA_DELIVERY_MODE=real` but `SMTP_HOST` is empty — no MFA email could be sent, so nobody could sign in.
- `DATABASE_URL` is still the hardcoded local-dev default.
- `CORS_ALLOW_ORIGINS` is unset, still the local-dev default, or `*`.
- `AUDIT_CHECKPOINT_HMAC_KEY` is unset, shorter than 32 characters, or equal to another secret (ADR-085).

This is a second, application-level check alongside the `${VAR:?...}` guards
already in `docker-compose.prod.yml` — it also catches a deployment that runs
the image some other way (a different orchestrator, a manual `docker run`).
See `app/core/config.py::validate_for_production`.

**Security-event logging**: failed tenant logins, MFA lockouts, platform-admin
lockouts, IP-allowlist rejections, and rate-limit trips each emit a
`security_event=...` JSON log line (in addition to the generic per-request
access log) — grep your log aggregator for `security_event` to build an
alert on repeated auth failures.

**Session rotation**: the session cookie's value changes when MFA
verification succeeds (not just an in-place flag flip on the same row) — a
pre-MFA session id can never be replayed to reach an authenticated state.
See `docs/deployment/SECURITY_CONFIGURATION.md` for the full security posture.

## 8. Connection pooling & scaling notes

`DB_POOL_SIZE`/`DB_MAX_OVERFLOW` (defaults 10/20) control the backend's
SQLAlchemy connection pool per `api` container/process. If you scale `api`
to multiple replicas, remember Postgres's own `max_connections` must
accommodate `(pool_size + max_overflow) × replica_count` plus headroom for
`psql`/migration/backup connections — size `max_connections` accordingly or
lower the per-replica pool settings.

This deployment has no horizontal autoscaling config (Tier 1 added the
background job queue itself — see the `worker` row in §1's table; scaling
that beyond one replica would need the job-claim query's `FOR UPDATE SKIP
LOCKED` pattern re-verified under concurrency, not just more replicas) — both
are tracked as separate, later roadmap items, not part of this guide.

## 9. Clean-environment verification checklist

Before considering a deployment "production ready," confirm, from a torn-down
state (`docker compose -f docker-compose.prod.yml down -v` — note `-v` also
deletes volumes, only do this against a throwaway/staging environment, never
a real one with data you want to keep):

- [ ] `docker compose -f docker-compose.prod.yml up -d --build` succeeds with
      no manual intervention, using only `.env` (no dev defaults, no
      hardcoded credentials in any checked-in file).
- [ ] `alembic upgrade head` runs cleanly as part of `api`'s startup (check
      `docker compose logs api`).
- [ ] `GET /api/v1/ready` returns 200.
- [ ] The frontend loads at `https://<host>/` and can reach the API through
      the same origin (no CORS errors in the browser console).
- [ ] A test tenant can be provisioned via the Platform Administration API
      (`docs/ADMINISTRATOR_GUIDE.md` §1) and its admin user can log in.
- [ ] `scripts/db_backup.sh` produces a dump file, and
      `scripts/db_restore.sh` successfully restores it into a fresh database
      (or run `deployment/scripts/verify_backup.sh <dump>`, which does this
      automatically against a disposable database and never touches the
      real one).
- [ ] `deployment/scripts/health_check.sh` reports all checks passing.
- [ ] Restarting every container (`docker compose -f docker-compose.prod.yml
      restart`) does not lose data — confirm a record created before the
      restart is still present after.

See `docs/deployment/` for the full deployment documentation set (assessment,
database migration, backup/restore, security configuration, administrator
and user guides) produced alongside this guide.
