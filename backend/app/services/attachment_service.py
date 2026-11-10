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
from app.core.storage import get_storage_backend
from app.models.identity import User
from app.models.test_case import Attachment
from app.schemas.attachment import AttachmentOut
from app.services import plan_limits
from app.services.owner_access import authorize_owner_access

settings = get_settings()

# test_case_version is in the owner_type CHECK constraint's headroom but
# deliberately left unwired (Phase 7, ADR-049): nothing in the product
# needs per-historical-version evidence today -- test_case already covers
# "evidence for this case," and immutable version snapshots have no
# in-progress-editing moment that would generate version-specific files.

# Screenshots and documents only (FR-TC-001/ADR-012) -- an allowlist by
# extension, since a client-supplied Content-Type header is not trustworthy
# on its own. Rejects anything else (e.g. .exe, .sh) outright.
ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".log",
}

# GAP-66 fix: the extension allowlist above only checks the *filename*,
# which is trivial to spoof (a malicious binary renamed to "photo.png"
# passes it). These are the real magic-byte signatures for every
# binary-ish type in the allowlist -- content is read and checked against
# these before being accepted, not just the extension.
_BINARY_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".bmp": (b"BM",),
    ".pdf": (b"%PDF-",),
    # Legacy OLE Compound File Binary Format (.doc/.xls).
    ".doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".xls": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    # Office Open XML (.docx/.xlsx) is a ZIP archive.
    ".docx": (b"PK\x03\x04",),
    ".xlsx": (b"PK\x03\x04",),
}
# WEBP's signature isn't a simple fixed prefix: bytes 0-3 are "RIFF", the
# next 4 are a little-endian file-size field (varies per file), and bytes
# 8-11 are "WEBP".
_WEBP_RIFF_PREFIX = b"RIFF"
_WEBP_TAG = b"WEBP"
# No reliable magic-byte signature exists for plain text formats -- these
# are instead checked for "looks like text" (no NUL bytes, valid UTF-8)
# rather than a fixed signature.
_TEXT_LIKE_EXTENSIONS = {".csv", ".txt", ".log"}


def _content_matches_extension(extension: str, contents: bytes) -> bool:
    if extension == ".webp":
        return contents[:4] == _WEBP_RIFF_PREFIX and contents[8:12] == _WEBP_TAG
    if extension in _BINARY_SIGNATURES:
        return any(contents.startswith(sig) for sig in _BINARY_SIGNATURES[extension])
    if extension in _TEXT_LIKE_EXTENSIONS:
        sample = contents[:8192]
        if b"\x00" in sample:
            return False
        try:
            sample.decode("utf-8")
            return True
        except UnicodeDecodeError:
            return False
    # Every extension in ALLOWED_ATTACHMENT_EXTENSIONS is covered above;
    # this branch should be unreachable given the allowlist check already
    # ran, but fails closed (reject) rather than open if it's ever hit.
    return False


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


def _storage_key(tenant_id: UUID, owner_type: str, owner_id: UUID, stored_name: str) -> str:
    return f"{tenant_id}/{owner_type}/{owner_id}/{stored_name}"


def list_attachments(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, owner_type: str, owner_id: UUID
) -> list[AttachmentOut]:
    authorize_owner_access(db, tenant_id, role_code, user_id, owner_type, owner_id)
    set_tenant_context(db, str(tenant_id))
    rows = db.execute(
        select(Attachment)
        .where(
            Attachment.tenant_id == tenant_id,
            Attachment.owner_type == owner_type,
            Attachment.owner_id == owner_id,
        )
        .order_by(Attachment.uploaded_at.desc())
    ).scalars()
    return [_to_out(db, tenant_id, a) for a in rows]


def upload_attachment(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    owner_type: str,
    owner_id: UUID,
    file: UploadFile,
) -> AttachmentOut:
    authorize_owner_access(db, tenant_id, role_code, user_id, owner_type, owner_id)

    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_ATTACHMENT_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_ATTACHMENT_EXTENSIONS))
        raise ValidationAppError(
            f"File type '{extension or '(none)'}' is not allowed. Allowed types: {allowed}"
        )

    contents = file.file.read(settings.attachment_max_bytes + 1)
    if len(contents) > settings.attachment_max_bytes:
        raise ValidationAppError(
            f"Attachment exceeds the {settings.attachment_max_bytes // (1024 * 1024)}MB limit"
        )
    if not contents:
        raise ValidationAppError("Attachment file is empty")

    plan_limits.enforce_storage_limit(db, tenant_id, len(contents))

    if not _content_matches_extension(extension, contents):
        raise ValidationAppError(
            f"File content does not match its extension '{extension}' "
            "(failed content-signature check)"
        )

    checksum = hashlib.sha256(contents).hexdigest()
    stored_name = f"{uuid.uuid4()}_{file.filename or 'upload'}"
    storage_key = _storage_key(tenant_id, owner_type, owner_id, stored_name)
    storage_reference = get_storage_backend().save(storage_key, contents)

    set_tenant_context(db, str(tenant_id))
    attachment = Attachment(
        tenant_id=tenant_id,
        owner_type=owner_type,
        owner_id=owner_id,
        file_name=file.filename or "upload",
        mime_type=file.content_type or "application/octet-stream",
        storage_path=storage_reference,
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
    authorize_owner_access(
        db, tenant_id, role_code, user_id, attachment.owner_type, attachment.owner_id
    )
    return attachment


def read_attachment_bytes(attachment: Attachment) -> bytes:
    """Backend-agnostic read, for routes that can't rely on FileResponse
    streaming directly off local disk (e.g. the S3 backend)."""
    return get_storage_backend().read(attachment.storage_path)


def delete_attachment(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, attachment_id: UUID
) -> None:
    attachment = _get_attachment_or_404(db, tenant_id, attachment_id)
    authorize_owner_access(
        db, tenant_id, role_code, user_id, attachment.owner_type, attachment.owner_id
    )
    storage_reference = attachment.storage_path
    db.delete(attachment)
    db.commit()
    get_storage_backend().delete(storage_reference)
