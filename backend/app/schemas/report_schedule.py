from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

ReportCadence = Literal["daily", "weekly", "monthly"]


class ReportScheduleCreateRequest(BaseModel):
    cadence: ReportCadence
    recipient_emails: list[EmailStr] = Field(min_length=1, max_length=20)
    enabled: bool = True


class ReportScheduleUpdateRequest(BaseModel):
    cadence: ReportCadence | None = None
    recipient_emails: list[EmailStr] | None = Field(default=None, min_length=1, max_length=20)
    enabled: bool | None = None


class ReportScheduleOut(BaseModel):
    id: UUID
    report_type: str
    cadence: ReportCadence
    recipient_emails: list[str]
    enabled: bool
    last_run_at: datetime | None
    created_at: datetime
