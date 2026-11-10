#!/usr/bin/env bash
# Deployment-hardening pass: thin delegate to the canonical script at
# scripts/db_backup.sh, kept at this path so the repository matches the
# requested deployment/ layout without maintaining two copies that could
# drift out of sync.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/db_backup.sh" "$@"
