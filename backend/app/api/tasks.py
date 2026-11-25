"""ADR-127: tasks, sub-tasks and tenant task statuses."""

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
from app.schemas.task import (
    TaskCreateRequest,
    TaskLinkTestCaseRequest,
    TaskStatusChangeRequest,
    TaskStatusCreateRequest,
    TaskStatusUpdateRequest,
    TaskUpdateRequest,
)
from app.services import task_rollup_service, task_service, task_status_service

router = APIRouter(tags=["tasks"])


# --- statuses (tenant configuration) --------------------------------------------------------


@router.get("/task-statuses")
def list_task_statuses(
    ctx: SessionContext = Depends(get_current_context), db: Session = Depends(get_db)
) -> dict:
    items = task_status_service.list_statuses(db, ctx.tenant_id)
    return envelope([s.model_dump(mode="json") for s in items])


@router.post("/task-statuses")
def create_task_status(
    req: TaskStatusCreateRequest,
    ctx: SessionContext = Depends(require_permission("task_status.manage")),
    db: Session = Depends(get_db),
) -> dict:
    out = task_status_service.create_status(db, ctx.tenant_id, ctx.user_id, req)
    return envelope(out.model_dump(mode="json"))


@router.patch("/task-statuses/{status_id}")
def update_task_status(
    status_id: UUID,
    req: TaskStatusUpdateRequest,
    ctx: SessionContext = Depends(require_permission("task_status.manage")),
    db: Session = Depends(get_db),
) -> dict:
    out = task_status_service.update_status(db, ctx.tenant_id, ctx.user_id, status_id, req)
    return envelope(out.model_dump(mode="json"))


@router.delete("/task-statuses/{status_id}")
def delete_task_status(
    status_id: UUID,
    ctx: SessionContext = Depends(require_permission("task_status.manage")),
    db: Session = Depends(get_db),
) -> dict:
    task_status_service.delete_status(db, ctx.tenant_id, ctx.user_id, status_id)
    return envelope({"deleted": True})


# --- tasks ----------------------------------------------------------------------------------


@router.get("/projects/{project_id}/tasks")
def list_tasks(
    project_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=task_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    status_id: UUID | None = None,
    category: str | None = Query(default=None, pattern="^(todo|in_progress|done)$"),
    assignee_id: UUID | None = None,
    parent_task_id: UUID | None = None,
    root_only: bool = False,
    release_id: UUID | None = None,
    overdue: bool = False,
    q: str | None = Query(default=None, max_length=100),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    out = task_service.list_tasks(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        project_id,
        page=page,
        page_size=page_size,
        status_id=status_id,
        category=category,
        assignee_id=assignee_id,
        parent_task_id=parent_task_id,
        root_only=root_only,
        release_id=release_id,
        overdue=overdue,
        q=q,
    )
    return envelope(out.model_dump(mode="json"))


@router.get("/projects/{project_id}/tasks/summary")
def project_task_summary(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    out = task_service.project_summary(db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id)
    return envelope(out.model_dump(mode="json"))


@router.get("/projects/{project_id}/tasks/tree")
def project_task_tree(
    project_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    out = task_service.list_project_tree(db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id)
    return envelope(out.model_dump(mode="json"))


@router.post("/projects/{project_id}/tasks")
def create_task(
    project_id: UUID,
    req: TaskCreateRequest,
    ctx: SessionContext = Depends(require_project_permission("task.manage")),
    db: Session = Depends(get_db),
) -> dict:
    task = task_service.create_task(db, ctx.tenant_id, ctx.role_code, ctx.user_id, project_id, req)
    return envelope(task_service.to_out(db, task).model_dump(mode="json"))


@router.get("/tasks/{task_id}")
def get_task(
    task_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    task = task_service.get_task(db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id)
    return envelope(task_service.to_detail_out(db, task).model_dump(mode="json"))


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: UUID,
    req: TaskUpdateRequest,
    ctx: SessionContext = Depends(require_resource_permission("task.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = task_service.update_task(db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, req)
    return envelope(task_service.to_out(db, task).model_dump(mode="json"))


@router.post("/tasks/{task_id}/status")
def change_task_status(
    task_id: UUID,
    req: TaskStatusChangeRequest,
    ctx: SessionContext = Depends(require_resource_permission("task.transition", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = task_service.change_status(
        db,
        ctx.tenant_id,
        ctx.role_code,
        ctx.user_id,
        task_id,
        req.status_id,
        permissions=ctx.permissions,
    )
    return envelope(task_service.to_out(db, task).model_dump(mode="json"))


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: UUID,
    cascade: bool = Query(default=False, description="Also delete every sub-task."),
    ctx: SessionContext = Depends(require_resource_permission("task.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    removed = task_service.delete_task(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, cascade=cascade
    )
    return envelope({"deleted": removed})


@router.get("/tasks/{task_id}/rollup")
def task_rollup(
    task_id: UUID,
    include_sub_tasks: bool = Query(default=True),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    out = task_rollup_service.get_rollup(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, include_sub_tasks=include_sub_tasks
    )
    return envelope(out.model_dump(mode="json"))


@router.get("/tasks/{task_id}/history")
def task_history(
    task_id: UUID,
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    rows = task_service.get_task_history(db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id)
    return envelope([r.model_dump(mode="json") for r in rows])


@router.get("/tasks/{task_id}/test-cases")
def task_effective_test_cases(
    task_id: UUID,
    include_sub_tasks: bool = Query(default=True),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    rows = task_rollup_service.list_effective_test_cases(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, include_sub_tasks=include_sub_tasks
    )
    return envelope([r.model_dump(mode="json") for r in rows])


@router.get("/tasks/{task_id}/test-runs")
def task_test_runs(
    task_id: UUID,
    include_sub_tasks: bool = Query(default=True),
    ctx: SessionContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> dict:
    rows = task_rollup_service.list_task_runs(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, include_sub_tasks=include_sub_tasks
    )
    return envelope([r.model_dump(mode="json") for r in rows])


@router.post("/tasks/{task_id}/test-cases")
def link_test_case(
    task_id: UUID,
    req: TaskLinkTestCaseRequest,
    ctx: SessionContext = Depends(require_resource_permission("task.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = task_service.link_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, req.test_case_id
    )
    return envelope(task_service.to_detail_out(db, task).model_dump(mode="json"))


@router.delete("/tasks/{task_id}/test-cases/{test_case_id}")
def unlink_test_case(
    task_id: UUID,
    test_case_id: UUID,
    ctx: SessionContext = Depends(require_resource_permission("task.manage", "task")),
    db: Session = Depends(get_db),
) -> dict:
    task = task_service.unlink_test_case(
        db, ctx.tenant_id, ctx.role_code, ctx.user_id, task_id, test_case_id
    )
    return envelope(task_service.to_detail_out(db, task).model_dump(mode="json"))
