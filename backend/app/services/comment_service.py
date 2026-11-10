from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.models.comment import Comment, CommentMention
from app.models.identity import User
from app.schemas.comment import CommentCreateRequest, CommentOut, MentionedUserOut
from app.services.owner_access import authorize_owner_access


def _to_out(db: Session, tenant_id: UUID, comment: Comment) -> CommentOut:
    set_tenant_context(db, str(tenant_id))
    author_name = db.execute(
        select(User.name).where(User.id == comment.author_id)
    ).scalar_one_or_none()
    mentions = db.execute(
        select(User.id, User.name)
        .join(CommentMention, CommentMention.user_id == User.id)
        .where(CommentMention.comment_id == comment.id)
    ).all()
    return CommentOut(
        id=comment.id,
        owner_type=comment.owner_type,
        owner_id=comment.owner_id,
        body=comment.body,
        author_id=comment.author_id,
        author_name=author_name,
        mentioned_users=[MentionedUserOut(id=uid, name=name) for uid, name in mentions],
        created_at=comment.created_at,
    )


def list_comments(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, owner_type: str, owner_id: UUID
) -> list[CommentOut]:
    authorize_owner_access(db, tenant_id, role_code, user_id, owner_type, owner_id)
    set_tenant_context(db, str(tenant_id))
    rows = db.execute(
        select(Comment)
        .where(
            Comment.tenant_id == tenant_id,
            Comment.owner_type == owner_type,
            Comment.owner_id == owner_id,
        )
        .order_by(Comment.created_at.asc())
    ).scalars()
    return [_to_out(db, tenant_id, c) for c in rows]


def create_comment(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    owner_type: str,
    owner_id: UUID,
    req: CommentCreateRequest,
) -> CommentOut:
    authorize_owner_access(db, tenant_id, role_code, actor_user_id, owner_type, owner_id)

    if req.mentioned_user_ids:
        found_ids = set(
            db.execute(
                select(User.id).where(
                    User.tenant_id == tenant_id, User.id.in_(req.mentioned_user_ids)
                )
            )
            .scalars()
            .all()
        )
        missing = set(req.mentioned_user_ids) - found_ids
        if missing:
            names = ", ".join(str(m) for m in missing)
            raise ValidationAppError(f"Unknown mentioned user(s): {names}")

    comment = Comment(
        tenant_id=tenant_id,
        owner_type=owner_type,
        owner_id=owner_id,
        body=req.body,
        author_id=actor_user_id,
    )
    db.add(comment)
    db.flush()

    for mentioned_id in req.mentioned_user_ids:
        db.add(CommentMention(tenant_id=tenant_id, comment_id=comment.id, user_id=mentioned_id))
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="comment.created",
        entity_type=owner_type,
        entity_id=owner_id,
        metadata={"comment_id": str(comment.id), "mentioned_count": len(req.mentioned_user_ids)},
    )
    db.commit()
    return _to_out(db, tenant_id, comment)


def _get_comment_or_404(db: Session, tenant_id: UUID, comment_id: UUID) -> Comment:
    comment = db.execute(
        select(Comment).where(Comment.tenant_id == tenant_id, Comment.id == comment_id)
    ).scalar_one_or_none()
    if comment is None:
        raise NotFoundError("Comment not found")
    return comment


def delete_comment(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, comment_id: UUID
) -> None:
    comment = _get_comment_or_404(db, tenant_id, comment_id)
    authorize_owner_access(
        db, tenant_id, role_code, actor_user_id, comment.owner_type, comment.owner_id
    )

    if comment.author_id != actor_user_id and role_code not in ("admin", "manager"):
        raise ForbiddenError("You may only delete your own comments")

    db.query(CommentMention).filter(CommentMention.comment_id == comment.id).delete()
    db.delete(comment)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="comment.deleted",
        entity_type=comment.owner_type,
        entity_id=comment.owner_id,
        metadata={"comment_id": str(comment.id)},
    )
    db.commit()
