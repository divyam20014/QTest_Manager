"""One-time bootstrap for the first platform administrator (ADR-008).

Usage:
    python -m scripts.seed_platform_admin --email owner@qtesthub.local --password "Sup3rSecret!Pass"

Platform Admin sign-in now requires TOTP MFA (ADR-074): the first time this
admin signs in at /platform-admin they are walked through enrolling an
authenticator app, and must also enter the one-time enrolment code this script
prints ONCE (ADR-080; hand it over separately from the password). Nothing more
is needed in production.

DEV / TEST ONLY -- pre-enrol a known TOTP secret so automated tests can sign
in without scanning a QR code:
    python -m scripts.seed_platform_admin --email ... --password ... \
        --totp-secret JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
The flag is refused when ENVIRONMENT=production.

Not exposed over HTTP by design -- the FIRST platform_admins row is
provisioned out-of-band, run by whoever operates the deployment.
"""

import argparse
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.identity import PlatformAdmin
from app.services import platform_auth_service
from app.services.platform_service import upsert_platform_admin


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument(
        "--totp-secret",
        default=None,
        help="DEV/TEST ONLY: pre-enrol this base32 TOTP secret (refused in production)",
    )
    args = parser.parse_args()

    if args.totp_secret and get_settings().environment == "production":
        sys.exit("Refusing --totp-secret: a known MFA secret must never be seeded in production.")

    with SessionLocal() as db:
        # Platform Admin UI/UX pass: shared with POST /platform/admins via
        # platform_service.upsert_platform_admin, so this script and the API
        # path can never drift apart. Also reactivates a deactivated admin,
        # same as before this change (an existing row's password was always
        # unconditionally overwritable here).
        existing = db.execute(
            select(PlatformAdmin).where(PlatformAdmin.email == args.email)
        ).scalar_one_or_none()
        existed = existing is not None
        admin = upsert_platform_admin(db, args.email, args.password)
        if existed:
            print(f"Updated existing platform admin: {args.email}")
        else:
            print(f"Created platform admin: {args.email}")
        if args.totp_secret:
            platform_auth_service.preenrol_with_secret(db, admin, args.totp_secret)
            print("MFA pre-enrolled with the supplied (dev/test) TOTP secret.")
        elif not platform_auth_service.mfa_enrolled(admin):
            code = platform_auth_service.issue_enrolment_code(db, admin)
            db.commit()
            print("MFA not enrolled yet: the admin sets up an authenticator on first sign-in.")
            print(f"One-time enrolment code (shown once; pass it on separately): {code}")


if __name__ == "__main__":
    main()
