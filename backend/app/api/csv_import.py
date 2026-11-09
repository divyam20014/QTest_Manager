from uuid import UUID

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.errors import ValidationAppError
from app.core.responses import envelope
from app.services import csv_import_service

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
async def import_test_cases(
    file: UploadFile,
    ctx: SessionContext = Depends(require_permission("testcase.bulk_import_export")),
    db: Session = Depends(get_db),
) -> dict:
    raw = await file.read()
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
