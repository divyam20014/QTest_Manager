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
from app.services import job_service

settings = get_settings()


def run_forever() -> None:
    configure_logging(settings.log_level, service_name="qtesthub-worker")
    logger.info("QTestHub background worker starting up")
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
        if not claimed:
            time.sleep(settings.worker_poll_interval_seconds)


if __name__ == "__main__":
    run_forever()
