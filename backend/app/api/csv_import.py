import json
from uuid import UUID

from fastapi import APIRouter, Depends, Form, Request, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ValidationAppError
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.services import csv_import_service, job_service

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


@router.get("/projects/{project_id}/test-cases/export.csv")
def export_test_cases(
    project_id: UUID,
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
    db: Session = Depends(get_db),
) -> PlainTextResponse:
    csv_text = csv_import_service.export_test_cases_csv(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return PlainTextResponse(
        csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="test_cases_export.csv"'},
    )


# --- Defect bulk import (Pass 2) -- newly built; reuses the same
# "defect.create" permission a single defect create already requires,
# rather than introducing a separate bulk_import_export permission for
# a capability that didn't exist before this pass. ---------------------


@router.get("/defects/import/template.csv")
def download_defect_template(
    ctx: SessionContext = Depends(require_permission("defect.create")),
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
    ctx: SessionContext = Depends(require_permission("defect.create")),
    db: Session = Depends(get_db),
) -> dict:
    csv_text = await _read_and_validate_csv(file)
    report = csv_import_service.import_defects(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, csv_text
    )
    return envelope(report.model_dump(mode="json"))
