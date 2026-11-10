import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TenantScopedMixin


class Comment(Base, TenantScopedMixin):
    """Polymorphic comment (Phase 8, ADR-050), reusing Attachment's
    owner_type pattern (ADR-012/ADR-049) rather than a per-entity comments
    table. No edit support -- comments are immutable once posted, like a
    chat message; only deletion (own comment, or Admin/Manager moderation)
    is supported, which is simpler than inventing an edit-history story
    nothing asked for."""

    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint(
            "owner_type in ('test_case','defect','execution_step')",
            name="ck_comments_owner_type",
        ),
        CheckConstraint("char_length(body) >= 1", name="ck_comments_body_len"),
    )

    owner_type: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CommentMention(Base, TenantScopedMixin):
    """One row per @-mentioned user on a comment -- a proper relational
    table, not a JSONB list, so Phase 9's real notifications can later
    query "unread mentions for user X" directly instead of scanning
    comment bodies."""

    __tablename__ = "comment_mentions"

    comment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comments.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
