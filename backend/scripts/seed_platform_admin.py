"""One-time bootstrap for the first platform administrator (ADR-008).

Usage:
    python -m scripts.seed_platform_admin --email owner@qtesthub.local --password "Sup3rSecret!Pass"

Not exposed over HTTP by design -- platform_admins provisioning is
out-of-band, run by whoever operates the deployment.
"""

import argparse

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.identity import PlatformAdmin


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    with SessionLocal() as db:
        existing = db.execute(
            select(PlatformAdmin).where(PlatformAdmin.email == args.email)
        ).scalar_one_or_none()
        if existing is not None:
            existing.password_hash = hash_password(args.password)
            print(f"Updated existing platform admin: {args.email}")
        else:
            db.add(PlatformAdmin(email=args.email, password_hash=hash_password(args.password)))
            print(f"Created platform admin: {args.email}")
        db.commit()


if __name__ == "__main__":
    main()
