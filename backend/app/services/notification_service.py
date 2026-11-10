import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import set_tenant_context
from app.core.errors import ConfigurationError, NotFoundError
from app.models.notification import Notification
from app.schemas.notification import NotificationEntityType, NotificationOut, NotificationType

MAX_LISTED = 50


def _deliver_email(recipient_email: str, title: str, body: str) -> None:
    """Mirrors app.core.mfa.send_mfa_code's simulated/real pattern
    (ADR-032/ADR-051): "simulated" (default outside production) is a no-op;
    "real" sends via the same SMTP settings MFA already uses, failing
    loudly rather than silently if SMTP isn't configured."""
    settings = get_settings()
    if settings.notification_email_delivery_mode != "real":
        return
    if not settings.smtp_host:
        raise ConfigurationError(
            "Notification email delivery mode is 'real' but SMTP is not configured "
            "(smtp_host is empty)"
        )

    message = EmailMessage()
    message["Subject"] = title
    message["From"] = settings.smtp_from_email
    message["To"] = recipient_email
    message.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)


def notify(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID | None,
    recipient_id: UUID,
    recipient_email: str | None,
    notif_type: str,
    title: str,
    body: str,
    entity_type: str,
    entity_id: UUID,
) -> Notification | None:
    """Creates an in-app notification and, in 'real' delivery mode, emails
    it too. Never notifies a user about their own action (e.g. assigning a
    test case to yourself, or mentioning yourself in a comment). Call sites
    add this within their own transaction, right alongside record_audit_event
    -- it only flushes, the caller's own db.commit() persists it."""
    if actor_user_id is not None and recipient_id == actor_user_id:
        return None

    notification = Notification(
        tenant_id=tenant_id,
        recipient_id=recipient_id,
        type=notif_type,
        title=title,
        body=body,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.add(notification)
    db.flush()

    if recipient_email is not None:
        _deliver_email(recipient_email, title, body)

    return notification


def _to_out(notification: Notification) -> NotificationOut:
    return NotificationOut(
        id=notification.id,
        type=cast(NotificationType, notification.type),
        title=notification.title,
        body=notification.body,
        entity_type=cast(NotificationEntityType, notification.entity_type),
        entity_id=notification.entity_id,
        read_at=notification.read_at,
        created_at=notification.created_at,
    )


def list_notifications(
    db: Session, tenant_id: UUID, user_id: UUID, unread_only: bool = False
) -> list[NotificationOut]:
    set_tenant_context(db, str(tenant_id))
    query = select(Notification).where(
        Notification.tenant_id == tenant_id, Notification.recipient_id == user_id
    )
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    rows = db.execute(
        query.order_by(Notification.created_at.desc()).limit(MAX_LISTED)
    ).scalars()
    return [_to_out(n) for n in rows]


def get_unread_count(db: Session, tenant_id: UUID, user_id: UUID) -> int:
    set_tenant_context(db, str(tenant_id))
    return db.execute(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.tenant_id == tenant_id,
            Notification.recipient_id == user_id,
            Notification.read_at.is_(None),
        )
    ).scalar_one()


def _get_notification_or_404(
    db: Session, tenant_id: UUID, user_id: UUID, notification_id: UUID
) -> Notification:
    set_tenant_context(db, str(tenant_id))
    notification = db.execute(
        select(Notification).where(
            Notification.tenant_id == tenant_id,
            Notification.id == notification_id,
            Notification.recipient_id == user_id,
        )
    ).scalar_one_or_none()
    if notification is None:
        raise NotFoundError("Notification not found")
    return notification


def mark_read(
    db: Session, tenant_id: UUID, user_id: UUID, notification_id: UUID
) -> NotificationOut:
    notification = _get_notification_or_404(db, tenant_id, user_id, notification_id)
    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        db.commit()
    return _to_out(notification)


def mark_all_read(db: Session, tenant_id: UUID, user_id: UUID) -> int:
    set_tenant_context(db, str(tenant_id))
    rows = (
        db.execute(
            select(Notification).where(
                Notification.tenant_id == tenant_id,
                Notification.recipient_id == user_id,
                Notification.read_at.is_(None),
            )
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    for n in rows:
        n.read_at = now
    db.commit()
    return len(rows)
