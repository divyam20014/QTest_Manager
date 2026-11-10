"""GAP-16: POST /auth/login had no throttling, letting an attacker submit
unlimited password guesses. Rate limiting is disabled globally in
conftest.py (see `_disable_rate_limiting`) so the rest of the suite's many
logins don't trip it; this test explicitly re-enables and resets it."""

from fastapi.testclient import TestClient

from app.core.rate_limit import limiter


def test_login_is_rate_limited_after_ten_attempts_per_minute(client: TestClient) -> None:
    limiter.enabled = True
    limiter.reset()
    try:
        responses = [
            client.post(
                "/api/v1/auth/login",
                json={
                    "tenant_id": "00000000-0000-0000-0000-000000000000",
                    "email": "nobody@example.com",
                    "password": "WrongPassword1!",
                },
            )
            for _ in range(11)
        ]
    finally:
        limiter.enabled = False
        limiter.reset()

    statuses = [r.status_code for r in responses]
    # The first 10 are rejected for bad credentials (401); the 11th within
    # the same minute, from the same client, is throttled before auth logic
    # even runs.
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
    assert responses[10].json()["error"]["code"] == "rate_limited"


def test_platform_tenants_is_rate_limited_after_sixty_attempts_per_minute(
    client: TestClient,
) -> None:
    """Tier 0 / ADR-052: the platform-admin HTTP Basic plane previously had
    no throttling at all (same class of gap as GAP-16's login route). The
    cap is looser than login's (60/minute, not 10/minute) since this
    dependency also gates the read-only tenant list the frontend legitimately
    re-polls after every mutation, and the per-admin lockout (5 wrong
    passwords -> 15 min) is the primary brute-force defense here, not this
    rate limit."""
    limiter.enabled = True
    limiter.reset()
    try:
        responses = [
            client.post(
                "/api/v1/platform/tenants",
                auth=("nobody@example.com", "WrongPassword1!"),
                json={
                    "tenant_name": "x",
                    "admin_name": "x",
                    "admin_email": "x@example.com",
                    "admin_password": "x",
                },
            )
            for _ in range(61)
        ]
    finally:
        limiter.enabled = False
        limiter.reset()

    statuses = [r.status_code for r in responses]
    assert statuses[:60] == [401] * 60
    assert statuses[60] == 429
    assert responses[60].json()["error"]["code"] == "rate_limited"


def test_general_backstop_limit_applies_to_an_undecorated_route(
    client: TestClient, platform_admin: dict
) -> None:
    """Deployment-hardening pass: a route with no route-specific
    @limiter.limit decorator (here, GET /auth/me) is still bounded by the
    Limiter's global `default_limits` backstop, applied via SlowAPIMiddleware
    -- not left completely unbounded just because nobody added a specific
    limit to it."""
    from tests.test_auth_flow import _bootstrap_tenant, _login_and_verify

    bootstrap = _bootstrap_tenant(client, platform_admin)
    _login_and_verify(client, bootstrap["tenant"]["id"], "admin@horizon.com", "AdminPassw0rd!")

    limiter.enabled = True
    limiter.reset()
    try:
        responses = [client.get("/api/v1/auth/me") for _ in range(301)]
    finally:
        limiter.enabled = False
        limiter.reset()

    statuses = [r.status_code for r in responses]
    assert statuses[:300] == [200] * 300
    assert statuses[300] == 429


def test_csv_import_is_rate_limited_after_ten_attempts_per_minute(
    client: TestClient, platform_admin: dict
) -> None:
    """Tier 0 / ADR-052: CSV import is a resource-intensive write endpoint
    that previously had no throttling."""
    from tests.test_csv_import import _setup_admin_and_project

    _setup_admin_and_project(client, platform_admin, "Rate Limit Project")

    limiter.enabled = True
    limiter.reset()
    try:
        responses = [
            client.post(
                "/api/v1/test-cases/import",
                files={"file": ("x.csv", b"not,real,csv", "text/csv")},
            )
            for _ in range(11)
        ]
    finally:
        limiter.enabled = False
        limiter.reset()

    statuses = [r.status_code for r in responses]
    assert 429 in statuses
