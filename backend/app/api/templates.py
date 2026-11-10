from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.template import TemplateImportRequest
from app.services import template_service

router = APIRouter(tags=["templates"])


@router.get("/templates")
def list_templates(
    ctx: SessionContext = Depends(get_current_context),
) -> dict:
    return envelope(
        [t.model_dump(mode="json") for t in template_service.list_available_templates()]
    )


@router.post("/projects/{project_id}/templates/import")
def import_templates(
    project_id: UUID,
    req: TemplateImportRequest,
    ctx: SessionContext = Depends(require_permission("testcase.edit")),
    db: Session = Depends(get_db),
) -> dict:
    result = template_service.import_templates(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req.template_ids
    )
    return envelope(result.model_dump(mode="json"))
