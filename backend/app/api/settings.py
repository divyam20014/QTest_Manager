from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.settings import TenantSettingsUpdateRequest
from app.services import settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def get_settings(
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(settings_service.get_settings(db, ctx.tenant_id).model_dump())


@router.patch("")
def update_settings(
    req: TenantSettingsUpdateRequest,
    ctx: SessionContext = Depends(require_permission("tenant.settings.manage")),
    db: Session = Depends(get_db),
) -> dict:
    updated = settings_service.update_settings(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(updated.model_dump())
