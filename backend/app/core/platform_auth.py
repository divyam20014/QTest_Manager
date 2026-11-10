from datetime import UTC, datetime, timedelta

from fastapi import Depends, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import UnauthorizedError
from app.core.rate_limit import limiter
from app.core.security import verify_password
from app.models.identity import PlatformAdmin

_security = HTTPBasic()
settings = get_settings()


# Tier 0 / ADR-052: rate-limiting is applied HERE, on the shared auth
# dependency, rather than via a @limiter.limit decorator on each route
# function. FastAPI resolves a route's Depends() parameters (this one
# included) before ever calling the route function itself, so a decorator
# on the route function would never get a chance to block a request that
# this dependency already rejects with 401 -- the rate limit must sit at or
# before the same layer that can reject the request.
#
# 60/minute (vs. login's tighter 10/minute): this dependency gates ALL
# platform routes including the read-only tenant list, which the frontend's
# own TenantConsole legitimately re-polls after every mutation (see
# PlatformAdmin.tsx's `invalidateQueries`), and this project's own Playwright
# regression suite calls the create-tenant route once per spec file via
# `bootstrapTenant` -- a 10/minute cap left near-zero headroom for two
# consecutive full suite runs (observed firsthand: a second run within the
# same window tripped 429s on otherwise-passing specs). The lockout above
# (5 wrong passwords -> 15 min lock) is this plane's primary brute-force
# defense; this rate limit is a supplementary throttle, not the only gate,
# so a materially looser cap here doesn't meaningfully weaken it.
@limiter.limit("60/minute")
def require_platform_admin(
    request: Request,
    credentials: HTTPBasicCredentials = Depends(_security),
    db: Session = Depends(get_db),
) -> PlatformAdmin:
    """Platform Administration is provisioning-only (ADR-008): separate from
    tenant RBAC, authenticated against the RLS-exempt platform_admins table.

    Tier 0 / ADR-052: adds a brute-force lockout on this HTTP Basic plane
    (mirroring the spirit of the tenant MFA challenge's attempt_count) since
    a full session+MFA replacement was deliberately deferred as out of
    proportion for this pass -- see ADR-052 for the reasoning.
    """
    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == credentials.username)
    ).scalar_one_or_none()

    if admin is not None and admin.locked_until is not None:
        now = datetime.now(UTC)
        locked_until = admin.locked_until
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=UTC)
        if locked_until > now:
            raise UnauthorizedError("Account temporarily locked due to repeated failed logins")

    if admin is None or not verify_password(credentials.password, admin.password_hash):
        if admin is not None:
            admin.failed_login_count += 1
            if admin.failed_login_count >= settings.platform_admin_max_failed_logins:
                admin.locked_until = datetime.now(UTC) + timedelta(
                    minutes=settings.platform_admin_lockout_minutes
                )
            db.commit()
        raise UnauthorizedError("Invalid platform admin credentials")

    if admin.failed_login_count or admin.locked_until:
        admin.failed_login_count = 0
        admin.locked_until = None
        db.commit()

    return admin
