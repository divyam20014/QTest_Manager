from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.schemas.access_rule import (
    AccessRuleCreateRequest,
    AccessRuleOut,
    AccessRulePreviewOut,
    AccessRulePreviewRequest,
    AccessRuleUpdateRequest,
    ActiveAccessRuleOut,
)
from app.services import access_rule_service

# RBAC Phase 4 (ADR-092): Admin-only management of tenant access rules
# (release-freeze windows, restricted environments). Off by default.
router = APIRouter(prefix="/access-rules", tags=["access-rules"])


@router.get("")
@limiter.limit(scaled(60))
def list_access_rules(
    request: Request,
    ctx: SessionContext = Depends(require_permission("access_rule.manage")),
    db: Session = Depends(get_db),
) -> dict:
    rules = access_rule_service.list_rules(db, ctx.tenant_id)
    return envelope([AccessRuleOut.model_validate(r).model_dump(mode="json") for r in rules])


@router.get("/active")
@limiter.limit(scaled(120))
def list_active_access_rules(
    request: Request,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """Any signed-in user: only the rules restricting their own role right
    now (reason + end time), for UI banners."""
    rules = access_rule_service.active_rules_for_role(db, ctx.tenant_id, ctx.role_code)
    return envelope(
        [
            ActiveAccessRuleOut(
                id=r.id,
                rule_type=r.rule_type,
                project_id=r.project_id,
                environment=r.environment,
                reason=r.reason,
                ends_at=r.ends_at if r.rule_type == "freeze_window" else None,
                blocked_actions=list(r.blocked_actions),
            ).model_dump(mode="json")
            for r in rules
        ]
    )


@router.post("/preview")
@limiter.limit(scaled(60))
def preview_access_rules(
    req: AccessRulePreviewRequest,
    request: Request,
    ctx: SessionContext = Depends(require_permission("access_rule.manage")),
    db: Session = Depends(get_db),
) -> dict:
    hit = access_rule_service.preview(db, ctx.tenant_id, req)
    return envelope(
        AccessRulePreviewOut(
            blocked=hit is not None,
            rule_id=hit.id if hit else None,
            reason=hit.reason if hit else None,
        ).model_dump(mode="json")
    )


@router.post("")
@limiter.limit(scaled(30))
def create_access_rule(
    req: AccessRuleCreateRequest,
    request: Request,
    ctx: SessionContext = Depends(require_permission("access_rule.manage")),
    db: Session = Depends(get_db),
) -> dict:
    rule = access_rule_service.create_rule(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(AccessRuleOut.model_validate(rule).model_dump(mode="json"))


@router.get("/{rule_id}")
@limiter.limit(scaled(60))
def get_access_rule(
    rule_id: UUID,
    request: Request,
    ctx: SessionContext = Depends(require_permission("access_rule.manage")),
    db: Session = Depends(get_db),
) -> dict:
    rule = access_rule_service.get_rule(db, ctx.tenant_id, rule_id)
    return envelope(AccessRuleOut.model_validate(rule).model_dump(mode="json"))


@router.patch("/{rule_id}")
@limiter.limit(scaled(30))
def update_access_rule(
    rule_id: UUID,
    req: AccessRuleUpdateRequest,
    request: Request,
    ctx: SessionContext = Depends(require_permission("access_rule.manage")),
    db: Session = Depends(get_db),
) -> dict:
    rule = access_rule_service.update_rule(db, ctx.tenant_id, ctx.user_id, rule_id, req)
    return envelope(AccessRuleOut.model_validate(rule).model_dump(mode="json"))


@router.delete("/{rule_id}")
@limiter.limit(scaled(30))
def delete_access_rule(
    rule_id: UUID,
    request: Request,
    ctx: SessionContext = Depends(require_permission("access_rule.manage")),
    db: Session = Depends(get_db),
) -> dict:
    access_rule_service.delete_rule(db, ctx.tenant_id, ctx.user_id, rule_id)
    return envelope({"deleted": True})
