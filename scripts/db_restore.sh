#!/usr/bin/env bash
# Tier 0 / ADR-052: database restore, pairing scripts/db_backup.sh's dumps.
#
# Restores a pg_dump custom-format (-Fc) backup into POSTGRES_DB. This is a
# DESTRUCTIVE operation against the target database -- it drops and
# recreates the target database before restoring, so run it only against a
# database you intend to overwrite (a freshly provisioned one, or one you
# have independently confirmed you want to replace).
#
# Required env vars (same as db_backup.sh): POSTGRES_HOST, POSTGRES_PORT,
# POSTGRES_DB, POSTGRES_USER, PGPASSWORD.
#
# Usage: ./scripts/db_restore.sh /path/to/qtesthub_<timestamp>.dump

set -euo pipefail

DUMP_FILE="${1:?Usage: db_restore.sh <path-to-dump-file>}"
if [ ! -f "$DUMP_FILE" ]; then
    echo "Dump file not found: $DUMP_FILE" >&2
    exit 1
fi

: "${POSTGRES_HOST:?Set POSTGRES_HOST}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:?Set POSTGRES_DB}"
: "${POSTGRES_USER:?Set POSTGRES_USER}"
: "${PGPASSWORD:?Set PGPASSWORD (the Postgres owner role's password)}"
export PGPASSWORD

read -r -p "This will DROP and recreate database '${POSTGRES_DB}' on ${POSTGRES_HOST}. Type the database name to confirm: " CONFIRM
if [ "$CONFIRM" != "$POSTGRES_DB" ]; then
    echo "Confirmation did not match. Aborting." >&2
    exit 1
fi

echo "Dropping and recreating ${POSTGRES_DB}..."
psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
    -c "DROP DATABASE IF EXISTS ${POSTGRES_DB} WITH (FORCE)"
psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
    -c "CREATE DATABASE ${POSTGRES_DB}"

echo "Restoring from ${DUMP_FILE}..."
pg_restore \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --no-owner \
    --jobs=4 \
    "$DUMP_FILE"

echo "Restore complete. Run 'alembic upgrade head' (see docs/PRODUCTION_DEPLOYMENT_GUIDE.md) to"
echo "confirm the schema is at the expected migration head before starting the app against it."
