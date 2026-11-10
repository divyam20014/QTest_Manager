from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import NotFoundError, ValidationAppError
from app.models.subscription import Plan, Subscription
from app.schemas.subscription import (
    PlanCreateRequest,
    PlanOut,
    PlanUpdateRequest,
    SubscriptionAssignRequest,
    SubscriptionOut,
)


def list_plans(db: Session) -> list[PlanOut]:
    plans = db.execute(
        select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.created_at)
    ).scalars()
    return [PlanOut.model_validate(p) for p in plans]


def create_plan(db: Session, req: PlanCreateRequest) -> PlanOut:
    """Platform-admin-only (gap-closure pass, ADR-057). `plans` is
    platform-wide with no RLS (same category as Role/Permission), so this
    needs no tenant context."""
    existing = db.execute(select(Plan).where(Plan.code == req.code)).scalar_one_or_none()
    if existing is not None:
        raise ValidationAppError(f"A plan with code '{req.code}' already exists")
    plan = Plan(
        code=req.code,
        name=req.name,
        seat_limit=req.seat_limit,
        storage_limit_mb=req.storage_limit_mb,
        ai_monthly_request_limit=req.ai_monthly_request_limit,
        is_active=req.is_active,
    )
    db.add(plan)
    db.commit()
    return PlanOut.model_validate(plan)


def update_plan(db: Session, plan_code: str, req: PlanUpdateRequest) -> PlanOut:
    plan = db.execute(select(Plan).where(Plan.code == plan_code)).scalar_one_or_none()
    if plan is None:
        raise NotFoundError(f"Unknown plan code: {plan_code}")
    updates = req.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(plan, field, value)
    db.commit()
    return PlanOut.model_validate(plan)


def _to_out(db: Session, subscription: Subscription) -> SubscriptionOut:
    # ADR-007 addendum (matches attachment_service._to_out): re-assert
    # tenant context before touching any attribute that might need a
    # fresh fetch (e.g. a server_default/onupdate column like updated_at),
    # in case this runs after a commit in the same request -- the RLS GUC
    # is transaction-local and resets on commit just as much as rollback.
    set_tenant_context(db, str(subscription.tenant_id))
    plan = db.execute(select(Plan).where(Plan.id == subscription.plan_id)).scalar_one()
    return SubscriptionOut(
        id=subscription.id,
        plan=PlanOut.model_validate(plan),
        status=subscription.status,  # type: ignore[arg-type]
        seat_count=subscription.seat_count,
        current_period_start=subscription.current_period_start,
        current_period_end=subscription.current_period_end,
        created_at=subscription.created_at,
        updated_at=subscription.updated_at,
    )


def get_tenant_subscription(db: Session, tenant_id: UUID) -> SubscriptionOut:
    """Tenant-facing, read-only (GET /settings/subscription)."""
    set_tenant_context(db, str(tenant_id))
    subscription = db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if subscription is None:
        raise NotFoundError("No subscription found for this organization")
    return _to_out(db, subscription)


def get_tenant_subscription_as_platform_admin(db: Session, tenant_id: UUID) -> SubscriptionOut:
    """Platform-admin read. Unlike the tenant-facing read, the caller has no
    session-derived tenant context -- but the target tenant_id is already
    known (from the URL path), so it's set explicitly here rather than
    being circular the way Session/UserInvite/BackgroundJob lookups are."""
    set_tenant_context(db, str(tenant_id))
    subscription = db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if subscription is None:
        raise NotFoundError("No subscription found for this tenant")
    return _to_out(db, subscription)


def assign_subscription(
    db: Session,
    tenant_id: UUID,
    req: SubscriptionAssignRequest,
    platform_admin_id: UUID | None = None,
) -> SubscriptionOut:
    """Platform-admin-only create/update of a tenant's subscription row."""
    plan = db.execute(select(Plan).where(Plan.code == req.plan_code)).scalar_one_or_none()
    if plan is None:
        raise ValidationAppError(f"Unknown plan code: {req.plan_code}")

    # tenant_id is already known (from the URL path) -- set it before the
    # first tenant-scoped query/insert below, since `subscriptions` is
    # RLS-FORCE-protected and both the SELECT and the INSERT's WITH CHECK
    # would otherwise see no rows / be rejected.
    set_tenant_context(db, str(tenant_id))
    subscription = db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id)
    ).scalar_one_or_none()

    is_new = subscription is None
    if subscription is None:
        subscription = Subscription(tenant_id=tenant_id, plan_id=plan.id)
        db.add(subscription)

    subscription.plan_id = plan.id
    subscription.status = req.status
    subscription.seat_count = req.seat_count
    subscription.current_period_end = req.current_period_end
    if is_new:
        subscription.current_period_start = datetime.now(UTC)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=None,
        platform_admin_id=platform_admin_id,
        action="subscription.assigned",
        entity_type="subscription",
        entity_id=subscription.id,
        metadata={"plan_code": req.plan_code, "status": req.status, "seat_count": req.seat_count},
    )
    db.commit()
    return _to_out(db, subscription)
