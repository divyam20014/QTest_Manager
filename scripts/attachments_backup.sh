#!/usr/bin/env bash
# Tier 0 / ADR-052: file/attachment backup.
#
# Attachment bytes live on disk (ADR-012), not in the database, and there is
# no object storage layer yet (per the audit's finding #3) -- this backs up
# the attachments volume as a tar archive alongside the DB dump produced by
# db_backup.sh. Run both on the same schedule so a restore has a
# point-in-time-consistent pair; a DB restore that references attachment
# rows newer than the attachments tar (or vice versa) will have dangling
# references/orphan files, which is cosmetic (missing download, not data
# loss) but worth keeping in sync regardless.
#
# Required env var: ATTACHMENTS_DIR (the host path backing the
# qtesthub_attachments volume; see docker-compose.prod.yml). BACKUP_DIR
# defaults to ./backups.

set -euo pipefail

: "${ATTACHMENTS_DIR:?Set ATTACHMENTS_DIR to the attachments volume's host path}"
if [ ! -d "$ATTACHMENTS_DIR" ]; then
    echo "ATTACHMENTS_DIR does not exist: $ATTACHMENTS_DIR" >&2
    exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/attachments_${TIMESTAMP}.tar.gz"

echo "Archiving ${ATTACHMENTS_DIR} -> ${OUT_FILE}"
tar -czf "$OUT_FILE" -C "$ATTACHMENTS_DIR" .
echo "Backup complete: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
find "$BACKUP_DIR" -name 'attachments_*.tar.gz' -mtime "+${RETENTION_DAYS}" -print -delete
