from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.workspace import WorkspaceConfig
from app.services import workspace_service

router = APIRouter(prefix="/settings/workspace", tags=["settings"])


# ADR-125: readable by every signed-in member (the shell needs it to draw the sidebar, the
# project tabs and the list view switches); only replacing it needs tenant.settings.manage.
@router.get("")
def get_workspace(
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(workspace_service.get_workspace(db, ctx.tenant_id).model_dump(mode="json"))


@router.put("")
def put_workspace(
    req: WorkspaceConfig,
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    saved = workspace_service.replace_workspace(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(saved.model_dump(mode="json"))
