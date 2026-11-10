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
     credentials permanently undecryptable.
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

## 8. Connection pooling & scaling notes

`DB_POOL_SIZE`/`DB_MAX_OVERFLOW` (defaults 10/20) control the backend's
SQLAlchemy connection pool per `api` container/process. If you scale `api`
to multiple replicas, remember Postgres's own `max_connections` must
accommodate `(pool_size + max_overflow) × replica_count` plus headroom for
`psql`/migration/backup connections — size `max_connections` accordingly or
lower the per-replica pool settings.

This deployment has no background job queue (deliberately out of scope for
this tier) and no horizontal autoscaling config — both are tracked as
separate, later roadmap items, not part of this guide.

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
      `scripts/db_restore.sh` successfully restores it into a fresh database.
