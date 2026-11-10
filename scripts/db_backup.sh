#!/usr/bin/env bash
# Tier 0 / ADR-052: database backup.
#
# Dumps the QTestHub database with pg_dump in the custom ("-Fc") format,
# which is compressed and supports selective/parallel restore via
# pg_restore. Parameterized entirely by env vars -- no credentials are
# embedded in this script.
#
# Required env vars (typically sourced from the deployment's .env, NOT
# committed): POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER,
# PGPASSWORD. BACKUP_DIR defaults to ./backups.
#
# Usage: ./scripts/db_backup.sh
# Intended to be run from a cron job / scheduled task on a schedule
# appropriate to your data change rate (see docs/PRODUCTION_DEPLOYMENT_GUIDE.md
# for the recommended retention/schedule).

set -euo pipefail

: "${POSTGRES_HOST:?Set POSTGRES_HOST}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:?Set POSTGRES_DB}"
: "${POSTGRES_USER:?Set POSTGRES_USER}"
: "${PGPASSWORD:?Set PGPASSWORD (the Postgres owner role's password)}"
export PGPASSWORD

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/qtesthub_${TIMESTAMP}.dump"

echo "Backing up ${POSTGRES_DB}@${POSTGRES_HOST}:${POSTGRES_PORT} -> ${OUT_FILE}"
pg_dump \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --file="$OUT_FILE"

echo "Backup complete: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Retention: delete dump files older than BACKUP_RETENTION_DAYS (default 14).
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
find "$BACKUP_DIR" -name 'qtesthub_*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
