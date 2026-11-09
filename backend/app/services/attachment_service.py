import hashlib
import uuid
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError, ValidationAppError
from app.models.identity import User
from app.models.test_case import Attachment
from app.schemas.attachment import AttachmentOut
from app.services import test_case_service

settings = get_settings()

OWNER_TYPE_TEST_CASE = "test_case"


def _to_out(db: Session, tenant_id: UUID, attachment: Attachment) -> AttachmentOut:
    # ADR-007 addendum: re-assert tenant context before every serializer
    # query, in case this runs after a commit in the same request.
    set_tenant_context(db, str(tenant_id))
    uploader_name = db.execute(
        select(User.name).where(User.id == attachment.uploaded_by)
    ).scalar_one_or_none()
    return AttachmentOut(
        id=attachment.id,
        file_name=attachment.file_name,
        mime_type=attachment.mime_type,
        size_bytes=attachment.size_bytes,
        uploaded_by=attachment.uploaded_by,
        uploaded_by_name=uploader_name,
        uploaded_at=attachment.uploaded_at,
    )


def _attachment_dir(tenant_id: UUID, test_case_id: UUID) -> Path:
    return Path(settings.attachments_dir) / str(tenant_id) / str(test_case_id)


def list_attachments(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> list[AttachmentOut]:
    # Reuses get_test_case's existing 404 + project-visibility checks
    # (ADR-019) rather than duplicating them here.
    test_case_service.get_test_case(db, tenant_id, role_code, user_id, test_case_id)
    set_tenant_context(db, str(tenant_id))
    rows = db.execute(
        select(Attachment)
        .where(
            Attachment.tenant_id == tenant_id,
            Attachment.owner_type == OWNER_TYPE_TEST_CASE,
            Attachment.owner_id == test_case_id,
        )
        .order_by(Attachment.uploaded_at.desc())
    ).scalars()
    return [_to_out(db, tenant_id, a) for a in rows]


def upload_attachment(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    test_case_id: UUID,
    file: UploadFile,
) -> AttachmentOut:
    test_case_service.get_test_case(db, tenant_id, role_code, user_id, test_case_id)

    contents = file.file.read(settings.attachment_max_bytes + 1)
    if len(contents) > settings.attachment_max_bytes:
        raise ValidationAppError(
            f"Attachment exceeds the {settings.attachment_max_bytes // (1024 * 1024)}MB limit"
        )
    if not contents:
        raise ValidationAppError("Attachment file is empty")

    checksum = hashlib.sha256(contents).hexdigest()
    stored_name = f"{uuid.uuid4()}_{file.filename or 'upload'}"
    target_dir = _attachment_dir(tenant_id, test_case_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    storage_path = target_dir / stored_name
    storage_path.write_bytes(contents)

    set_tenant_context(db, str(tenant_id))
    attachment = Attachment(
        tenant_id=tenant_id,
        owner_type=OWNER_TYPE_TEST_CASE,
        owner_id=test_case_id,
        file_name=file.filename or "upload",
        mime_type=file.content_type or "application/octet-stream",
        storage_path=str(storage_path),
        size_bytes=len(contents),
        checksum_sha256=checksum,
        uploaded_by=user_id,
    )
    db.add(attachment)
    db.flush()
    out = _to_out(db, tenant_id, attachment)
    db.commit()
    return out


def _get_attachment_or_404(db: Session, tenant_id: UUID, attachment_id: UUID) -> Attachment:
    set_tenant_context(db, str(tenant_id))
    attachment = db.execute(
        select(Attachment).where(Attachment.tenant_id == tenant_id, Attachment.id == attachment_id)
    ).scalar_one_or_none()
    if attachment is None:
        raise NotFoundError("Attachment not found")
    return attachment


def get_attachment_for_download(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, attachment_id: UUID
) -> Attachment:
    attachment = _get_attachment_or_404(db, tenant_id, attachment_id)
    # Re-checks the owning test case's own project-visibility rule (ADR-019)
    # -- an attachment is never more visible than the test case it belongs to.
    test_case_service.get_test_case(db, tenant_id, role_code, user_id, attachment.owner_id)
    return attachment


def delete_attachment(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, attachment_id: UUID
) -> None:
    attachment = _get_attachment_or_404(db, tenant_id, attachment_id)
    test_case_service.get_test_case(db, tenant_id, role_code, user_id, attachment.owner_id)
    storage_path = Path(attachment.storage_path)
    db.delete(attachment)
    db.commit()
    storage_path.unlink(missing_ok=True)
