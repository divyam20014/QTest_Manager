from dataclasses import replace
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    get_effective_permissions_for_project,
    require_any_permission,
    require_permission,
    require_resource_permission,
)
from app.core.db import get_db
from app.core.errors import ForbiddenError
from app.core.idempotency import with_idempotency
from app.core.policy import apply_access_rules, require_policy, resolve_project_id_for_resource
from app.core.responses import envelope
from app.schemas.defect import (
    DefectBuildReleaseUpdateRequest,
    DefectCreateRequest,
    DefectEnvironmentUpdateRequest,
    DefectLinkCreateRequest,
    DefectListResponse,
    DefectRetestRequest,
    DefectRetestResultRequest,
    DefectRootCauseUpdateRequest,
    DefectStatusCountsOut,
    DefectStatusUpdateRequest,
    DefectUpdateRequest,
)
from app.services import (
    ai_service,
    defect_export_service,
    defect_retest_service,
    defect_service,
    export_common,
)

router = APIRouter(prefix="/defects", tags=["defects"])


def require_defect_permission(*codes: str):
    """ADR-118: gate a `/defects/{defect_id}/...` route behind ANY of `codes` (the new
    code or its legacy equivalent, so no built-in role regresses). A project-scoped role
    override applies as for `require_resource_permission`; the returned context carries
    the effective permissions so the service layer sees the same set."""

    def _checker(
        request: Request,
        ctx: SessionContext = Depends(get_current_context),
        db: Session = Depends(get_db),
    ) -> SessionContext:
        raw_id = request.path_params.get("defect_id")
        try:
            resource_id = UUID(str(raw_id)) if raw_id is not None else None
        except ValueError:
            resource_id = None
        project_id = (
            resolve_project_id_for_resource(db, ctx.tenant_id, "defect", resource_id)
            if resource_id is not None
            else None
        )
        effective = (
            get_effective_permissions_for_project(db, ctx, project_id)
            if project_id is not None
            else ctx.permissions
        )
        granted = [c for c in codes if c in effective]
        if not granted:
            raise ForbiddenError(f"Missing permission: {' or '.join(codes)}")
        apply_access_rules(ctx, request, db, granted[0], project_id)
        return replace(ctx, permissions=set(effective))

    return _checker


_EDIT = ("defect.edit", "defect.create")
_CHANGE_STATUS = ("defect.change_status", "defect.create", "defect.close")


def defect_filters(
    project_id: UUID | None = Query(default=None),
    status: list[str] | None = Query(default=None),
    severity: list[str] | None = Query(default=None),
    priority: list[str] | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    assignee: UUID | None = Query(default=None),
    reported_by: UUID | None = Query(default=None),
    reporter: UUID | None = Query(default=None),
    module_id: UUID | None = Query(default=None),
    module: UUID | None = Query(default=None),
    labels: list[str] | None = Query(default=None),
    label: list[str] | None = Query(default=None),
    test_case_id: UUID | None = Query(default=None),
    task_id: UUID | None = Query(default=None),
    include_sub_tasks: bool = Query(default=False),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    fix_version: str | None = Query(default=None, max_length=200),
    environment: str | None = Query(default=None, max_length=200),
    resolution: str | None = Query(default=None, max_length=64),
    search: str | None = Query(default=None, max_length=200),
) -> defect_service.DefectFilters:
    """Every list / export filter. `status`, `severity`, `priority` and `labels` take
    repeated or comma-separated values (any of); labels must all be present."""
    return defect_service.DefectFilters(
        project_id=project_id,
        statuses=defect_service.split_values(status),
        severities=defect_service.split_values(severity),
        priorities=defect_service.split_values(priority),
        assignee_id=assignee_id or assignee,
        reported_by=reported_by or reporter,
        module_id=module_id or module,
        labels=defect_service.split_values((labels or []) + (label or [])),
        test_case_id=test_case_id,
        task_id=task_id,
        include_sub_tasks=include_sub_tasks,
        created_from=created_from,
        created_to=created_to,
        fix_version=fix_version,
        environment=environment,
        resolution=resolution,
        search=search,
    )


@router.get("")
def list_defects(
    response: Response,
    f: defect_service.DefectFilters = Depends(defect_filters),
    test_run_id: UUID | None = Query(default=None),
    sort: str | None = Query(default=None, max_length=40),
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=defect_service.DEFECT_MAX_PAGE_SIZE),
    cursor: str | None = Query(default=None, max_length=300),
    include_total: bool = Query(default=True),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """Without `page_size`: the matching defects as a plain list (what the run, project
    and test case screens use), capped at `DEFECT_PLAIN_LIST_CAP` rows (header
    `X-Result-Truncated: true` when the cap was hit). With `page_size`: one page as
    `{items, total}` (ADR-078); `test_run_id` applies to the plain list only. `sort` is
    `field` or `-field` (display_id, title, severity, priority, status, assignee,
    date_reported, fix_version; default `-created_at`). Optional `cursor` (empty = first
    page) switches the page to keyset paging, newest-first only: the body then also
    carries `next_cursor` (ADR-113)."""
    if page_size is not None:
        defects_page, total, next_cursor = defect_service.list_defects_page(
            db,
            ctx.tenant_id,
            ctx.role_code,
            ctx.user_id,
            f,
            page,
            page_size,
            sort,
            cursor,
            include_total,
        )
        body = DefectListResponse(
            items=defect_service.to_out_many(db, defects_page), total=total
        ).model_dump(mode="json")
        if cursor is not None:
            body["next_cursor"] = next_cursor
        return envelope(body)
    f.test_run_id = test_run_id
    defects = defect_service.list_defects(db, ctx.tenant_id, ctx.role_code, ctx.user_id, f, sort)
    if len(defects) >= defect_service.DEFECT_PLAIN_LIST_CAP:
        response.headers["X-Result-Truncated"] = "true"
    return envelope([d.model_dump(mode="json") for d in defect_service.to_out_many(db, defects)])


@router.get("/status-counts")
def defect_status_counts(
    f: defect_service.DefectFilters = Depends(defect_filters),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-078: matching defects per status, under every filter except status."""
    counts = defect_service.defect_status_counts(db, ctx.tenant_id, ctx.role_code, ctx.user_id, f)
    out = DefectStatusCountsOut(counts=counts, total=sum(counts.values()))
    return envelope(out.model_dump(mode="json"))


@router.get("/columns")
def get_defect_columns(ctx: SessionContext = Depends(get_current_context)) -> dict:
    """ADR-118: the 22 fields (keys, labels, types, flags), the ten default columns,
    the sorts and filters, the statuses with their allowed transitions, and the export
    columns."""
    return envelope(defect_service.get_field_catalog().model_dump(mode="json"))


def _export_rows(
    f: defect_service.DefectFilters,
    columns: str | None,
    ids: str | None,
    sort: str | None,
    ctx: SessionContext,
    db: Session,
) -> export_common.ExportData:
    f.ids = defect_export_service.parse_ids(ids)
    return defect_export_service.export_defects_data(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, f, columns, sort
    )


@router.get("/export.csv")
def export_defects_csv(
    f: defect_service.DefectFilters = Depends(defect_filters),
    columns: str | None = Query(default=None, max_length=1000),
    ids: str | None = Query(default=None, max_length=100_000),
    sort: str | None = Query(default=None, max_length=40),
    ctx: SessionContext = Depends(require_any_permission("defect.export")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """All 22 fields by default (plus Root Cause Notes); `columns=display_id,title,...`
    selects and orders columns, `ids=` exports just those rows, and every list filter
    and `sort` applies. At most 50,000 rows (`X-Result-Truncated: true` when cut). Needs
    `defect.export`; a Tester only gets defects of the projects they are assigned to."""
    data = _export_rows(f, columns, ids, sort, ctx, db)
    return export_common.csv_response(data, "defects_export.csv")


@router.get("/export.xlsx")
def export_defects_xlsx(
    f: defect_service.DefectFilters = Depends(defect_filters),
    columns: str | None = Query(default=None, max_length=1000),
    ids: str | None = Query(default=None, max_length=100_000),
    sort: str | None = Query(default=None, max_length=40),
    ctx: SessionContext = Depends(require_any_permission("defect.export")),
    db: Session = Depends(get_db),
) -> Response:
    """Same dataset, permission and visibility as export.csv, as a workbook."""
    data = _export_rows(f, columns, ids, sort, ctx, db)
    return export_common.xlsx_response(data, "Defects", "defects_export.xlsx")


@router.post("")
def create_defect(
    req: DefectCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ctx: SessionContext = Depends(require_permission("defect.create")),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-118: mandatory on create (422 with `error.fields`): title, description, at
    least one step to reproduce, expected and actual result, environment, severity and
    priority. Status defaults to New; the reporter and the date are automatic. From a
    failed execution (`execution_step_id` or `test_run_case_id`) whatever is not sent is
    taken from the execution."""
    defect = with_idempotency(
        db,
        ctx.tenant_id,
        ctx.user_id,
        "defect.create",
        idempotency_key,
        create=lambda: defect_service.create_defect(
            db, ctx.tenant_id, ctx.role_code, ctx.user_id, req, enforce=True
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
    _lock: SessionContext = Depends(require_policy("resource_not_locked")),
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Edit any field of the standard except the id, the reporter, the date and the
    status (own endpoint). Changing the assignee also needs `defect.assign`. A field the
    row already had can only be blanked for the optional ones."""
    defect = defect_service.update_defect(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        defect_id,
        req,
        permissions=ctx.permissions,
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
    ctx: SessionContext = Depends(require_defect_permission(*_CHANGE_STATUS)),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-118: any of the 11 statuses, checked against the transition table (409 with
    the allowed next statuses) and the resolution rules (422). Closing also needs
    `defect.close` (or the Admin / Manager tier) and `verification_confirmed`."""
    defect = defect_service.update_status(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        defect_id,
        req.status,
        req.verification_confirmed,
        req.resolution,
        req.comment,
        expected_version=req.expected_version,
        permissions=ctx.permissions,
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.post("/{defect_id}/reopen")
def reopen_defect(
    defect_id: UUID,
    ctx: SessionContext = Depends(require_defect_permission(*_CHANGE_STATUS)),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.reopen_defect(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, permissions=ctx.permissions
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.patch("/{defect_id}/environment")
def set_defect_environment(
    defect_id: UUID,
    req: DefectEnvironmentUpdateRequest,
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
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
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
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
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
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
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.add_link(db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, req)
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.delete("/{defect_id}/links/{link_id}")
def remove_link(
    defect_id: UUID,
    link_id: UUID,
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.remove_link(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, link_id
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.get("/{defect_id}/test-cases")
def list_defect_test_cases(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    """The linked test cases (primary FK and link rows): display id, title, module path,
    latest execution status / date / tester, its run and the run case the defect was
    raised from."""
    items = defect_service.list_defect_test_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id
    )
    return envelope([i.model_dump(mode="json") for i in items])


@router.post("/{defect_id}/test-cases/{test_case_id}")
def link_test_case(
    defect_id: UUID,
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Link a test case (idempotent). The case must exist, not be deleted and belong to
    the defect's project."""
    defect, created = defect_service.link_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, test_case_id
    )
    out = defect_service.to_out(db, defect).model_dump(mode="json")
    out["link_created"] = created
    return envelope(out)


@router.delete("/{defect_id}/test-cases/{test_case_id}")
def unlink_test_case(
    defect_id: UUID,
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_defect_permission(*_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    defect = defect_service.unlink_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id, test_case_id
    )
    return envelope(defect_service.to_out(db, defect).model_dump(mode="json"))


@router.post("/{defect_id}/retest")
def start_retest(
    defect_id: UUID,
    req: DefectRetestRequest | None = None,
    ctx: SessionContext = Depends(require_defect_permission(*_CHANGE_STATUS)),
    db: Session = Depends(get_db),
) -> dict:
    """A Fixed (or Retest) defect: creates a 'Retest' test run with its linked test
    cases, assigned to the reporter or `tester_id`, with the defect linked to each run
    case; a Fixed defect moves to Retest."""
    out = defect_retest_service.start_retest(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        defect_id,
        req or DefectRetestRequest(),
    )
    return envelope(out.model_dump(mode="json"))


@router.post("/{defect_id}/retest-result")
def record_retest_result(
    defect_id: UUID,
    req: DefectRetestResultRequest,
    ctx: SessionContext = Depends(require_defect_permission("defect.change_status")),
    db: Session = Depends(get_db),
) -> dict:
    """Pass moves Retest to Closed (resolution Fixed) for a caller who may close
    defects, else to Verified; fail moves it to Reopened. Earlier executions are never
    changed: every retest is its own run case."""
    out = defect_retest_service.record_retest_result(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        defect_id,
        req,
        permissions=ctx.permissions,
    )
    return envelope(out.model_dump(mode="json"))


@router.get("/{defect_id}/retests")
def list_retests(
    defect_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    items = defect_retest_service.list_retests(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, defect_id
    )
    return envelope([i.model_dump(mode="json") for i in items])


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
