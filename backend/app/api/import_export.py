"""ADR-120: standard import (template, preview, commit) for test cases and defects.

Registered before the test case and defect routers so the static `/import...` paths are not
read as an id. Permissions: test cases `testcase.bulk_import_export` or `testcase.create`,
defects `defect.import` or `defect.create`; the project is checked in the service.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Form, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_any_permission
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ValidationAppError
from app.core.rate_limit import limiter
from app.core.responses import envelope
from app.services import import_export_service as svc
from app.services import import_template_service as templates

settings = get_settings()
router = APIRouter(tags=["import-export"])


class ImportCommitRequest(BaseModel):
    token: str
    mode: Literal["all_or_nothing", "skip_invalid"] = "all_or_nothing"


def _actor(ctx: SessionContext) -> svc.Actor:
    return svc.Actor(ctx.tenant_id, ctx.user_id, ctx.role_code, frozenset(ctx.permissions))


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read(settings.import_file_max_bytes + 1)
    if len(raw) > settings.import_file_max_bytes:
        limit_mb = settings.import_file_max_bytes // (1024 * 1024)
        raise ValidationAppError(f"The file is larger than the {limit_mb} MB import limit")
    return raw


def _disposition(kind: str, fmt: str) -> str:
    return f'attachment; filename="{templates.template_filename(kind, fmt)}"'


def _register(kind: str, prefix: str, codes: tuple[str, ...]) -> None:
    permission = require_any_permission(*codes)

    @router.get(f"{prefix}/import-template.xlsx", name=f"{kind}_template_xlsx")
    def template_xlsx(
        ctx: SessionContext = Depends(permission), db: Session = Depends(get_db)
    ) -> Response:
        body = templates.build_xlsx(db, ctx.tenant_id, kind)
        return Response(
            body,
            media_type=templates.XLSX_MEDIA_TYPE,
            headers={"Content-Disposition": _disposition(kind, "xlsx")},
        )

    @router.get(f"{prefix}/import-template.csv", name=f"{kind}_template_csv")
    def template_csv(ctx: SessionContext = Depends(permission)) -> PlainTextResponse:
        return PlainTextResponse(
            templates.build_csv(kind),
            media_type=templates.CSV_MEDIA_TYPE,
            headers={"Content-Disposition": _disposition(kind, "csv")},
        )

    @router.post(f"{prefix}/import/preview", name=f"{kind}_import_preview")
    @limiter.limit("10/minute")
    async def preview(
        request: Request,
        file: UploadFile,
        project_id: UUID = Form(...),
        ctx: SessionContext = Depends(permission),
        db: Session = Depends(get_db),
    ) -> dict:
        """Parse and validate the file without writing anything; returns the preview and
        a token (about 30 minutes) for the commit."""
        raw = await _read_upload(file)
        return envelope(svc.create_preview(db, _actor(ctx), kind, project_id, file.filename, raw))

    @router.get(f"{prefix}/import/preview/{{token}}/rows", name=f"{kind}_import_preview_rows")
    def preview_rows(
        token: str,
        status: Literal["all", "valid", "warning", "error", "issues"] = Query(default="all"),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=500),
        ctx: SessionContext = Depends(permission),
        db: Session = Depends(get_db),
    ) -> dict:
        return envelope(
            svc.preview_rows(
                db, _actor(ctx), kind, token, status=status, offset=offset, limit=limit
            )
        )

    @router.post(f"{prefix}/import/commit", name=f"{kind}_import_commit")
    @limiter.limit("10/minute")
    def commit(
        request: Request,
        body: ImportCommitRequest,
        ctx: SessionContext = Depends(permission),
        db: Session = Depends(get_db),
    ) -> dict:
        """Re-validate and insert in one transaction. `all_or_nothing` (default) refuses the
        whole file when any row is invalid; `skip_invalid` imports the valid rows. Large
        imports (above the async threshold) return a `job_id` to poll."""
        return envelope(svc.commit(db, _actor(ctx), kind, body.token, body.mode))

    @router.get(f"{prefix}/import/status/{{job_id}}", name=f"{kind}_import_status")
    def status(
        job_id: UUID,
        ctx: SessionContext = Depends(permission),
        db: Session = Depends(get_db),
    ) -> dict:
        return envelope(svc.get_commit_job(db, _actor(ctx), kind, job_id))


_register("test_case", "/test-cases", ("testcase.bulk_import_export", "testcase.create"))
_register("defect", "/defects", ("defect.import", "defect.create"))
