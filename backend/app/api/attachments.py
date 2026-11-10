from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.services import attachment_service
from app.services.owner_access import (
    OWNER_TYPE_DEFECT,
    OWNER_TYPE_EXECUTION_STEP,
    OWNER_TYPE_TEST_CASE,
)

router = APIRouter(tags=["attachments"])


@router.get("/test-cases/{test_case_id}/attachments")
def list_attachments(
    test_case_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    attachments = attachment_service.list_attachments(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_TEST_CASE,
        test_case_id,
    )
    return envelope([a.model_dump(mode="json") for a in attachments])


@router.post("/test-cases/{test_case_id}/attachments")
@limiter.limit("30/minute")
def upload_attachment(
    request: Request,
    test_case_id: UUID,
    file: UploadFile = File(...),
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    attachment = attachment_service.upload_attachment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_TEST_CASE,
        test_case_id, file,
    )
    return envelope(attachment.model_dump(mode="json"))


@router.get("/defects/{defect_id}/attachments")
def list_defect_attachments(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    attachments = attachment_service.list_attachments(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_DEFECT,
        defect_id,
    )
    return envelope([a.model_dump(mode="json") for a in attachments])


@router.post("/defects/{defect_id}/attachments")
@limiter.limit("30/minute")
def upload_defect_attachment(
    request: Request,
    defect_id: UUID,
    file: UploadFile = File(...),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    # No dedicated defect.edit-style permission exists (GAP-75/Phase 7) --
    # same project-access-only gating as defect_service's other mutations
    # (update_status/add_link/update_root_cause), enforced inside the
    # service via _authorize_owner_access.
    attachment = attachment_service.upload_attachment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, OWNER_TYPE_DEFECT,
        defect_id, file,
    )
    return envelope(attachment.model_dump(mode="json"))


@router.get("/execution-steps/{execution_step_id}/attachments")
def list_execution_step_attachments(
    execution_step_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    attachments = attachment_service.list_attachments(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id,
        OWNER_TYPE_EXECUTION_STEP, execution_step_id,
    )
    return envelope([a.model_dump(mode="json") for a in attachments])


@router.post("/execution-steps/{execution_step_id}/attachments")
@limiter.limit("30/minute")
def upload_execution_step_attachment(
    request: Request,
    execution_step_id: UUID,
    file: UploadFile = File(...),
    ctx: SessionContext = Depends(require_permission("executionstep.record")),
    db: Session = Depends(get_db),
) -> dict:
    attachment = attachment_service.upload_attachment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id,
        OWNER_TYPE_EXECUTION_STEP, execution_step_id, file,
    )
    return envelope(attachment.model_dump(mode="json"))


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> Response:
    # Tier 1 / ADR-053: reads through the storage abstraction rather than
    # FileResponse-streaming straight off local disk, so this route works
    # identically regardless of which storage backend is configured.
    attachment = attachment_service.get_attachment_for_download(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, attachment_id
    )
    contents = attachment_service.read_attachment_bytes(attachment)
    return Response(
        content=contents,
        media_type=attachment.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{attachment.file_name}"'},
    )


@router.delete("/attachments/{attachment_id}")
def delete_attachment(
    attachment_id: UUID,
    # Shared across all owner types, each with its own (or no) upload-time
    # permission -- the real gate is the owner-specific project-access
    # check inside attachment_service.delete_attachment.
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    attachment_service.delete_attachment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, attachment_id
    )
    return envelope({"deleted": True})
