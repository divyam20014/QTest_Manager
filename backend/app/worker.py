"""Tier 1 / ADR-053: background job worker (SR-6.10 -- CSV import off the
request path). A lightweight DB-backed polling worker, not Celery/Redis:
the approved stack has no cache/broker layer (see app/core/rate_limit.py's
own note on the same constraint). Run as `python -m app.worker`, a second
container alongside `api` in both docker-compose.yml and
docker-compose.prod.yml.
"""

import time

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.logging import configure_logging, logger
from app.services import (
    audit_checkpoint_service,
    defect_service,
    job_service,
    report_schedule_service,
)

settings = get_settings()

# Pass C (deferred item #4, bug #19): the SLA-breach sweep is a periodic
# check, not a per-job-claim action, so it runs on its own cadence
# independent of how often jobs are being claimed -- no new scheduler
# infra, just a second timer alongside the existing poll loop.
_SLA_SWEEP_INTERVAL_SECONDS = 300.0

# Pass 4 (ADR-065): same reasoning -- a scheduled report becomes due purely
# by time passing, not by any mutation event to hook a trigger onto. A
# coarser interval than the SLA sweep is fine since the finest cadence
# (daily) only needs to be checked a handful of times a day, not every 5
# minutes -- but checking more often than that costs nothing and keeps a
# late schedule from drifting far past its due time.
_REPORT_SCHEDULE_SWEEP_INTERVAL_SECONDS = 900.0

# ADR-085: signed audit-chain checkpoints. Cadence comes from
# AUDIT_CHECKPOINT_INTERVAL_SECONDS (0 disables); a scope with no new events
# is skipped, so a short interval costs one cheap head lookup per scope.


def run_forever() -> None:
    configure_logging(settings.log_level, service_name="qtesthub-worker")
    logger.info("QTestHub background worker starting up")
    last_sla_sweep = 0.0
    last_report_sweep = 0.0
    last_checkpoint_run = time.monotonic()
    while True:
        db = SessionLocal()
        try:
            claimed = job_service.run_once(db)
        except Exception:
            logger.exception("Unhandled error in worker loop")
            db.rollback()
            claimed = False
        finally:
            db.close()

        now = time.monotonic()
        if now - last_sla_sweep >= _SLA_SWEEP_INTERVAL_SECONDS:
            last_sla_sweep = now
            db = SessionLocal()
            try:
                sent = defect_service.sweep_sla_breaches(db)
                if sent:
                    logger.info(f"SLA-breach sweep sent {sent} notification(s)")
            except Exception:
                logger.exception("Unhandled error in SLA-breach sweep")
                db.rollback()
            finally:
                db.close()

        if now - last_report_sweep >= _REPORT_SCHEDULE_SWEEP_INTERVAL_SECONDS:
            last_report_sweep = now
            db = SessionLocal()
            try:
                sent = report_schedule_service.run_due_schedules(db)
                if sent:
                    logger.info(f"Report-schedule sweep sent {sent} report(s)")
            except Exception:
                logger.exception("Unhandled error in report-schedule sweep")
                db.rollback()
            finally:
                db.close()

        checkpoint_interval = settings.audit_checkpoint_interval_seconds
        if checkpoint_interval > 0 and now - last_checkpoint_run >= checkpoint_interval:
            last_checkpoint_run = now
            db = SessionLocal()
            try:
                runs = audit_checkpoint_service.run_checkpoints(db)
                made = sum(r.status == "created" for r in runs)
                if made:
                    logger.info(f"Audit checkpoint run wrote {made} checkpoint(s)")
                for run in runs:
                    if run.status in ("refused", "error"):
                        logger.error(
                            "security_event=audit_checkpoint_not_written scope=%s status=%s",
                            run.scope,
                            run.status,
                        )
            except Exception:
                logger.exception("Unhandled error in audit checkpoint run")
                db.rollback()
            finally:
                db.close()

        if not claimed:
            time.sleep(settings.worker_poll_interval_seconds)


if __name__ == "__main__":
    run_forever()
