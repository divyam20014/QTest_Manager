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
