from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import set_tenant_context
from app.core.errors import AppError, NotFoundError
from app.models.background_job import BackgroundJob
from app.schemas.job import JobOut

CSV_IMPORT_JOB_TYPE = "csv_import"


def enqueue(
    db: Session, tenant_id: UUID, created_by: UUID, job_type: str, payload: dict
) -> BackgroundJob:
    """Tier 1 / ADR-053: DB-backed job queue (SR-6.10), not Celery/Redis --
    the approved stack has no cache/broker layer. `background_jobs` is
    deliberately exempt from RLS (see app/models/background_job.py); the
    tenant_id column is still always set and is the only thing every
    tenant-facing read filters by."""
    job = BackgroundJob(
        tenant_id=tenant_id, job_type=job_type, payload=payload, created_by=created_by
    )
    db.add(job)
    db.commit()
    return job


def claim_one(db: Session) -> BackgroundJob | None:
    """Atomically claims the oldest queued job across ALL tenants.

    `FOR UPDATE SKIP LOCKED` lets multiple worker processes poll the same
    table concurrently without blocking on each other or double-claiming a
    row: a locked-but-still-queued row is simply skipped by a concurrent
    claimant, not waited on. Commits immediately after flipping the status
    to 'running' so the row lock (held only until commit) is released
    right away -- the 'running' status itself, not the lock, is what
    prevents a second claim.
    """
    job = db.execute(
        select(BackgroundJob)
        .where(BackgroundJob.status == "queued")
        .order_by(BackgroundJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if job is None:
        return None

    job.status = "running"
    job.started_at = datetime.now(UTC)
    job.attempts += 1
    db.commit()
    return job


def run_job(db: Session, job: BackgroundJob) -> None:
    """Executes a claimed job and records its outcome. Tenant context is
    set per-job inside the worker's own transaction (ADR-007's RLS GUC is
    transaction-local -- it must never be reused across jobs for
    different tenants)."""
    # Imported here, not at module load, to avoid a csv_import_service <->
    # job_service import cycle (csv_import.py's API module imports both).
    from app.services import csv_import_service

    set_tenant_context(db, str(job.tenant_id))
    try:
        if job.job_type == CSV_IMPORT_JOB_TYPE:
            report = csv_import_service.import_test_cases(
                db,
                job.tenant_id,
                job.payload["role_code"],
                UUID(job.payload["actor_user_id"]),
                job.payload["csv_text"],
            )
            job.result = report.model_dump(mode="json")
            job.status = "succeeded"
        else:
            raise ValueError(f"Unknown job_type: {job.job_type}")
    except AppError as exc:
        db.rollback()
        set_tenant_context(db, str(job.tenant_id))
        job.status = "failed"
        job.error = exc.message
    except Exception as exc:  # noqa: BLE001 -- a job must never crash the worker loop
        db.rollback()
        set_tenant_context(db, str(job.tenant_id))
        job.status = "failed"
        job.error = str(exc)

    job.finished_at = datetime.now(UTC)
    db.commit()


def run_once(db: Session) -> bool:
    """Claims and runs a single job. Returns False if none was available."""
    job = claim_one(db)
    if job is None:
        return False
    run_job(db, job)
    return True


def _to_out(job: BackgroundJob) -> JobOut:
    return JobOut(
        id=job.id,
        job_type=job.job_type,
        status=job.status,  # type: ignore[arg-type]
        error=job.error,
        result=job.result,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def get_job(db: Session, tenant_id: UUID, job_id: UUID) -> JobOut:
    """Tenant-scoped at the service layer (background_jobs has no RLS --
    see the model's docstring), the same unguessable-id-plus-explicit-
    filter trust model Session already uses."""
    job = db.execute(
        select(BackgroundJob).where(
            BackgroundJob.tenant_id == tenant_id, BackgroundJob.id == job_id
        )
    ).scalar_one_or_none()
    if job is None:
        raise NotFoundError("Job not found")
    return _to_out(job)
