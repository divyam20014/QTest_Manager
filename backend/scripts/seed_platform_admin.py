"""One-time bootstrap for the first platform administrator (ADR-008).

Usage:
    python -m scripts.seed_platform_admin --email owner@qtesthub.local --password "Sup3rSecret!Pass"

Not exposed over HTTP by design -- platform_admins provisioning is
out-of-band, run by whoever operates the deployment.
"""

import argparse

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.identity import PlatformAdmin
from app.services.platform_service import upsert_platform_admin


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

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
        upsert_platform_admin(db, args.email, args.password)
        if existed:
            print(f"Updated existing platform admin: {args.email}")
        else:
            print(f"Created platform admin: {args.email}")


if __name__ == "__main__":
    main()
