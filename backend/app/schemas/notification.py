from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

NotificationType = Literal[
    "mention", "test_case_assigned", "defect_closed", "review_requested", "review_decided"
]
NotificationEntityType = Literal["test_case", "defect", "execution_step"]


class NotificationOut(BaseModel):
    id: UUID
    type: NotificationType
    title: str
    body: str
    entity_type: NotificationEntityType
    entity_id: UUID
    read_at: datetime | None
    created_at: datetime


class UnreadCountOut(BaseModel):
    count: int


class MarkAllReadOut(BaseModel):
    marked_count: int
