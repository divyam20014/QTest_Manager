#!/usr/bin/env bash
# Deployment-hardening pass: thin delegate to the canonical script at
# scripts/db_restore.sh. See that file for the required confirmation prompt
# and safety notes -- this wrapper changes nothing about its behavior.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/db_restore.sh" "$@"
