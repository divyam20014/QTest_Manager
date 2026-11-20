"""Reset the step timers on the Meridian demo tenant's in-progress cases.

The seed script opens steps with the real clock, and the unfinished
"Sprint 41 Regression" run keeps one open step per in-progress case. The
Execution Console correctly reports how long a step has been open, so a demo
database that is a few days old shows "elapsed" figures of days. This script
sets ``opened_at`` to now for open steps that have no verdict, so the demo
reads naturally again. Re-run it whenever the demo looks stale.

It only touches ``execution_steps.opened_at`` of the demo tenant, only for
steps that have been opened and have no verdict, and it never records a
verdict. It refuses to run when ENVIRONMENT=production.

Usage (from the api container):
    python -m scripts.refresh_demo_timers
    python -m scripts.refresh_demo_timers --dry-run
"""

import argparse
import sys
from datetime import UTC, datetime

from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.db import SessionLocal, set_tenant_context
from app.models.execution import ExecutionStep
from app.models.tenant import Tenant
from scripts.seed_demo_tenant import TENANT_NAME


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="count the steps, change nothing")
    args = parser.parse_args()

    if get_settings().environment == "production":
        print("Refusing to run with ENVIRONMENT=production.", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        tenant = db.execute(select(Tenant).where(Tenant.name == TENANT_NAME)).scalar_one_or_none()
        if tenant is None:
            print(f"Demo tenant '{TENANT_NAME}' not found; nothing to do.")
            return 0
        set_tenant_context(db, str(tenant.id))
        open_steps = (
            ExecutionStep.tenant_id == tenant.id,
            ExecutionStep.opened_at.is_not(None),
            ExecutionStep.verdict.is_(None),
        )
        ids = db.execute(select(ExecutionStep.id).where(*open_steps)).scalars().all()
        if args.dry_run or not ids:
            print(f"{len(ids)} open step(s) without a verdict in '{TENANT_NAME}'.")
            return 0
        db.execute(
            update(ExecutionStep).where(*open_steps).values(opened_at=datetime.now(UTC))
        )
        db.commit()
        print(f"Reset the timer on {len(ids)} open step(s) in '{TENANT_NAME}'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
