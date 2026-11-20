"""Write signed audit-chain checkpoints (ADR-085, GAP-01).

Anchors the head of every tenant's audit chain and of the platform audit chain
with an HMAC-signed, chained checkpoint, so a consistent rewrite of the audit
tables by someone with database-owner rights stops verifying. Idempotent: a scope
with no new events since its last checkpoint is skipped. The worker also runs
this periodically (AUDIT_CHECKPOINT_INTERVAL_SECONDS); use this CLI from cron
or a one-off run.

Usage:
    docker compose exec api python -m scripts.audit_checkpoint --dry-run
    docker compose exec api python -m scripts.audit_checkpoint
    docker compose exec api python -m scripts.audit_checkpoint --scope platform
    docker compose exec api python -m scripts.audit_checkpoint --scope tenant:<uuid>

Needs AUDIT_CHECKPOINT_HMAC_KEY (the same value the api uses). Exit status is 1
if any scope was refused (its chain fails verification) or errored.
"""

import argparse
import sys

from app.core.db import SessionLocal
from app.services import audit_checkpoint_service


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--scope",
        action="append",
        help="'platform' or 'tenant:<uuid>' (repeatable); default is every scope",
    )
    parser.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = parser.parse_args()

    with SessionLocal() as db:
        scopes = args.scope
        if scopes:
            for scope in scopes:
                audit_checkpoint_service.parse_scope(scope)  # fail early on a typo
        runs = audit_checkpoint_service.run_checkpoints(db, scopes, dry_run=args.dry_run)

    for run in runs:
        extra = f"  ({run.detail})" if run.detail else ""
        line = (
            f"{run.status:<12} {run.scope}  events={run.record_count}  new={run.new_events}{extra}"
        )
        print(line)
    created = sum(r.status == "created" for r in runs)
    pending = sum(r.status == "would_create" for r in runs)
    bad = sum(r.status in ("refused", "error") for r in runs)
    print(
        f"{len(runs)} scope(s): "
        + (f"{pending} would be checkpointed" if args.dry_run else f"{created} checkpointed")
        + f", {bad} refused/errored."
    )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
