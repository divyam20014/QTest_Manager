from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    require_any_permission,
    require_permission,
)
from app.core.db import get_db
from app.core.idempotency import with_idempotency
from app.core.responses import envelope
from app.schemas.project import (
    ProjectCreateRequest,
    ProjectListResponse,
    ProjectMemberAddRequest,
    ProjectMemberRoleUpdateRequest,
    ProjectUpdateRequest,
)
from app.services import project_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(
    search: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    archived: bool = Query(default=False),
    sort: str = Query(default="name"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=project_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    projects, total = project_service.list_projects(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        search=search,
        domain=domain,
        status=status,
        priority=priority,
        archived=archived,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    metrics = project_service.metrics_for_projects(db, [p.id for p in projects])
    assigned = project_service.assigned_user_ids_many(db, [p.id for p in projects])
    items = [project_service.to_out(db, p, metrics[p.id], assigned[p.id]) for p in projects]
    return envelope(ProjectListResponse(items=items, total=total).model_dump(mode="json"))


@router.post("")
def create_project(
    req: ProjectCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ctx: SessionContext = Depends(require_permission("project.create")),
    db: Session = Depends(get_db),
) -> dict:
    project = with_idempotency(
        db,
        ctx.tenant_id,
        ctx.user_id,
        "project.create",
        idempotency_key,
        create=lambda: project_service.create_project(
            db, ctx.tenant_id, ctx.user_id, req, ctx.role_code
        ),
        get_by_id=lambda eid: project_service.get_project(
            db, ctx.tenant_id, ctx.role_code, ctx.user_id, eid
        ),
        entity_id_of=lambda p: p.id,
    )
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


@router.post("/{project_id}/archive")
def archive_project(
    project_id: UUID,
    ctx: SessionContext = Depends(require_permission("project.delete")),
    db: Session = Depends(get_db),
) -> dict:
    """ADR-140: the project becomes read-only and leaves the active list."""
    project = project_service.set_archived(
        db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id, True
    )
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))


@router.post("/{project_id}/restore")
def restore_project(
    project_id: UUID,
    ctx: SessionContext = Depends(require_permission("project.delete")),
    db: Session = Depends(get_db),
) -> dict:
    project = project_service.set_archived(
        db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id, False
    )
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))


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


@router.get("/{project_id}/members")
def list_members(
    project_id: UUID,
    ctx: SessionContext = Depends(
        require_any_permission("project.members.manage", "user.manage")
    ),
    db: Session = Depends(get_db),
) -> dict:
    members = project_service.list_members_with_roles(db, ctx.tenant_id, project_id)
    return envelope([m.model_dump(mode="json") for m in members])


@router.patch("/{project_id}/members/{user_id}/role")
def set_member_role(
    project_id: UUID,
    user_id: UUID,
    req: ProjectMemberRoleUpdateRequest,
    ctx: SessionContext = Depends(require_permission("project.members.manage")),
    db: Session = Depends(get_db),
) -> dict:
    project = project_service.set_member_role(
        db, ctx.tenant_id, ctx.user_id, ctx.role_code, project_id, user_id, req.role_id
    )
    return envelope(project_service.to_out(db, project).model_dump(mode="json"))
