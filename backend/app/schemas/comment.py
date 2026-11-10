from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CommentCreateRequest(BaseModel):
    body: str = Field(min_length=1)
    # Explicit list of mentioned users, picked from a UI dropdown -- not
    # parsed out of free-text @-tokens, which is ambiguous with duplicate
    # names and fragile to typos.
    mentioned_user_ids: list[UUID] = Field(default_factory=list)


class MentionedUserOut(BaseModel):
    id: UUID
    name: str


class CommentOut(BaseModel):
    id: UUID
    owner_type: str
    owner_id: UUID
    body: str
    author_id: UUID
    author_name: str | None
    mentioned_users: list[MentionedUserOut]
    created_at: datetime
