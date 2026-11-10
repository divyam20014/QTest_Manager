#!/usr/bin/env bash
# Deployment-hardening pass: thin delegate to the canonical script at
# scripts/attachments_backup.sh (Tier 0). See docs/deployment/BACKUP_AND_RESTORE.md
# for the consistency note between this and the database backup.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/attachments_backup.sh" "$@"
