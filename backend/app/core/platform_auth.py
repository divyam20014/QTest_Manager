"""Platform Administration auth (ADR-008, ADR-074).

Platform Administration is provisioning-only and a deliberately separate
auth plane from tenant RBAC. ADR-074 replaces the old HTTP Basic scheme
(credentials re-sent on every request, no MFA) with a server-side session
that is only granted after a password AND a TOTP code (or recovery code).
HTTP Basic is no longer accepted anywhere on /platform.
"""

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ForbiddenError
from app.core.rate_limit import limiter
from app.models.identity import PlatformAdmin
from app.services import platform_auth_service as svc

settings = get_settings()

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def enforce_same_origin(request: Request) -> None:
    """CSRF defence in depth for the cookie-authenticated platform plane.
    The session cookie is SameSite=Strict, JSON bodies force a CORS preflight
    for any other origin, and on top of that a browser-supplied Origin header
    on a state-changing request must be one of the configured origins.
    Non-browser clients (curl, tests, the CLI) send no Origin and pass."""
    if request.method in _SAFE_METHODS:
        return
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings.cors_allow_origins:
        raise ForbiddenError("Cross-origin request rejected")


def platform_session_token(request: Request) -> str | None:
    return request.cookies.get(settings.platform_session_cookie_name)


# Tier 0 / ADR-052: rate-limiting lives HERE, on the shared auth dependency,
# not on each route function -- FastAPI resolves this dependency before the
# route body runs, so a decorator on the route could never throttle a request
# this dependency already rejects. 60/minute: the Platform Admin console
# legitimately re-polls the tenant list after every mutation, and the e2e
# suite provisions a tenant per spec file; the account lockout (password and
# MFA failures) is the real brute-force defence, this is a supplementary
# throttle.
@limiter.limit("60/minute")
def require_platform_admin(request: Request, db: Session = Depends(get_db)) -> PlatformAdmin:
    """A fully authenticated platform admin: live session cookie whose stage
    is 'mfa_verified'. A password-only ('password_ok') session, a tenant
    session cookie, or an Authorization: Basic header never qualifies."""
    enforce_same_origin(request)
    session_row, admin = svc.load_session(
        db, platform_session_token(request), stages=(svc.STAGE_MFA_VERIFIED,)
    )
    svc.touch_session(db, session_row)
    return admin
