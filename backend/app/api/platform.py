from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import NotFoundError
from app.core.platform_auth import (
    enforce_step_up,
    require_platform_admin,
    require_platform_admin_step_up,
)
from app.core.rate_limit import limiter, scaled
from app.core.responses import envelope
from app.models.identity import PlatformAdmin
from app.schemas.audit import AuditCheckpointOut, CreateCheckpointResult
from app.schemas.platform import (
    PlatformAdminCreateRequest,
    PlatformAdminListResponse,
    PlatformAdminOut,
    PlatformAdminUpdateRequest,
    PlatformAdminWithCodeOut,
    TenantCreateRequest,
    TenantCreateResponse,
    TenantDataRegionUpdateRequest,
    TenantListResponse,
    TenantOut,
    TenantStatusUpdateRequest,
)
from app.schemas.platform_audit import PlatformAuditEventListResponse, PlatformAuditEventOut
from app.schemas.subscription import (
    PlanCreateRequest,
    PlanUpdateRequest,
    SubscriptionAssignRequest,
)
from app.services import (
    audit_checkpoint_service,
    docs_service,
    platform_audit_service,
    platform_service,
    subscription_service,
)

router = APIRouter(prefix="/platform", tags=["platform"])

# ADR-089/ADR-114: platform documentation is read-only and may be sensitive;
# never let a shared cache or the disk cache keep it after sign-out.
DOCS_NO_STORE = "private, no-store"


def _doc_summary(doc: docs_service.DocEntry) -> dict:
    return {
        "slug": doc.slug,
        "title": doc.title,
        "description": doc.description,
        "group": doc.group,
        "audience": doc.audience,
        "min_level": doc.audience,
        "source": doc.source,
    }


@router.get("/docs")
@limiter.limit(scaled(60))
def list_platform_docs(
    request: Request,
    response: Response,
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    """ADR-114: every document (no audience filter) for the platform console."""
    response.headers["Cache-Control"] = DOCS_NO_STORE
    docs = docs_service.list_all()
    return envelope({"groups": docs_service.GROUPS, "documents": [_doc_summary(d) for d in docs]})


@router.get("/docs/{slug}")
@limiter.limit(scaled(120))
def get_platform_doc(
    request: Request,
    response: Response,
    slug: str = Path(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$"),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    """One document's Markdown. The slug is matched against the registry only,
    never used to build a path from user input."""
    response.headers["Cache-Control"] = DOCS_NO_STORE
    doc = docs_service.find(slug)
    if doc is None:
        raise NotFoundError("Document not found")
    return envelope({**_doc_summary(doc), "content": docs_service.read_text(doc)})


@router.post("/tenants")
def create_tenant(
    req: TenantCreateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant, created_admin = platform_service.create_tenant_with_admin(db, req, admin.id)
    return envelope(
        TenantCreateResponse(
            tenant=TenantOut.model_validate(tenant), admin_user_id=created_admin.id
        ).model_dump()
    )


@router.get("/tenants")
def list_tenants(
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=platform_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenants, total = platform_service.list_tenants(
        db, search=search, status=status, page=page, page_size=page_size
    )
    items = [TenantOut.model_validate(t) for t in tenants]
    return envelope(TenantListResponse(items=items, total=total).model_dump(mode="json"))


@router.patch("/tenants/{tenant_id}/status")
def update_tenant_status(
    tenant_id: UUID,
    req: TenantStatusUpdateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant = platform_service.update_tenant_status(db, tenant_id, req.status, admin.id)
    return envelope(TenantOut.model_validate(tenant).model_dump())


# Tier 4 / ADR-054: data residency readiness (PV-11.6) -- metadata only,
# platform-admin-only (see platform_service.update_tenant_data_region).
@router.patch("/tenants/{tenant_id}/data-region")
def update_tenant_data_region(
    tenant_id: UUID,
    req: TenantDataRegionUpdateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant = platform_service.update_tenant_data_region(db, tenant_id, req.data_region, admin.id)
    return envelope(TenantOut.model_validate(tenant).model_dump())


# Gap-closure pass / ADR-057: break-glass recovery for the IP-allowlist
# self-lockout risk disclosed in Tier 4 -- see ADMINISTRATOR_GUIDE.md.
@router.post("/tenants/{tenant_id}/clear-ip-allowlist")
def clear_tenant_ip_allowlist(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    tenant = platform_service.clear_ip_allowlist(db, tenant_id, admin.id)
    return envelope(TenantOut.model_validate(tenant).model_dump())


# Tier 1 / ADR-053: subscription schema + platform-admin assignment only --
# no payment gateway, no billing engine (SR-3, SAAS-GAP-1).
@router.get("/plans")
def list_plans(
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    return envelope([p.model_dump(mode="json") for p in subscription_service.list_plans(db)])


@router.post("/plans")
def create_plan(
    req: PlanCreateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    return envelope(subscription_service.create_plan(db, req).model_dump(mode="json"))


@router.patch("/plans/{plan_code}")
def update_plan(
    plan_code: str,
    req: PlanUpdateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    return envelope(subscription_service.update_plan(db, plan_code, req).model_dump(mode="json"))


@router.get("/tenants/{tenant_id}/subscription")
def get_tenant_subscription(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    sub = subscription_service.get_tenant_subscription_as_platform_admin(db, tenant_id)
    return envelope(sub.model_dump(mode="json"))


@router.put("/tenants/{tenant_id}/subscription")
def assign_tenant_subscription(
    tenant_id: UUID,
    req: SubscriptionAssignRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    sub = subscription_service.assign_subscription(db, tenant_id, req, admin.id)
    return envelope(sub.model_dump(mode="json"))


# Platform Admin UI/UX pass: closes the gap where the only way to
# provision/deactivate a platform admin was the out-of-band CLI script.
@router.get("/admins")
def list_platform_admins(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=platform_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    admins, total = platform_service.list_platform_admins(db, page=page, page_size=page_size)
    items = [PlatformAdminOut.model_validate(a) for a in admins]
    return envelope(PlatformAdminListResponse(items=items, total=total).model_dump(mode="json"))


@router.post("/admins")
def create_platform_admin(
    req: PlatformAdminCreateRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin_step_up),
) -> dict:
    created, code = platform_service.create_platform_admin(db, req, admin.id)
    out = PlatformAdminWithCodeOut.model_validate(created)
    out.enrolment_code = code
    return envelope(out.model_dump(mode="json"))


@router.patch("/admins/{admin_id}")
def update_platform_admin(
    admin_id: UUID,
    req: PlatformAdminUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    if not req.is_active:  # ADR-083: deactivating needs a fresh step-up; reactivating does not
        enforce_step_up(request)
    updated = platform_service.update_platform_admin_active(db, admin_id, req.is_active, admin.id)
    return envelope(PlatformAdminOut.model_validate(updated).model_dump(mode="json"))


@router.post("/admins/{admin_id}/reset-mfa")
def reset_platform_admin_mfa(
    admin_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin_step_up),
) -> dict:
    """ADR-074: clear another admin's MFA (lost device); they re-enrol on
    their next sign-in with a fresh one-time enrolment code (returned once
    here, ADR-080). Refused for your own account."""
    updated, code = platform_service.reset_platform_admin_mfa(db, admin_id, admin.id)
    out = PlatformAdminWithCodeOut.model_validate(updated)
    out.enrolment_code = code
    return envelope(out.model_dump(mode="json"))


@router.post("/admins/{admin_id}/enrolment-code")
def reissue_platform_admin_enrolment_code(
    admin_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin_step_up),
) -> dict:
    """ADR-080: new one-time enrolment code for an admin who has not enrolled
    yet; the previous code stops working. Refused for your own account."""
    updated, code = platform_service.reissue_platform_admin_enrolment_code(db, admin_id, admin.id)
    out = PlatformAdminWithCodeOut.model_validate(updated)
    out.enrolment_code = code
    return envelope(out.model_dump(mode="json"))


@router.post("/admins/{admin_id}/password-reset-code")
@limiter.limit(scaled(10))
def issue_platform_admin_password_reset_code(
    request: Request,
    admin_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin_step_up),
) -> dict:
    """ADR-081: force another admin's password reset. Revokes their sessions and
    returns a one-time reset code (shown once); they must use it at sign-in.
    Refused for your own account."""
    updated, code = platform_service.issue_platform_admin_password_reset_code(
        db, admin_id, admin.id
    )
    out = PlatformAdminWithCodeOut.model_validate(updated)
    out.password_reset_code = code
    return envelope(out.model_dump(mode="json"))


# ADR-082: read-only platform audit trail (no write/delete route exists).
@router.get("/audit-events")
@limiter.limit(scaled(60))
def list_audit_events(
    request: Request,
    event_type: str | None = Query(default=None, max_length=64),
    outcome: str | None = Query(default=None, pattern="^(success|failure)$"),
    actor_email: str | None = Query(default=None, max_length=254),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    rows, total = platform_audit_service.list_events(
        db,
        event_type=event_type,
        outcome=outcome,
        actor_email=actor_email,
        page=page,
        page_size=page_size,
    )
    items = [PlatformAuditEventOut.model_validate(r) for r in rows]
    return envelope(
        PlatformAuditEventListResponse(items=items, total=total).model_dump(mode="json")
    )


@router.get("/audit-events/verify")
@limiter.limit(scaled(10))
def verify_audit_events(
    request: Request,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    result = platform_audit_service.verify_chain(db)
    return envelope(result.model_dump(mode="json"))


# ADR-085: signed checkpoints over the platform audit chain. Low-risk (it only
# anchors what is already there), so a platform session suffices -- no step-up.
@router.get("/audit-events/checkpoints")
@limiter.limit(scaled(30))
def list_audit_checkpoints(
    request: Request,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    rows = audit_checkpoint_service.list_checkpoints(db, audit_checkpoint_service.PLATFORM_SCOPE)
    return envelope([AuditCheckpointOut.model_validate(r).model_dump(mode="json") for r in rows])


@router.post("/audit-events/checkpoints")
@limiter.limit(scaled(10))
def create_audit_checkpoint(
    request: Request,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> dict:
    checkpoint = audit_checkpoint_service.create_checkpoint(
        db, audit_checkpoint_service.PLATFORM_SCOPE
    )
    result = CreateCheckpointResult(
        created=checkpoint is not None,
        reason=None if checkpoint else "no_new_events",
        checkpoint=AuditCheckpointOut.model_validate(checkpoint) if checkpoint else None,
    )
    return envelope(result.model_dump(mode="json"))


@router.get("/audit-events/checkpoints/export")
@limiter.limit(scaled(10))
def export_audit_checkpoints(
    request: Request,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(require_platform_admin),
) -> JSONResponse:
    rows = audit_checkpoint_service.list_checkpoints(db, audit_checkpoint_service.PLATFORM_SCOPE)
    body = {
        "scope": audit_checkpoint_service.PLATFORM_SCOPE,
        "exported_at": datetime.now(UTC).isoformat(),
        "checkpoints": [AuditCheckpointOut.model_validate(r).model_dump(mode="json") for r in rows],
    }
    return JSONResponse(
        body,
        headers={"Content-Disposition": 'attachment; filename="platform_audit_checkpoints.json"'},
    )
