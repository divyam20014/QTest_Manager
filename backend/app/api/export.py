from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.services import export_service, job_service

router = APIRouter(prefix="/export", tags=["export"])


# Tier 4 / ADR-054: tenant-wide data export (PV-11.5), distinct from the
# existing per-user GDPR-erase action. Tenant-admin-only, same bar as
# tenant.settings.manage (this reveals every project in the tenant, not
# just ones the caller happens to be a member of).
@router.post("")
def request_export(
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    job = export_service.request_export(db, ctx.tenant_id, ctx.user_id)
    return envelope({"job_id": str(job.id), "status": job.status})


@router.get("/jobs/{job_id}")
def get_export_job(
    job_id: UUID,
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    job = job_service.get_job(db, ctx.tenant_id, job_id)
    return envelope(job.model_dump(mode="json"))


@router.get("/jobs/{job_id}/download")
def download_export(
    job_id: UUID,
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> Response:
    contents, filename = export_service.get_export_download(db, ctx.tenant_id, job_id)
    return Response(
        content=contents,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
