from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models.defect import Defect, DefectLink
from app.models.execution import ExecutionStep, TestRun, TestRunCase
from app.models.project import Project
from app.models.test_case import TestCase, TestCaseVersionStep
from app.schemas.defect import (
    DefectCreateRequest,
    DefectLinkCreateRequest,
    DefectLinkOut,
    DefectOut,
    DefectStatus,
    LinkableType,
    LinkType,
    Severity,
)
from app.services.project_service import is_assigned

# ADR-026: strictly sequential, no skipping, no reopening.
STATUS_ORDER: list[DefectStatus] = ["New", "Open", "Fixed", "Verified", "Closed"]


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _assigned_project_ids(db: Session, user_id: UUID) -> set[UUID]:
    from app.models.project import ProjectMember

    return set(
        db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        ).scalars()
    )


def create_defect(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, req: DefectCreateRequest
) -> Defect:
    test_case_id: UUID | None = req.test_case_id
    test_case_version_id: UUID | None = None
    test_run_id: UUID | None = None
    test_case_version_step_id: UUID | None = None
    title = req.title

    if req.execution_step_id is not None:
        step = db.execute(
            select(ExecutionStep).where(
                ExecutionStep.tenant_id == tenant_id, ExecutionStep.id == req.execution_step_id
            )
        ).scalar_one_or_none()
        if step is None:
            raise NotFoundError("Execution step not found")

        run_case = db.execute(
            select(TestRunCase).where(TestRunCase.id == step.test_run_case_id)
        ).scalar_one()
        run = db.execute(select(TestRun).where(TestRun.id == run_case.test_run_id)).scalar_one()
        version_step = db.execute(
            select(TestCaseVersionStep).where(
                TestCaseVersionStep.id == step.test_case_version_step_id
            )
        ).scalar_one()

        project_id = run.project_id
        test_case_id = run_case.test_case_id
        test_case_version_id = run_case.test_case_version_id
        test_run_id = run.id
        test_case_version_step_id = step.test_case_version_step_id

        if title is None:
            # FR-EXEC-003's auto-suggested title.
            title = f"Step {version_step.step_number} Failed: {version_step.action}"
    else:
        assert req.project_id is not None  # enforced by the schema validator
        project_id = req.project_id

    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    assert title is not None  # enforced by the schema validator for the standalone path

    defect = Defect(
        tenant_id=tenant_id,
        project_id=project_id,
        test_case_id=test_case_id,
        test_case_version_id=test_case_version_id,
        test_run_id=test_run_id,
        test_case_version_step_id=test_case_version_step_id,
        title=title,
        severity=req.severity,
        description=req.description,
        reported_by=actor_user_id,
    )
    db.add(defect)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.created",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"title": title, "severity": req.severity},
    )
    db.commit()
    return defect


def _get_defect_or_404(db: Session, tenant_id: UUID, defect_id: UUID) -> Defect:
    defect = db.execute(
        select(Defect).where(Defect.tenant_id == tenant_id, Defect.id == defect_id)
    ).scalar_one_or_none()
    if defect is None:
        raise NotFoundError("Defect not found")
    return defect


def get_defect(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, defect_id: UUID
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, user_id)
    return defect


def list_defects(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID | None,
    status: str | None,
    severity: str | None,
) -> list[Defect]:
    query = select(Defect).where(Defect.tenant_id == tenant_id)

    if project_id is not None:
        project = _get_project_or_404(db, tenant_id, project_id)
        _require_project_access(db, project, role_code, user_id)
        query = query.where(Defect.project_id == project_id)
    elif role_code == "tester":
        query = query.where(Defect.project_id.in_(_assigned_project_ids(db, user_id)))

    if status is not None:
        query = query.where(Defect.status == status)
    if severity is not None:
        query = query.where(Defect.severity == severity)

    return list(db.execute(query.order_by(Defect.created_at.desc())).scalars())


def update_status(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    new_status: str,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if new_status == "Closed" and role_code not in ("admin", "manager"):
        # BRD §3.2: "Update Defect Status to 'Closed': Tester No."
        raise ForbiddenError("Only Admin/Manager can close a defect")

    current_index = STATUS_ORDER.index(cast(DefectStatus, defect.status))
    try:
        target_index = STATUS_ORDER.index(cast(DefectStatus, new_status))
    except ValueError as exc:
        raise ValidationAppError(f"Unknown status: {new_status}") from exc

    if target_index != current_index + 1:
        raise ConflictError(
            f"Cannot transition from '{defect.status}' to '{new_status}'; "
            f"the only valid next status is '{STATUS_ORDER[current_index + 1]}'"
            if current_index + 1 < len(STATUS_ORDER)
            else f"'{defect.status}' is already the final status"
        )

    defect.status = new_status
    if new_status == "Closed":
        defect.closed_at = datetime.now(UTC)

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.status_changed",
        entity_type="defect",
        entity_id=defect.id,
        metadata={"from": STATUS_ORDER[current_index], "to": new_status},
    )
    db.commit()
    return defect


def add_link(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    defect_id: UUID,
    req: DefectLinkCreateRequest,
) -> Defect:
    defect = _get_defect_or_404(db, tenant_id, defect_id)
    project = _get_project_or_404(db, tenant_id, defect.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    link = DefectLink(
        tenant_id=tenant_id,
        defect_id=defect_id,
        linkable_type=req.linkable_type,
        linkable_id=req.linkable_id,
        link_type=req.link_type,
    )
    db.add(link)
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="defect.link_added",
        entity_type="defect",
        entity_id=defect.id,
        metadata={
            "linkable_type": req.linkable_type,
            "linkable_id": str(req.linkable_id),
            "link_type": req.link_type,
        },
    )
    db.commit()
    return defect


def to_out(db: Session, defect: Defect) -> DefectOut:
    # See ARCHITECTURE_DECISIONS.md ADR-007 addendum.
    set_tenant_context(db, str(defect.tenant_id))

    project = db.execute(select(Project).where(Project.id == defect.project_id)).scalar_one()

    test_case_title: str | None = None
    if defect.test_case_id is not None:
        test_case_title = db.execute(
            select(TestCase.title).where(TestCase.id == defect.test_case_id)
        ).scalar_one()

    test_run_name: str | None = None
    if defect.test_run_id is not None:
        test_run_name = db.execute(
            select(TestRun.name).where(TestRun.id == defect.test_run_id)
        ).scalar_one()

    step_number: int | None = None
    if defect.test_case_version_step_id is not None:
        step_number = db.execute(
            select(TestCaseVersionStep.step_number).where(
                TestCaseVersionStep.id == defect.test_case_version_step_id
            )
        ).scalar_one()

    links = db.execute(select(DefectLink).where(DefectLink.defect_id == defect.id)).scalars()

    return DefectOut(
        id=defect.id,
        project_id=defect.project_id,
        project_name=project.name,
        test_case_id=defect.test_case_id,
        test_case_title=test_case_title,
        test_case_version_id=defect.test_case_version_id,
        test_run_id=defect.test_run_id,
        test_run_name=test_run_name,
        test_case_version_step_id=defect.test_case_version_step_id,
        step_number=step_number,
        title=defect.title,
        severity=cast(Severity, defect.severity),
        status=cast(DefectStatus, defect.status),
        description=defect.description,
        reported_by=defect.reported_by,
        created_at=defect.created_at,
        closed_at=defect.closed_at,
        links=[
            DefectLinkOut(
                id=link_.id,
                linkable_type=cast(LinkableType, link_.linkable_type),
                linkable_id=link_.linkable_id,
                link_type=cast(LinkType, link_.link_type),
                created_at=link_.created_at,
            )
            for link_ in links
        ],
    )
