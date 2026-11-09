from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import SessionContext, get_current_context, require_permission
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.project import ProjectCreateRequest, ProjectMemberAddRequest, ProjectUpdateRequest
from app.services import project_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(
    ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> dict:
    projects = project_service.list_projects(db, ctx.tenant_id, ctx.role_code, ctx.user_id)
    return envelope([project_service.to_out(db, p).model_dump(mode="json") for p in projects])


@router.post("")
def create_project(
    req: ProjectCreateRequest,
    ctx: SessionContext = Depends(require_permission("project.create")),
    db: Session = Depends(get_db),
) -> dict:
    project = project_service.create_project(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))


@router.get("/{project_id}")
def get_project(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    project = project_service.get_project(db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id)
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))


@router.patch("/{project_id}")
def update_project(
    project_id: UUID,
    req: ProjectUpdateRequest,
    ctx: SessionContext = Depends(require_permission("project.edit")),
    db: Session = Depends(get_db),
) -> dict:
    project = project_service.update_project(
        db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id, req
    )
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))


@router.delete("/{project_id}")
def delete_project(
    project_id: UUID,
    ctx: SessionContext = Depends(require_permission("project.delete")),
    db: Session = Depends(get_db),
) -> dict:
    project_service.delete_project(db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id)
    return envelope({"deleted": True})


@router.post("/{project_id}/members")
def add_member(
    project_id: UUID,
    req: ProjectMemberAddRequest,
    ctx: SessionContext = Depends(require_permission("project.members.manage")),
    db: Session = Depends(get_db),
) -> dict:
    project = project_service.add_member(
        db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id, req.user_id
    )
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))


@router.delete("/{project_id}/members/{user_id}")
def remove_member(
    project_id: UUID,
    user_id: UUID,
    ctx: SessionContext = Depends(require_permission("project.members.manage")),
    db: Session = Depends(get_db),
) -> dict:
    project = project_service.remove_member(
        db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id, user_id
    )
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))
