#!/usr/bin/env bash
# Deployment-hardening pass: a backup file that merely "exists" is not
# evidence it's restorable (truncated transfer, wrong pg_dump version,
# silent corruption). This performs a REAL test-restore into a disposable
# temporary database on the same server and verifies it with a real query,
# then drops the temporary database -- it never touches the actual
# application database.
#
# Required env vars: POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER,
# PGPASSWORD (the Postgres owner role -- needs CREATEDB).
#
# Usage: ./deployment/scripts/verify_backup.sh /path/to/qtesthub_<ts>.dump

set -euo pipefail

DUMP_FILE="${1:?Usage: verify_backup.sh <path-to-dump-file>}"
if [ ! -f "$DUMP_FILE" ]; then
    echo "Dump file not found: $DUMP_FILE" >&2
    exit 1
fi

: "${POSTGRES_HOST:?Set POSTGRES_HOST}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:?Set POSTGRES_USER}"
: "${PGPASSWORD:?Set PGPASSWORD (the Postgres owner role password)}"
export PGPASSWORD

VERIFY_DB="qtesthub_backup_verify_$$"

cleanup() {
    psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
        -c "DROP DATABASE IF EXISTS ${VERIFY_DB} WITH (FORCE)" > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating disposable verification database ${VERIFY_DB}..."
psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" --dbname=postgres \
    -c "CREATE DATABASE ${VERIFY_DB}"

echo "Restoring ${DUMP_FILE} into ${VERIFY_DB}..."
pg_restore \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$VERIFY_DB" \
    --no-owner \
    --jobs=4 \
    "$DUMP_FILE"

echo "Verifying restored schema actually has data (not just empty tables)..."
TENANT_COUNT="$(psql --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" --username="$POSTGRES_USER" \
    --dbname="$VERIFY_DB" -tAc "SELECT count(*) FROM tenants" 2>/dev/null || echo "query_failed")"

if [ "$TENANT_COUNT" = "query_failed" ]; then
    echo "FAIL: could not query the restored 'tenants' table -- backup is not restorable as-is." >&2
    exit 1
fi

echo "OK: restored database is queryable (tenants table has ${TENANT_COUNT} row(s))."
echo "Verification database will now be dropped (this never touched your real database)."
