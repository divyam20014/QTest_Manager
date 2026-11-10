"""Gap-closure pass (ADR-057): subscription/billing limit enforcement.

Tier 1 (ADR-053) built the schema (Plan.seat_limit/storage_limit_mb/
ai_monthly_request_limit, Subscription per tenant) and platform-admin
assignment, but nothing read these limits -- they were purely
informational. This module is the single place that reads a tenant's
plan and enforces each limit at its one real creation point:

  - seats: app/services/user_service.create_user,
    app/services/user_invite_service.accept_invite
  - storage: app/services/attachment_service.upload_attachment
  - AI usage: app/services/ai_service's three entry points

A tenant with no Subscription row (shouldn't normally happen --
platform_service seeds a Trial subscription at tenant creation -- but
defensive rather than assumed) or a plan with a null limit is treated as
unlimited, matching Plan's own "nullable = unlimited" convention.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError
from app.models.ai_usage import AIUsageLog
from app.models.identity import User
from app.models.subscription import Plan, Subscription
from app.models.test_case import Attachment


def _get_plan(db: Session, tenant_id: UUID) -> Plan | None:
    subscription = db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if subscription is None:
        return None
    return db.execute(select(Plan).where(Plan.id == subscription.plan_id)).scalar_one_or_none()


def enforce_seat_limit(db: Session, tenant_id: UUID) -> None:
    plan = _get_plan(db, tenant_id)
    if plan is None or plan.seat_limit is None:
        return
    active_count = db.execute(
        select(func.count(User.id)).where(User.tenant_id == tenant_id, User.is_active.is_(True))
    ).scalar_one()
    if active_count >= plan.seat_limit:
        raise ConflictError(
            f"This organization's plan ({plan.name}) allows at most {plan.seat_limit} "
            "active user(s). Deactivate a user or upgrade the plan before adding another."
        )


def enforce_storage_limit(db: Session, tenant_id: UUID, incoming_bytes: int) -> None:
    plan = _get_plan(db, tenant_id)
    if plan is None or plan.storage_limit_mb is None:
        return
    used_bytes = db.execute(
        select(func.coalesce(func.sum(Attachment.size_bytes), 0)).where(
            Attachment.tenant_id == tenant_id
        )
    ).scalar_one()
    limit_bytes = plan.storage_limit_mb * 1024 * 1024
    if used_bytes + incoming_bytes > limit_bytes:
        raise ConflictError(
            f"This organization's plan ({plan.name}) allows at most {plan.storage_limit_mb}MB "
            "of attachment storage. This upload would exceed that limit."
        )


def enforce_ai_quota(db: Session, tenant_id: UUID) -> None:
    plan = _get_plan(db, tenant_id)
    if plan is None or plan.ai_monthly_request_limit is None:
        return
    now = datetime.now(UTC)
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = db.execute(
        select(func.count(AIUsageLog.id)).where(
            AIUsageLog.tenant_id == tenant_id,
            AIUsageLog.created_at >= period_start,
        )
    ).scalar_one()
    if used >= plan.ai_monthly_request_limit:
        raise ConflictError(
            f"This organization's plan ({plan.name}) allows at most "
            f"{plan.ai_monthly_request_limit} AI request(s) per calendar month. "
            "That quota has been reached for the current period."
        )
