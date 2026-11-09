from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AttachmentOut(BaseModel):
    id: UUID
    file_name: str
    mime_type: str
    size_bytes: int
    uploaded_by: UUID
    uploaded_by_name: str | None
    uploaded_at: datetime

    model_config = {"from_attributes": True}
