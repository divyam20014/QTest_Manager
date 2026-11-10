"""Tier 4 / ADR-054: tenant-wide data export (PV-11.5).

Distinct from the existing per-user GDPR-erase action -- this is a genuine
bulk export of everything a tenant owns. Reuses Tier 1's DB-backed job
queue (SR-6.10) rather than a synchronous blocking endpoint, and Tier 1's
storage abstraction for the resulting archive rather than a raw
filesystem path.

Scope decision (documented, not hidden): this exports each entity's own
*columns* as flat JSON, not the richly joined/computed read-model each
API list endpoint returns (e.g. DefectOut's `project_name`,
`reviewer_name`, etc.) -- those are derived, re-creatable from the raw
rows this export does include, and reusing them all here would require
duplicating every service's per-project permission-scoped listing logic
for a job that is intentionally tenant-wide, not per-project. Attachment
*bytes* are listed by reference/metadata only, not inlined, to keep the
archive a bounded size regardless of how much binary content a tenant has
accumulated -- a future phase could add an opt-in "include attachment
bytes" mode if a real need for that surfaces.
"""

import io
import json
import zipfile
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import DeclarativeBase, Session

from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.core.storage import get_storage_backend
from app.models.background_job import BackgroundJob
from app.models.comment import Comment, CommentMention
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project
from app.models.requirement import Requirement, RequirementTestCaseLink, RequirementVersion
from app.models.test_asset import Build, Environment, Release
from app.models.test_case import Attachment, TestCase, TestCaseVersion, TestCaseVersionStep
from app.models.test_module import TestModule
from app.services import job_service

TENANT_EXPORT_JOB_TYPE = "tenant_export"

# Columns that must never leave the system, even in an admin-triggered
# export -- the same credentials every other part of this codebase treats
# as write-only/never-serialized.
_EXCLUDED_COLUMNS = {"password_hash", "token_hash", "code_hash", "client_secret_encrypted"}

_EXPORT_MODELS: list[tuple[str, type[DeclarativeBase]]] = [
    ("users", User),
    ("projects", Project),
    ("test_modules", TestModule),
    ("test_cases", TestCase),
    ("test_case_versions", TestCaseVersion),
    ("test_case_version_steps", TestCaseVersionStep),
    ("attachments", Attachment),
    ("requirements", Requirement),
    ("requirement_versions", RequirementVersion),
    ("requirement_test_case_links", RequirementTestCaseLink),
    ("test_runs", TestRun),
    ("test_run_cases", TestRunCase),
    ("execution_steps", ExecutionStep),
    ("defects", Defect),
    ("defect_links", DefectLink),
    ("comments", Comment),
    ("comment_mentions", CommentMention),
    ("environments", Environment),
    ("builds", Build),
    ("releases", Release),
]


def _json_default(value: Any) -> Any:
    if isinstance(value, UUID | datetime | date):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Object of type {type(value)} is not JSON serializable")


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        col.name: getattr(row, col.name)
        for col in row.__table__.columns
        if col.name not in _EXCLUDED_COLUMNS
    }


def request_export(db: Session, tenant_id: UUID, actor_user_id: UUID) -> BackgroundJob:
    return job_service.enqueue(db, tenant_id, actor_user_id, TENANT_EXPORT_JOB_TYPE, {})


def run_export(db: Session, tenant_id: UUID) -> dict:
    """Called by the worker (job_service.run_job) with tenant context
    already set. Returns the job `result` payload."""
    manifest: dict[str, int] = {}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, model in _EXPORT_MODELS:
            rows = db.execute(select(model).where(model.tenant_id == tenant_id)).scalars().all()  # type: ignore[attr-defined]
            payload = [_row_to_dict(row) for row in rows]
            manifest[name] = len(payload)
            archive.writestr(f"{name}.json", json.dumps(payload, default=_json_default, indent=2))
        manifest_payload = {
            "tenant_id": str(tenant_id),
            "generated_at": datetime.utcnow().isoformat(),
            "counts": manifest,
        }
        archive.writestr("manifest.json", json.dumps(manifest_payload, indent=2))

    storage = get_storage_backend()
    key = f"tenants/{tenant_id}/exports/{datetime.utcnow().timestamp()}.zip"
    reference = storage.save(key, buffer.getvalue())
    return {"storage_ref": reference, "manifest": manifest, "size_bytes": buffer.tell()}


def get_export_download(db: Session, tenant_id: UUID, job_id: UUID) -> tuple[bytes, str]:
    job = db.execute(
        select(BackgroundJob).where(
            BackgroundJob.tenant_id == tenant_id, BackgroundJob.id == job_id
        )
    ).scalar_one_or_none()
    if job is None:
        raise NotFoundError("Export job not found")
    if job.job_type != TENANT_EXPORT_JOB_TYPE:
        raise ValidationAppError("That job is not a tenant export")
    if job.status != "succeeded" or job.result is None:
        raise ForbiddenError("Export is not ready yet")

    set_tenant_context(db, str(tenant_id))
    storage = get_storage_backend()
    contents = storage.read(job.result["storage_ref"])
    return contents, f"qtesthub-export-{job_id}.zip"


__all__ = ["request_export", "run_export", "get_export_download", "TENANT_EXPORT_JOB_TYPE"]
