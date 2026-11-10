from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

JobStatus = Literal["queued", "running", "succeeded", "failed"]


class JobOut(BaseModel):
    id: UUID
    job_type: str
    status: JobStatus
    error: str | None
    result: dict | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
