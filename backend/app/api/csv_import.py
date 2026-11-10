from uuid import UUID

from fastapi import APIRouter, Depends, Request, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ValidationAppError
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.services import csv_import_service

settings = get_settings()

router = APIRouter(tags=["csv-import-export"])


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
        csv_text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValidationAppError("File must be UTF-8 encoded CSV") from exc

    report = csv_import_service.import_test_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, csv_text
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
