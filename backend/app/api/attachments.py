from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.services import attachment_service

router = APIRouter(tags=["attachments"])


@router.get("/test-cases/{test_case_id}/attachments")
def list_attachments(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    attachments = attachment_service.list_attachments(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id
    )
    return envelope([a.model_dump(mode="json") for a in attachments])


@router.post("/test-cases/{test_case_id}/attachments")
def upload_attachment(
    test_case_id: UUID,
    file: UploadFile = File(...),
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    attachment = attachment_service.upload_attachment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, test_case_id, file
    )
    return envelope(attachment.model_dump(mode="json"))


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> FileResponse:
    attachment = attachment_service.get_attachment_for_download(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, attachment_id
    )
    return FileResponse(
        attachment.storage_path,
        media_type=attachment.mime_type,
        filename=attachment.file_name,
    )


@router.delete("/attachments/{attachment_id}")
def delete_attachment(
    attachment_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    attachment_service.delete_attachment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, attachment_id
    )
    return envelope({"deleted": True})
