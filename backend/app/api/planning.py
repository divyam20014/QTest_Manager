"""Phase 2: planning a project's work."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import (
    SessionContext,
    get_current_context,
    require_permission,
    require_project_permission,
    require_resource_permission,
)
from app.core.db import get_db
from app.core.responses import envelope
from app.schemas.planning import (
    BacklogMoveRequest,
    MilestoneCreateRequest,
    MilestoneUpdateRequest,
    SprintCloseRequest,
    SprintCreateRequest,
    SprintUpdateRequest,
    TaskSprintRequest,
)
from app.schemas.task import TaskDependencyRequest
from app.services import (
    dependency_service,
    milestone_service,
    planning_service,
    sprint_service,
    task_service,
)

router = APIRouter(tags=["planning"])


@router.get("/projects/{project_id}/backlog")
def get_backlog(
    project_id: UUID,
    limit: int = Query(default=200, ge=1, le=planning_service.MAX_BACKLOG_PAGE),
    offset: int = Query(default=0, ge=0),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    result = planning_service.backlog(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, limit=limit, offset=offset
    )
    return envelope(result.model_dump(mode="json"))


@router.post("/tasks/{task_id}/rank")
def move_in_backlog(
    task_id: UUID,
    req: BacklogMoveRequest,
    ctx: SessionContext = Depends(require_resource_permission("task.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = planning_service.move_in_backlog(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, req.before_task_id
    )
    return envelope(task_service.to_out(db, task).model_dump(mode="json"))


@router.get("/projects/{project_id}/milestones")
def list_milestones(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    items = milestone_service.list_milestones(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id
    )
    return envelope([m.model_dump(mode="json") for m in items])


@router.post("/projects/{project_id}/milestones")
def create_milestone(
    project_id: UUID,
    req: MilestoneCreateRequest,
    ctx: SessionContext = Depends(require_project_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    made = milestone_service.create_milestone(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(made.model_dump(mode="json"))


@router.patch("/milestones/{milestone_id}")
def update_milestone(
    milestone_id: UUID,
    req: MilestoneUpdateRequest,
    ctx: SessionContext = Depends(require_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    changed = milestone_service.update_milestone(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, milestone_id, req
    )
    return envelope(changed.model_dump(mode="json"))


@router.delete("/milestones/{milestone_id}")
def delete_milestone(
    milestone_id: UUID,
    ctx: SessionContext = Depends(require_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    milestone_service.delete_milestone(db, ctx.tenant_id, ctx.role_code, ctx.user_id, milestone_id)
    return envelope({"deleted": True})


@router.get("/projects/{project_id}/sprints")
def list_sprints(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    items = sprint_service.list_sprints(db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id)
    return envelope([s.model_dump(mode="json") for s in items])


@router.post("/projects/{project_id}/sprints")
def create_sprint(
    project_id: UUID,
    req: SprintCreateRequest,
    ctx: SessionContext = Depends(require_project_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    made = sprint_service.create_sprint(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req
    )
    return envelope(made.model_dump(mode="json"))


@router.get("/sprints/{sprint_id}")
def get_sprint(
    sprint_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    found = sprint_service.get_sprint(db, ctx.tenant_id, ctx.role_code, ctx.user_id, sprint_id)
    return envelope(found.model_dump(mode="json"))


@router.patch("/sprints/{sprint_id}")
def update_sprint(
    sprint_id: UUID,
    req: SprintUpdateRequest,
    ctx: SessionContext = Depends(require_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    changed = sprint_service.update_sprint(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, sprint_id, req
    )
    return envelope(changed.model_dump(mode="json"))


@router.delete("/sprints/{sprint_id}")
def delete_sprint(
    sprint_id: UUID,
    ctx: SessionContext = Depends(require_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    sprint_service.delete_sprint(db, ctx.tenant_id, ctx.role_code, ctx.user_id, sprint_id)
    return envelope({"deleted": True})


@router.post("/sprints/{sprint_id}/start")
def start_sprint(
    sprint_id: UUID,
    ctx: SessionContext = Depends(require_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    started = sprint_service.start_sprint(db, ctx.tenant_id, ctx.role_code, ctx.user_id, sprint_id)
    return envelope(started.model_dump(mode="json"))


@router.post("/sprints/{sprint_id}/close")
def close_sprint(
    sprint_id: UUID,
    req: SprintCloseRequest,
    ctx: SessionContext = Depends(require_permission("planning.manage")),
    db: Session = Depends(get_db),
) -> dict:
    closed = sprint_service.close_sprint(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, sprint_id, req.move_unfinished_to
    )
    return envelope(closed.model_dump(mode="json"))


@router.put("/tasks/{task_id}/sprint")
def set_task_sprint(
    task_id: UUID,
    req: TaskSprintRequest,
    ctx: SessionContext = Depends(require_resource_permission("planning.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = sprint_service.set_task_sprint(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, req.sprint_id
    )
    return envelope(task_service.to_out(db, task).model_dump(mode="json"))


@router.post("/tasks/{task_id}/dependencies")
def add_dependency(
    task_id: UUID,
    req: TaskDependencyRequest,
    ctx: SessionContext = Depends(require_resource_permission("task.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = dependency_service.add_dependency(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, req.depends_on_task_id
    )
    return envelope(task_service.to_detail_out(db, task).model_dump(mode="json"))


@router.delete("/tasks/{task_id}/dependencies/{depends_on_task_id}")
def remove_dependency(
    task_id: UUID,
    depends_on_task_id: UUID,
    ctx: SessionContext = Depends(require_resource_permission("task.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = dependency_service.remove_dependency(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, depends_on_task_id
    )
    return envelope(task_service.to_detail_out(db, task).model_dump(mode="json"))
