#!/usr/bin/env bash
# Deployment-hardening pass: a single operator-facing script that checks
# the whole stack is actually healthy, rather than reading three separate
# `docker compose ps`/`curl` outputs by hand. Intended for a cron-based
# alert, a load-balancer/monitoring probe, or manual troubleshooting.
#
# Usage: ./deployment/scripts/health_check.sh [base_url]
#   base_url defaults to http://localhost (the proxy's own listen port, or
#   set it to the api service directly e.g. http://localhost:8000 if you're
#   checking without the reverse proxy in front).
#
# Exits 0 if everything checked is healthy, non-zero (with a reason printed)
# otherwise. Never prints secrets.

set -uo pipefail

BASE_URL="${1:-http://localhost}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-qtesthub-prod}"

FAILED=0

check() {
    local description="$1"
    shift
    if "$@" > /dev/null 2>&1; then
        echo "OK   - ${description}"
    else
        echo "FAIL - ${description}"
        FAILED=1
    fi
}

echo "=== QTestHub health check (${BASE_URL}) ==="

# 1. Container-level health, as Docker itself sees it.
if command -v docker > /dev/null 2>&1; then
    # A service with no `healthcheck:` defined (e.g. `proxy`) reports an
    # EMPTY Health field, not "healthy" -- that's not a failure, so it must
    # be excluded explicitly alongside the real "healthy" case, not just
    # "anything not literally healthy".
    UNHEALTHY="$(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
        | grep -o '"Health":"[a-z]*"' | grep -v -E '"Health":"(healthy|)"' || true)"
    if [ -z "$UNHEALTHY" ]; then
        echo "OK   - all containers report healthy (or have no healthcheck)"
    else
        echo "FAIL - one or more containers are not healthy:"
        docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps
        FAILED=1
    fi
else
    echo "SKIP - docker CLI not available in this environment"
fi

# 2. Application-level liveness/readiness (distinct from container health:
#    a container can be "running" while the app inside has never started).
check "liveness endpoint (/api/v1/health)" \
    curl -fsS --max-time 5 "${BASE_URL}/api/v1/health"
check "readiness endpoint (/api/v1/ready) -- confirms DB connectivity" \
    curl -fsS --max-time 5 "${BASE_URL}/api/v1/ready"

# 3. Frontend is actually being served.
check "frontend root responds" \
    curl -fsS --max-time 5 "${BASE_URL}/"

echo "==="
if [ "$FAILED" -eq 0 ]; then
    echo "All checks passed."
    exit 0
else
    echo "One or more checks failed -- see above."
    exit 1
fi
