"""ADR-127: tenant-configurable task statuses.

``code``, ``label``, ``color`` and order are the tenant's to change. ``category`` (todo /
in_progress / done) is the fixed meaning the rest of the code relies on, so these rules hold:

* exactly one default status per tenant, and it is a ``todo`` status (a new task is not done);
* at least one ``todo`` and one ``done`` status always exist;
* a status that tasks use (live or soft-deleted) cannot be deleted or change category.
"""

from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.field_standards import DEFAULT_TASK_STATUS_CODE, TASK_STATUS_DEFAULTS
from app.models.task import Task, TaskStatus
from app.schemas.task import (
    TaskStatusCreateRequest,
    TaskStatusOut,
    TaskStatusRef,
    TaskStatusUpdateRequest,
)


def seed_defaults_for_tenant(db: Session, tenant_id: UUID) -> None:
    """Called once at tenant creation (platform_service.create_tenant_with_admin); the
    migration seeds the same three rows for tenants that already exist."""
    for order, (code, label, category, color) in enumerate(TASK_STATUS_DEFAULTS):
        db.add(
            TaskStatus(
                tenant_id=tenant_id,
                code=code,
                label=label,
                category=category,
                color=color,
                sort_order=order,
                is_default=code == DEFAULT_TASK_STATUS_CODE,
            )
        )
    db.flush()


def to_ref(status: TaskStatus) -> TaskStatusRef:
    return TaskStatusRef(
        id=status.id,
        code=status.code,
        label=status.label,
        category=status.category,  # type: ignore[arg-type]
        color=status.color,
    )


def _usage_counts(db: Session, tenant_id: UUID) -> dict[UUID, int]:
    """Tasks per status, soft-deleted ones included (the foreign key still points at them)."""
    rows = db.execute(
        select(Task.status_id, func.count(Task.id))
        .where(Task.tenant_id == tenant_id)
        .group_by(Task.status_id)
        .execution_options(include_deleted=True)
    ).all()
    return {status_id: count for status_id, count in rows}


def _to_out(status: TaskStatus, usage: dict[UUID, int]) -> TaskStatusOut:
    return TaskStatusOut(
        id=status.id,
        code=status.code,
        label=status.label,
        category=status.category,  # type: ignore[arg-type]
        color=status.color,
        sort_order=status.sort_order,
        is_default=status.is_default,
        task_count=usage.get(status.id, 0),
    )


def list_statuses(db: Session, tenant_id: UUID) -> list[TaskStatusOut]:
    rows = db.execute(
        select(TaskStatus)
        .where(TaskStatus.tenant_id == tenant_id)
        .order_by(TaskStatus.sort_order, TaskStatus.label)
    ).scalars()
    usage = _usage_counts(db, tenant_id)
    return [_to_out(s, usage) for s in rows]


def get_status_or_404(db: Session, tenant_id: UUID, status_id: UUID) -> TaskStatus:
    status = db.execute(
        select(TaskStatus).where(TaskStatus.tenant_id == tenant_id, TaskStatus.id == status_id)
    ).scalar_one_or_none()
    if status is None:
        raise NotFoundError("Task status not found")
    return status


def get_default_status(db: Session, tenant_id: UUID) -> TaskStatus:
    status = db.execute(
        select(TaskStatus).where(TaskStatus.tenant_id == tenant_id, TaskStatus.is_default)
    ).scalar_one_or_none()
    if status is None:  # a tenant created before the seed ran; never expected after migration
        raise ConflictError("No default task status is configured for this tenant")
    return status


def _clear_default(db: Session, tenant_id: UUID, except_id: UUID | None) -> None:
    stmt = update(TaskStatus).where(TaskStatus.tenant_id == tenant_id, TaskStatus.is_default)
    if except_id is not None:
        stmt = stmt.where(TaskStatus.id != except_id)
    db.execute(stmt.values(is_default=False))
    db.flush()


def _require_both_ends(db: Session, tenant_id: UUID) -> None:
    categories = set(
        db.execute(select(TaskStatus.category).where(TaskStatus.tenant_id == tenant_id)).scalars()
    )
    missing = {"todo", "done"} - categories
    if missing:
        db.rollback()
        raise ConflictError(
            "At least one 'todo' and one 'done' status must remain "
            f"(missing: {', '.join(sorted(missing))})"
        )


def create_status(
    db: Session, tenant_id: UUID, actor_user_id: UUID, req: TaskStatusCreateRequest
) -> TaskStatusOut:
    if (
        db.execute(
            select(TaskStatus.id).where(
                TaskStatus.tenant_id == tenant_id, TaskStatus.code == req.code
            )
        ).scalar_one_or_none()
        is not None
    ):
        raise ConflictError(f"A task status with code '{req.code}' already exists")
    if req.is_default and req.category != "todo":
        raise ValidationAppError(
            "The default status must be a 'todo' status", {"is_default": "Default must be 'todo'"}
        )
    sort_order = req.sort_order
    if sort_order is None:
        sort_order = (
            db.execute(
                select(func.coalesce(func.max(TaskStatus.sort_order), -1)).where(
                    TaskStatus.tenant_id == tenant_id
                )
            ).scalar_one()
            + 1
        )
    if req.is_default:
        _clear_default(db, tenant_id, None)
    status = TaskStatus(
        tenant_id=tenant_id,
        code=req.code,
        label=req.label,
        category=req.category,
        color=req.color,
        sort_order=sort_order,
        is_default=req.is_default,
    )
    db.add(status)
    db.flush()
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task_status.created",
        entity_type="task_status",
        entity_id=status.id,
        metadata={"code": status.code, "label": status.label, "category": status.category},
    )
    db.commit()
    return _to_out(status, {})


def update_status(
    db: Session,
    tenant_id: UUID,
    actor_user_id: UUID,
    status_id: UUID,
    req: TaskStatusUpdateRequest,
) -> TaskStatusOut:
    status = get_status_or_404(db, tenant_id, status_id)
    changes = req.model_dump(exclude_unset=True)
    usage = _usage_counts(db, tenant_id)
    in_use = usage.get(status.id, 0) > 0
    before = {
        "label": status.label,
        "category": status.category,
        "color": status.color,
        "sort_order": status.sort_order,
        "is_default": status.is_default,
    }

    if "category" in changes and changes["category"] is not None:
        if changes["category"] != status.category and in_use:
            raise ConflictError(
                f"{usage[status.id]} task(s) use this status, so its category cannot change"
            )
        status.category = changes["category"]
    if "label" in changes and changes["label"] is not None:
        status.label = changes["label"]
    if "color" in changes:
        status.color = changes["color"]
    if "sort_order" in changes and changes["sort_order"] is not None:
        status.sort_order = changes["sort_order"]
    if "is_default" in changes and changes["is_default"] is not None:
        if changes["is_default"]:
            if status.category != "todo":
                raise ValidationAppError(
                    "The default status must be a 'todo' status",
                    {"is_default": "Default must be 'todo'"},
                )
            _clear_default(db, tenant_id, status.id)
            status.is_default = True
        elif status.is_default:
            raise ConflictError("Make another status the default instead of unsetting this one")
    if status.is_default and status.category != "todo":
        raise ConflictError("The default status must stay a 'todo' status")
    db.flush()
    _require_both_ends(db, tenant_id)

    after = {
        "label": status.label,
        "category": status.category,
        "color": status.color,
        "sort_order": status.sort_order,
        "is_default": status.is_default,
    }
    changed = {k: {"from": before[k], "to": after[k]} for k in after if before[k] != after[k]}
    if changed:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="task_status.updated",
            entity_type="task_status",
            entity_id=status.id,
            metadata={"code": status.code, "changes": changed},
        )
    db.commit()
    return _to_out(status, usage)


def delete_status(db: Session, tenant_id: UUID, actor_user_id: UUID, status_id: UUID) -> None:
    status = get_status_or_404(db, tenant_id, status_id)
    if status.is_default:
        raise ConflictError("The default status cannot be deleted; make another one the default")
    used = _usage_counts(db, tenant_id).get(status.id, 0)
    if used:
        raise ConflictError(f"{used} task(s) use this status; move them to another status first")
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="task_status.deleted",
        entity_type="task_status",
        entity_id=status.id,
        metadata={"code": status.code, "label": status.label, "category": status.category},
    )
    db.delete(status)
    db.flush()
    _require_both_ends(db, tenant_id)
    db.commit()
