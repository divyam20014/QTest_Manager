import secrets
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.config import get_settings
from app.core.db import set_tenant_context
from app.core.errors import ConfigurationError, UnauthorizedError, ValidationAppError
from app.core.security import hash_password, verify_password
from app.models.identity import Role, User
from app.models.user_invite import UserInvite
from app.schemas.user import UserInviteOut, UserInviteRequest

settings = get_settings()


def _role_id_for_code(db: Session, code: str) -> UUID:
    role_id = db.execute(select(Role.id).where(Role.code == code)).scalar_one_or_none()
    if role_id is None:
        raise ValidationAppError(f"Unknown role: {code}")
    return role_id


def _deliver_invite_email(recipient_email: str, invite_link: str) -> None:
    """Mirrors notification_service._deliver_email's simulated/real split
    (ADR-032/051): "simulated" is a no-op here -- the caller instead
    returns the raw token in the API response. "real" sends it by email,
    failing loudly rather than silently if SMTP isn't configured."""
    if settings.notification_email_delivery_mode != "real":
        return
    if not settings.smtp_host:
        raise ConfigurationError(
            "Notification email delivery mode is 'real' but SMTP is not configured "
            "(smtp_host is empty)"
        )

    message = EmailMessage()
    message["Subject"] = "You've been invited to QTestHub"
    message["From"] = settings.smtp_from_email
    message["To"] = recipient_email
    message.set_content(
        f"You've been invited to join a QTestHub organization. Accept your invite here:\n\n"
        f"{invite_link}\n\nThis link expires in {settings.user_invite_ttl_hours} hours."
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)


def create_invite(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: UserInviteRequest
) -> UserInviteOut:
    existing_user = db.execute(
        select(User.id).where(User.tenant_id == tenant_id, User.email == req.email)
    ).scalar_one_or_none()
    if existing_user is not None:
        raise ValidationAppError("A user with this email already exists in this tenant")

    existing_pending = db.execute(
        select(UserInvite.id).where(
            UserInvite.tenant_id == tenant_id,
            UserInvite.email == req.email,
            UserInvite.accepted_at.is_(None),
        )
    ).scalar_one_or_none()
    if existing_pending is not None:
        raise ValidationAppError("An invite for this email is already pending")

    role_id = _role_id_for_code(db, req.role)
    secret = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    invite = UserInvite(
        tenant_id=tenant_id,
        email=req.email,
        name=req.name,
        role_id=role_id,
        invited_by=actor_user_id,
        token_hash=hash_password(secret),
        expires_at=now + timedelta(hours=settings.user_invite_ttl_hours),
    )
    db.add(invite)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="user.invited",
        entity_type="user_invite",
        entity_id=invite.id,
        metadata={"email": req.email, "role": req.role},
    )
    db.commit()

    token = f"{invite.id}.{secret}"
    invite_link = f"/accept-invite/{token}"
    _deliver_invite_email(req.email, invite_link)

    return UserInviteOut(
        id=invite.id,
        email=invite.email,
        expires_at=invite.expires_at,
        invite_token=token if settings.notification_email_delivery_mode != "real" else None,
    )


def _parse_token(token: str) -> tuple[UUID, str]:
    invite_id_raw, sep, secret = token.partition(".")
    if not sep:
        raise UnauthorizedError("Invalid or expired invite")
    try:
        invite_id = UUID(invite_id_raw)
    except ValueError as exc:
        raise UnauthorizedError("Invalid or expired invite") from exc
    return invite_id, secret


def accept_invite(db: Session, token: str, password: str) -> User:
    """Public, unauthenticated. `user_invites` is deliberately exempt from
    RLS (ADR-053, mirroring ADR-015's Session exemption) so this row --
    and therefore its tenant_id -- can be resolved before any tenant
    context exists."""
    invite_id, secret = _parse_token(token)

    invite = db.execute(select(UserInvite).where(UserInvite.id == invite_id)).scalar_one_or_none()
    if invite is None or not verify_password(secret, invite.token_hash):
        raise UnauthorizedError("Invalid or expired invite")
    if invite.accepted_at is not None:
        raise UnauthorizedError("This invite has already been used")
    if invite.expires_at < datetime.now(UTC):
        raise UnauthorizedError("This invite has expired")

    set_tenant_context(db, str(invite.tenant_id))

    user = User(
        tenant_id=invite.tenant_id,
        email=invite.email,
        name=invite.name,
        role_id=invite.role_id,
        password_hash=hash_password(password),
    )
    db.add(user)
    db.flush()

    invite.accepted_at = datetime.now(UTC)

    record_audit_event(
        db,
        tenant_id=invite.tenant_id,
        user_id=user.id,
        action="user.invite_accepted",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": invite.email, "invite_id": str(invite.id)},
    )
    db.commit()
    return user


def list_pending_invites(db: Session, tenant_id: UUID) -> list[UserInvite]:
    set_tenant_context(db, str(tenant_id))
    return list(
        db.execute(
            select(UserInvite)
            .where(UserInvite.tenant_id == tenant_id, UserInvite.accepted_at.is_(None))
            .order_by(UserInvite.created_at.desc())
        ).scalars()
    )


__all__ = ["create_invite", "accept_invite", "list_pending_invites"]
