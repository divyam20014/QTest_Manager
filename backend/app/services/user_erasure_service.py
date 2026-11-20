"""ADR-086 (GAP-03): erase a user's personal data without breaking records that
reference them.

Anonymise, never hard-delete: every business row (comments, defects, test runs,
...) keeps pointing at the same `users.id`, which after erasure is a pseudonym
("Erased user"). The append-only, hash-chained `audit_logs` and the signed
`audit_chain_checkpoints` are NOT touched: rewriting a hashed row would break
verification. Some historical audit metadata (e.g. `user.created`) contains the
email typed at the time; that is the documented remaining gap (ADR-086).
"""

import secrets
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.security import hash_password
from app.models.audit import AuditLog
from app.models.comment import Comment
from app.models.defect import Defect
from app.models.identity import MfaChallenge, Role, User
from app.models.identity import Session as SessionModel
from app.models.notification import Notification
from app.models.report_schedule import ReportSchedule
from app.models.user_invite import UserInvite
from app.schemas.user import UserErasePreview, UserEraseRequest

ERASED_NAME = "Erased user"

NOTES = [
    "Irreversible: the name and email cannot be recovered afterwards.",
    "Comments, defects, test cases and runs they authored are kept, attributed to 'Erased user'.",
    "Audit log entries and checkpoints are never modified; older entries may still contain "
    "the email or name typed at the time (see ADR-086).",
]


def _placeholder_email() -> str:
    return f"erased-{secrets.token_hex(6)}@erased.invalid"


def _count(db: Session, stmt) -> int:  # type: ignore[no-untyped-def]
    return int(db.execute(stmt).scalar_one())


def _load(db: Session, tenant_id: UUID, user_id: UUID) -> User:
    # FOR UPDATE: two concurrent erasures of the same user (or an erasure racing
    # a last-admin check) serialise here, so the guards below are not racy.
    user = db.execute(
        select(User).where(User.tenant_id == tenant_id, User.id == user_id).with_for_update()
    ).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found")
    return user


def _matching_schedules(db: Session, tenant_id: UUID, email: str) -> list[ReportSchedule]:
    wanted = email.lower()
    rows = db.execute(select(ReportSchedule).where(ReportSchedule.tenant_id == tenant_id)).scalars()
    return [r for r in rows if any(x.lower() == wanted for x in r.recipient_emails)]


def _invites(db: Session, tenant_id: UUID, email: str):  # type: ignore[no-untyped-def]
    return select(UserInvite).where(UserInvite.tenant_id == tenant_id, UserInvite.email == email)


def _collect(db: Session, tenant_id: UUID, user: User) -> tuple[dict[str, int], dict[str, int]]:
    active_sessions = _count(
        db,
        select(func.count(SessionModel.id)).where(
            SessionModel.user_id == user.id, SessionModel.revoked_at.is_(None)
        ),
    )
    changes = {
        "users": 1,
        "sessions_revoked": active_sessions,
        "mfa_challenges_deleted": _count(
            db, select(func.count(MfaChallenge.id)).where(MfaChallenge.user_id == user.id)
        ),
        "notifications_deleted": _count(
            db, select(func.count(Notification.id)).where(Notification.recipient_id == user.id)
        ),
        "notifications_naming_user_redacted": _count(
            db,
            select(func.count(Notification.id)).where(
                Notification.tenant_id == tenant_id,
                Notification.recipient_id != user.id,
                Notification.title.contains(user.name, autoescape=True),
            ),
        ),
        "user_invites_anonymised": len(db.execute(_invites(db, tenant_id, user.email)).all()),
        "report_schedule_recipients_removed": len(_matching_schedules(db, tenant_id, user.email)),
    }
    retained = {
        "audit_logs_as_actor": _count(
            db, select(func.count(AuditLog.id)).where(AuditLog.user_id == user.id)
        ),
        "audit_logs_about_user": _count(
            db,
            select(func.count(AuditLog.id)).where(
                AuditLog.tenant_id == tenant_id,
                AuditLog.entity_type == "user",
                AuditLog.entity_id == user.id,
            ),
        ),
        "comments": _count(db, select(func.count(Comment.id)).where(Comment.author_id == user.id)),
        "defects_reported": _count(
            db, select(func.count(Defect.id)).where(Defect.reported_by == user.id)
        ),
    }
    return changes, retained


def erase_user(
    db: Session, tenant_id: UUID, actor_user_id: UUID, user_id: UUID, req: UserEraseRequest
) -> UserErasePreview:
    user = _load(db, tenant_id, user_id)

    if user.pseudonymized_at is not None:
        raise ConflictError("This user's personal data has already been erased")
    if user.id == actor_user_id:
        raise ConflictError("You cannot erase your own account")
    admin_role_id = db.execute(select(Role.id).where(Role.code == "admin")).scalar_one()
    if user.role_id == admin_role_id and user.is_active:
        other_admins = _count(
            db,
            select(func.count(User.id)).where(
                User.tenant_id == tenant_id,
                User.role_id == admin_role_id,
                User.is_active.is_(True),
                User.id != user.id,
            ),
        )
        if other_admins == 0:
            raise ConflictError("Cannot erase the last remaining Admin in this tenant")

    changes, retained = _collect(db, tenant_id, user)

    if req.dry_run:
        db.rollback()  # release the row lock; nothing was changed
        return UserErasePreview(
            user_id=user_id,
            dry_run=True,
            erased=False,
            changes=changes,
            retained=retained,
            notes=NOTES,
        )

    if (req.confirm_email or "").strip().lower() != user.email.lower():
        db.rollback()
        raise ValidationAppError("confirm_email must match the user's current email")

    old_name, old_email = user.name, user.email
    now = datetime.now(UTC)

    # 1. The user row: profile data gone, account unusable. The unique-per-tenant
    #    email stays unique via a random placeholder; the password hash is
    #    replaced with the hash of an unknowable secret so no credential survives.
    user.name = ERASED_NAME
    user.email = _placeholder_email()
    user.password_hash = hash_password(secrets.token_urlsafe(32))
    user.is_active = False
    user.pseudonymized_at = now

    # 2. Sessions: revoke (rows hold no personal data; revoked_at kills them).
    db.execute(
        update(SessionModel)
        .where(SessionModel.user_id == user.id, SessionModel.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    # 3. MFA challenges.
    db.execute(delete(MfaChallenge).where(MfaChallenge.user_id == user.id))
    # 4. Notifications addressed to them, and their name in others' notification titles.
    db.execute(delete(Notification).where(Notification.recipient_id == user.id))
    db.execute(
        update(Notification)
        .where(
            Notification.tenant_id == tenant_id,
            Notification.recipient_id != user.id,
            Notification.title.contains(old_name, autoescape=True),
        )
        .values(title=func.replace(Notification.title, old_name, ERASED_NAME))
    )
    # 5. Invites for their email: anonymise and make unusable.
    for invite in db.execute(_invites(db, tenant_id, old_email)).scalars():
        invite.email = _placeholder_email()
        invite.name = ERASED_NAME
        invite.token_hash = "erased"
        invite.expires_at = now
    # 6. Report-schedule recipients: drop their address; a schedule left with no
    #    recipient is disabled rather than deleted (the schedule is a business record).
    for schedule in _matching_schedules(db, tenant_id, old_email):
        schedule.recipient_emails = [
            e for e in schedule.recipient_emails if e.lower() != old_email.lower()
        ]
        if not schedule.recipient_emails:
            schedule.enabled = False

    # Audit: ids and counts only. No name, no email, no confirmation text.
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="user.erased",
        entity_type="user",
        entity_id=user.id,
        metadata={"changes": changes},
    )
    db.commit()
    return UserErasePreview(
        user_id=user_id,
        dry_run=False,
        erased=True,
        changes=changes,
        retained=retained,
        notes=NOTES,
    )
