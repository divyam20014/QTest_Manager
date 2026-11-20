from collections.abc import Callable

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import get_settings


def scaled(per_minute: int) -> Callable[[], str]:
    """Per-minute limit for the sign-in/MFA endpoints, scaled by
    ``AUTH_RATE_LIMIT_MULTIPLIER`` (default 1 = the documented limits).

    Only for dev/e2e stacks: a fast browser test run signs in more often than
    8-10 times a minute from one IP and would be throttled. The multiplier is
    read per request (slowapi accepts a callable), and
    ``validate_for_production`` refuses to boot with anything but 1, so a
    production deployment always enforces the real limits. Lockout after
    repeated wrong passwords/codes is separate and unaffected.
    """

    def _limit() -> str:
        return f"{per_minute * get_settings().auth_rate_limit_multiplier}/minute"

    return _limit


# GAP-16: POST /auth/login had no throttling at all, letting an attacker
# submit unlimited password guesses against a known (tenant_id, email)
# pair -- only the post-login MFA code had a lockout (FR-AUTH-003). Keyed
# by client IP (in-memory storage; no Redis/cache layer is in the approved
# stack) rather than (tenant_id, email), since slowapi's key functions
# inspect the request/connection, not the JSON body, without extra
# plumbing -- IP-based throttling is still a real brute-force mitigation
# and is what the gap's own closing condition names as an acceptable
# option. Revisit with a per-(tenant_id, email) key if this needs
# hardening further than a single-process deployment.
limiter = Limiter(
    key_func=get_remote_address,
    # Deployment-hardening pass: a general backstop across every route,
    # independent of the tighter per-route limits above (login, MFA, CSV
    # import, attachment upload, platform, SCIM, invite-accept). Those cover
    # the specifically sensitive/expensive paths; this exists so a route
    # nobody thought to add a specific limit to is never completely
    # unbounded. Generous enough that normal interactive use (and this
    # project's own Playwright suite) never comes close to it -- it's a
    # backstop against abuse, not a tight per-route budget.
    default_limits=["300/minute"],
)
