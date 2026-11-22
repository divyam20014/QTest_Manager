from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    require_permission,
    require_resource_permission,
)
from app.core.db import get_db
from app.core.idempotency import with_idempotency
from app.core.policy import require_policy
from app.core.responses import envelope
from app.schemas.defect import (
    DefectBuildReleaseUpdateRequest,
    DefectCreateRequest,
    DefectEnvironmentUpdateRequest,
    DefectLinkCreateRequest,
    DefectListResponse,
    DefectRootCauseUpdateRequest,
    DefectStatusCountsOut,
    DefectStatusUpdateRequest,
    DefectUpdateRequest,
)
from app.services import ai_service, defect_service

router = APIRouter(prefix="/defects", tags=["defects"])


@router.get("")
def list_defects(
    response: Response,
    project_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    test_run_id: UUID | None = Query(default=None),
    reported_by: UUID | None = Query(default=None),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    test_case_id: UUID | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=defect_service.DEFECT_MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None, max_length=300),
    include_total: bool = Query(default=True),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """Without `page_size`: the matching defects as a plain list (what the run, project
    and test case screens use), capped at `DEFECT_PLAIN_LIST_CAP` rows (header
    `X-Result-Truncated: true` when the cap was hit). With `page_size`: one page, newest
    first, as `{items, total}` (ADR-078); `test_run_id` and `test_case_id` apply to the
    plain list only. Optional `cursor` (empty = first page) switches the page to keyset
    paging: the body then also carries `next_cursor` (ADR-113)."""
    if page_size is not None:
        defects_page, total, next_cursor = defect_service.list_defects_page(
            db,
            ctx.tenant_id,
            ctx.role_code,
            ctx.user_id,
            project_id,
            status,
            severity,
            reported_by,
            created_from,
            created_to,
            page,
            page_size,
            search,
            cursor,
            include_total,
        )
        body = DefectListResponse(
            items=defect_service.to_out_many(db, defects_page), total=total
        ).model_dump(mode="json")
        if cursor is not None:
            body["next_cursor"] = next_cursor
        return envelope(body)
    defects = defect_service.list_defects(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id,
        status,
        severity,
        test_run_id,
        reported_by,
        created_from,
        created_to,
        test_case_id,
    )
    if len(defects) >= defect_service.DEFECT_PLAIN_LIST_CAP:
        response.headers["X-Result-Truncated"] = "true"
    return envelope([d.model_dump(mode="json") for d in defect_service.to_out_many(db, defects)])


@router.get("/status-counts")
def defect_status_counts(
    project_id: UUID | None = Query(default=None),
    severity: str | None = Query(default=None),
    reported_by: UUID | None = Query(default=None),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    search: str | None = Query(default=None, max_length=200),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-078: matching defects per status, under every filter except status."""
    counts = defect_service.defect_status_counts(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id,
        severity,
        reported_by,
        created_from,
        created_to,
        search,
    )
    out = DefectStatusCountsOut(counts=counts, total=sum(counts.values()))
    return envelope(out.model_dump(mode="json"))


@router.post("")
def create_defect(
    req: DefectCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ctx: SessionContext = Depends(require_permission("defect.create")),
    db: Session = Depends(get_db),
) -> dict:
    defect = with_idempotency(
        db,
        ctx.tenant_id,
        ctx.user_id,
        "defect.create",
        idempotency_key,
        create=lambda: defect_service.create_defect(
            db, ctx.tenant_id, ctx.role_code, ctx.user_id, req
        ),
        get_by_id=lambda eid: defect_service.get_defect(
            db, ctx.tenant_id, ctx.role_code, ctx.user_id, eid
        ),
        entity_id_of=lambda d: d.id,
    )
    out = defect_service.to_out(db, defect).model_dump(mode="json")
    # Duplicate-detection check at creation time, surfaced alongside the
    # created defect -- additive field, never blocks creation.
    duplicates = defect_service.find_possible_duplicates(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect.id
    )
    out["possible_duplicates"] = [d.model_dump(mode="json") for d in duplicates]
    return envelope(out)


@router.get("/{defect_id}/possible-duplicates")
def get_possible_duplicates(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    duplicates = defect_service.find_possible_duplicates(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id
    )
    return envelope([d.model_dump(mode="json") for d in duplicates])


@router.get("/{defect_id}")
def get_defect(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.get_defect(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id)
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.patch("/{defect_id}")
def update_defect(
    defect_id: UUID,
    req: DefectUpdateRequest,
    ctx: SessionContext = Depends(require_policy("resource_not_locked")),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.update_defect(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, req
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.get("/{defect_id}/history")
def get_defect_history(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    history = defect_service.get_defect_history(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id
    )
    return envelope([h.model_dump(mode="json") for h in history])


@router.patch("/{defect_id}/status")
def update_status(
    defect_id: UUID,
    req: DefectStatusUpdateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.update_status(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        defect_id,
        req.status,
        req.verification_confirmed,
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.post("/{defect_id}/reopen")
def reopen_defect(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.reopen_defect(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id)
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.patch("/{defect_id}/environment")
def set_defect_environment(
    defect_id: UUID,
    req: DefectEnvironmentUpdateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.set_defect_environment(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, req.environment_id
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.patch("/{defect_id}/build-release")
def update_build_release(
    defect_id: UUID,
    req: DefectBuildReleaseUpdateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.update_build_release(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        defect_id,
        req.found_in_build_id,
        req.fixed_in_release_id,
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.patch("/{defect_id}/root-cause")
def update_root_cause(
    defect_id: UUID,
    req: DefectRootCauseUpdateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.update_root_cause(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, req.root_cause
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.post("/{defect_id}/ai-suggest-root-cause")
def ai_suggest_root_cause(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-060: suggestion-only, same as Phase 4's AI Test Case Reviewer --
    never auto-sets Defect.root_cause. View-level access (same bar as
    GET /defects/{id}), since this doesn't change anything."""
    defect = defect_service.get_defect(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id)
    result = ai_service.suggest_defect_root_cause(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect
    )
    return envelope(result.model_dump(mode="json"))


@router.post("/{defect_id}/links")
def add_link(
    defect_id: UUID,
    req: DefectLinkCreateRequest,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.add_link(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, req)
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.delete("/{defect_id}")
def delete_defect(
    defect_id: UUID,
    ctx: SessionContext = Depends(require_resource_permission("defect.delete", "defect")),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-070: soft delete (Admin/Manager). The defect disappears from lists
    and reports; its row, links and history are retained."""
    defect_service.delete_defect(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id)
    return envelope({"id": str(defect_id), "deleted": True})
