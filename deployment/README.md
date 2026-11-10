# QTestHub deployment package

This folder holds operational scripts and the reverse-proxy config for a
production deployment. The actual production Docker/Compose files live at
the repo root (`backend/Dockerfile`, `frontend/Dockerfile.prod`,
`docker-compose.prod.yml`) — see
`docs/deployment/DEPLOYMENT_ASSESSMENT.md` §3 for why this repo's layout
differs slightly from a from-scratch request's default naming, and what maps
to what.

| Path | What it is |
|---|---|
| `nginx/nginx.conf` | Edge reverse proxy / TLS termination config (a synced copy of the canonical `deploy/nginx/reverse-proxy.conf`, which is what `docker-compose.prod.yml` actually mounts) |
| `scripts/backup_database.sh` | Delegates to `scripts/db_backup.sh` |
| `scripts/restore_database.sh` | Delegates to `scripts/db_restore.sh` — **destructive**, requires typed confirmation |
| `scripts/backup_files.sh` | Delegates to `scripts/attachments_backup.sh` (only backs up anything when `STORAGE_BACKEND=local`) |
| `scripts/verify_backup.sh` | Test-restores a dump into a disposable database and verifies it's queryable — never touches your real database |
| `scripts/health_check.sh` | One-shot pass/fail check across container health, liveness, readiness, and frontend availability |

Full documentation: `docs/deployment/` —
`PRODUCTION_DEPLOYMENT_GUIDE.md` (start here for a first deployment),
`DATABASE_MIGRATION.md`, `BACKUP_AND_RESTORE.md`,
`SECURITY_CONFIGURATION.md`, `ADMINISTRATOR_GUIDE.md`, `USER_GUIDE.md`,
and `DEPLOYMENT_ASSESSMENT.md` (what was found/decided, read this one first
if you're picking up deployment work on this repo for the first time).
