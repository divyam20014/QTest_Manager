import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Form, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_any_permission, require_permission
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ValidationAppError
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.services import csv_import_service, defect_export_service, export_common, job_service

settings = get_settings()

router = APIRouter(tags=["csv-import-export"])


async def _read_and_validate_csv(file: UploadFile) -> str:
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise ValidationAppError("File must have a .csv extension")

    raw = await file.read()
    if not raw:
        raise ValidationAppError("File is empty")
    if len(raw) > settings.csv_import_max_bytes:
        limit_mb = settings.csv_import_max_bytes // (1024 * 1024)
        raise ValidationAppError(f"File exceeds the {limit_mb}MB import size limit")

    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValidationAppError("File must be UTF-8 encoded CSV") from exc


@router.get("/test-cases/import/template.csv")
def download_template(
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
) -> PlainTextResponse:
    return PlainTextResponse(
        csv_import_service.TEMPLATE_CSV,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="test_case_import_template.csv"'},
    )


@router.post("/test-cases/import")
@limiter.limit("10/minute")
async def import_test_cases(
    request: Request,
    file: UploadFile,
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
    db: Session = Depends(get_db),
) -> dict:
    """Synchronous import, kept as-is (NFR 8.1's 2.5s/2000-row budget is
    proven against this exact path). Tier 1 / ADR-053 adds an async,
    job-queue-backed alternative below for callers that would rather not
    block the request -- this one is not being removed or deprecated."""
    csv_text = await _read_and_validate_csv(file)
    report = csv_import_service.import_test_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, csv_text
    )
    return envelope(report.model_dump(mode="json"))


@router.post("/test-cases/import/async")
@limiter.limit("10/minute")
async def import_test_cases_async(
    request: Request,
    file: UploadFile,
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
    db: Session = Depends(get_db),
) -> dict:
    """Tier 1 / ADR-053 (SR-6.10): enqueues the import and returns
    immediately instead of blocking the request -- poll
    GET /test-cases/import/jobs/{job_id} for completion."""
    csv_text = await _read_and_validate_csv(file)
    job = job_service.enqueue(
        db,
        ctx.tenant_id,
        ctx.user_id,
        job_service.CSV_IMPORT_JOB_TYPE,
        {"role_code": ctx.role_code, "actor_user_id": str(ctx.user_id), "csv_text": csv_text},
    )
    return envelope({"job_id": str(job.id), "status": job.status})


@router.get("/test-cases/import/jobs/{job_id}")
def get_import_job(
    job_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
    db: Session = Depends(get_db),
) -> dict:
    job = job_service.get_job(db, ctx.tenant_id, job_id)
    return envelope(job.model_dump(mode="json"))


@router.post("/test-cases/import/detect-columns")
@limiter.limit("20/minute")
async def detect_test_case_columns(
    request: Request,
    file: UploadFile,
    preset: str | None = None,
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
) -> dict:
    """Pass 3, item 2/3: step 1 of the flexible mapped-import flow -- parses
    only the header + a few sample rows of ANY CSV and, if `preset` names a
    known tool (testrail/zephyr/jira), pre-fills a best-effort suggested
    mapping. Nothing is written to the database by this endpoint."""
    csv_text = await _read_and_validate_csv(file)
    result = csv_import_service.detect_columns(csv_text, preset=preset)
    return envelope(result.model_dump(mode="json"))


@router.post("/test-cases/import/mapped")
@limiter.limit("10/minute")
async def import_test_cases_mapped(
    request: Request,
    file: UploadFile,
    mapping: str = Form(...),
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
    db: Session = Depends(get_db),
) -> dict:
    """Pass 3, item 2: step 2 -- import using the user-confirmed column
    mapping from the detect-columns step. `mapping` is a JSON object string:
    {"Title": "Case Title", "Module": "Section", ...}."""
    csv_text = await _read_and_validate_csv(file)
    try:
        column_mapping = json.loads(mapping)
    except json.JSONDecodeError as exc:
        raise ValidationAppError("mapping must be a JSON object string") from exc
    if not isinstance(column_mapping, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in column_mapping.items()
    ):
        raise ValidationAppError("mapping must be a JSON object of string -> string")
    report = csv_import_service.import_test_cases_mapped(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, csv_text, column_mapping
    )
    return envelope(report.model_dump(mode="json"))


def _export_filters(
    search: str | None,
    priority: str | None,
    status: str | None,
    assignee_id: UUID | None,
    module_id: UUID | None,
    test_type: str | None,
    severity: str | None,
    automation_status: str | None,
    environment: str | None,
    execution_status: str | None,
    executed_by: UUID | None,
    quarantined: Literal["any", "only", "exclude"],
) -> dict:
    """The list page's filters, so an export can be "the current filtered set"
    (ADR-117). Unset filters are left out."""
    raw = {
        "search": search,
        "priority": priority,
        "status": status,
        "assignee_id": assignee_id,
        "module_id": module_id,
        "test_type": test_type,
        "severity": severity,
        "automation_status": automation_status,
        "environment": environment,
        "execution_status": execution_status,
        "executed_by": executed_by,
        "quarantined": None if quarantined == "any" else quarantined,
    }
    return {k: v for k, v in raw.items() if v}


def _export_data(
    project_id: UUID,
    columns: str | None,
    ids: str | None,
    filters: dict,
    sort: str | None,
    ctx: SessionContext,
    db: Session,
) -> export_common.ExportData:
    return csv_import_service.export_test_cases_data(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id,
        columns,
        filters,
        sort,
        defect_export_service.parse_ids(ids),
    )


@router.get("/projects/{project_id}/test-cases/export.csv")
def export_test_cases(
    project_id: UUID,
    columns: str | None = Query(default=None, max_length=1000),
    ids: str | None = Query(default=None, max_length=100_000),
    search: str | None = Query(default=None, max_length=200),
    priority: str | None = Query(default=None),
    status: str | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    module_id: UUID | None = Query(default=None),
    test_type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    automation_status: str | None = Query(default=None),
    environment: str | None = Query(default=None),
    execution_status: str | None = Query(default=None),
    executed_by: UUID | None = Query(default=None),
    quarantined: Literal["any", "only", "exclude"] = Query(default="any"),
    sort: str | None = Query(default=None),
    ctx: SessionContext = Depends(
        require_any_permission("testcase.bulk_import_export", "testcase.export")
    ),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """All 22 fields by default; `columns=display_id,title,...` selects and orders
    columns (ADR-116), `ids=` exports just the selected rows (ADR-120), every list filter
    applies. At most 50,000 rows (`X-Result-Truncated: true` when cut). Needs
    `testcase.bulk_import_export` or `testcase.export`."""
    filters = _export_filters(
        search,
        priority,
        status,
        assignee_id,
        module_id,
        test_type,
        severity,
        automation_status,
        environment,
        execution_status,
        executed_by,
        quarantined,
    )
    data = _export_data(project_id, columns, ids, filters, sort, ctx, db)
    return export_common.csv_response(data, "test_cases_export.csv")


@router.get("/projects/{project_id}/test-cases/export.xlsx")
def export_test_cases_xlsx(
    project_id: UUID,
    columns: str | None = Query(default=None, max_length=1000),
    ids: str | None = Query(default=None, max_length=100_000),
    search: str | None = Query(default=None, max_length=200),
    priority: str | None = Query(default=None),
    status: str | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    module_id: UUID | None = Query(default=None),
    test_type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    automation_status: str | None = Query(default=None),
    environment: str | None = Query(default=None),
    execution_status: str | None = Query(default=None),
    executed_by: UUID | None = Query(default=None),
    quarantined: Literal["any", "only", "exclude"] = Query(default="any"),
    sort: str | None = Query(default=None),
    ctx: SessionContext = Depends(
        require_any_permission("testcase.bulk_import_export", "testcase.export")
    ),
    db: Session = Depends(get_db),
) -> Response:
    """ADR-071: same dataset, permission and project-access rules as export.csv,
    rendered as a workbook (bold frozen header, column widths)."""
    filters = _export_filters(
        search,
        priority,
        status,
        assignee_id,
        module_id,
        test_type,
        severity,
        automation_status,
        environment,
        execution_status,
        executed_by,
        quarantined,
    )
    data = _export_data(project_id, columns, ids, filters, sort, ctx, db)
    return export_common.xlsx_response(data, "Test Cases", "test_cases_export.xlsx")


# --- Defect bulk import (Pass 2) -- newly built; reuses the same
# "defect.create" permission a single defect create already requires,
# rather than introducing a separate bulk_import_export permission for
# a capability that didn't exist before this pass. ---------------------


@router.get("/defects/import/template.csv")
def download_defect_template(
    ctx: SessionContext = Depends(require_any_permission("defect.import", "defect.create")),
) -> PlainTextResponse:
    return PlainTextResponse(
        csv_import_service.DEFECT_TEMPLATE_CSV,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="defect_import_template.csv"'},
    )


@router.post("/defects/import")
@limiter.limit("10/minute")
async def import_defects(
    request: Request,
    file: UploadFile,
    ctx: SessionContext = Depends(require_any_permission("defect.import", "defect.create")),
    db: Session = Depends(get_db),
) -> dict:
    csv_text = await _read_and_validate_csv(file)
    report = csv_import_service.import_defects(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, csv_text
    )
    return envelope(report.model_dump(mode="json"))
