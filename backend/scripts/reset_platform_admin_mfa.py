"""Lost-device recovery for a platform administrator (ADR-074).

Usage (needs shell access to the deployment, which is the point):
    docker compose exec api python -m scripts.reset_platform_admin_mfa --email owner@qtesthub.local

Clears the admin's TOTP secret and recovery codes and revokes every live
session. The admin signs in with their password and enrols a new
authenticator app, which also needs the one-time enrolment code printed here
(ADR-080; valid for PLATFORM_ENROLMENT_CODE_TTL_HOURS). Another platform admin can
do the same from the console
(Admins tab -> Reset MFA); this CLI is the route when the only admin is
locked out.
"""

import argparse
import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.identity import PlatformAdmin
from app.services import platform_auth_service


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    with SessionLocal() as db:
        admin = db.execute(
            select(PlatformAdmin).where(PlatformAdmin.email == args.email)
        ).scalar_one_or_none()
        if admin is None:
            sys.exit(f"No platform admin with email {args.email}")
        code = platform_auth_service.reset_mfa(db, admin)
        print(f"MFA reset for {args.email}. They must re-enrol an authenticator at next sign-in.")
        print(f"One-time enrolment code (shown once; give it to them separately): {code}")


if __name__ == "__main__":
    main()
