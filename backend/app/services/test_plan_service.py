from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.models.defect import Defect
from app.models.execution import TestRun, TestRunCase
from app.models.project import Project
from app.models.test_asset import Release
from app.models.test_plan import TestPlan, TestPlanRun
from app.schemas.test_plan import (
    TestPlanCreateRequest,
    TestPlanOut,
    TestPlanRollup,
    TestPlanRunSetRequest,
    TestPlanUpdateRequest,
)
from app.services.project_service import is_assigned
from app.services.reporting_service import COMPLETED_RUN_CASE_STATUSES, OPEN_DEFECT_STATUSES


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


def _get_plan_or_404(db: Session, tenant_id: UUID, plan_id: UUID) -> TestPlan:
    plan = db.execute(
        select(TestPlan).where(TestPlan.tenant_id == tenant_id, TestPlan.id == plan_id)
    ).scalar_one_or_none()
    if plan is None:
        raise NotFoundError("Test plan not found")
    return plan


def _validate_run_ids(db: Session, tenant_id: UUID, project_id: UUID, run_ids: list[UUID]) -> None:
    found = set(
        db.execute(
            select(TestRun.id).where(
                TestRun.tenant_id == tenant_id, TestRun.project_id == project_id,
                TestRun.id.in_(run_ids),
            )
        ).scalars()
    )
    missing = set(run_ids) - found
    if missing:
        missing_str = ', '.join(str(m) for m in missing)
        raise ValidationAppError(f"Unknown test run id(s) for this project: {missing_str}")


def _to_out(db: Session, plan: TestPlan) -> TestPlanOut:
    run_ids = list(
        db.execute(
            select(TestPlanRun.test_run_id).where(TestPlanRun.test_plan_id == plan.id)
        ).scalars()
    )
    return TestPlanOut(
        id=plan.id, project_id=plan.project_id, release_id=plan.release_id, name=plan.name,
        description=plan.description, created_at=plan.created_at, test_run_ids=run_ids,
    )


def list_plans(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> list[TestPlanOut]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)
    rows = db.execute(
        select(TestPlan)
        .where(TestPlan.tenant_id == tenant_id, TestPlan.project_id == project_id)
        .order_by(TestPlan.name)
    ).scalars()
    return [_to_out(db, p) for p in rows]


def create_plan(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, project_id: UUID,
    req: TestPlanCreateRequest,
) -> TestPlanOut:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    if req.release_id is not None:
        release = db.execute(
            select(Release).where(
                Release.tenant_id == tenant_id, Release.id == req.release_id,
                Release.project_id == project_id,
            )
        ).scalar_one_or_none()
        if release is None:
            raise ValidationAppError("Release not found for this project")
    _validate_run_ids(db, tenant_id, project_id, req.test_run_ids)

    plan = TestPlan(
        tenant_id=tenant_id, project_id=project_id, release_id=req.release_id, name=req.name,
        description=req.description,
    )
    db.add(plan)
    db.flush()
    for run_id in req.test_run_ids:
        db.add(TestPlanRun(tenant_id=tenant_id, test_plan_id=plan.id, test_run_id=run_id))

    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_plan.created",
        entity_type="test_plan", entity_id=plan.id,
        metadata={"name": req.name, "run_count": len(req.test_run_ids)},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, plan)


def update_plan(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, plan_id: UUID,
    req: TestPlanUpdateRequest,
) -> TestPlanOut:
    plan = _get_plan_or_404(db, tenant_id, plan_id)
    project = _get_project_or_404(db, tenant_id, plan.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    if req.name is not None:
        plan.name = req.name
    if "description" in req.model_fields_set:
        plan.description = req.description
    if "release_id" in req.model_fields_set:
        plan.release_id = req.release_id

    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_plan.updated",
        entity_type="test_plan", entity_id=plan.id,
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, plan)


def set_plan_runs(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, plan_id: UUID,
    req: TestPlanRunSetRequest,
) -> TestPlanOut:
    plan = _get_plan_or_404(db, tenant_id, plan_id)
    project = _get_project_or_404(db, tenant_id, plan.project_id)
    _require_project_access(db, project, role_code, actor_user_id)
    _validate_run_ids(db, tenant_id, plan.project_id, req.test_run_ids)

    db.query(TestPlanRun).filter(TestPlanRun.test_plan_id == plan.id).delete()
    for run_id in req.test_run_ids:
        db.add(TestPlanRun(tenant_id=tenant_id, test_plan_id=plan.id, test_run_id=run_id))

    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_plan.runs_set",
        entity_type="test_plan", entity_id=plan.id, metadata={"run_count": len(req.test_run_ids)},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, plan)


def delete_plan(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, plan_id: UUID
) -> None:
    plan = _get_plan_or_404(db, tenant_id, plan_id)
    project = _get_project_or_404(db, tenant_id, plan.project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    db.query(TestPlanRun).filter(TestPlanRun.test_plan_id == plan.id).delete()
    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_plan.deleted",
        entity_type="test_plan", entity_id=plan.id,
    )
    db.delete(plan)
    db.commit()


def get_plan_rollup(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, plan_id: UUID
) -> TestPlanRollup:
    """Adapted from Tier 3's release-readiness metrics (reporting_service.
    get_release_readiness), but scoped to exactly this plan's child runs
    rather than a whole project -- a plan may cover only some of a
    project's runs, so a project-wide computation would misrepresent it."""
    plan = _get_plan_or_404(db, tenant_id, plan_id)
    project = _get_project_or_404(db, tenant_id, plan.project_id)
    _require_project_access(db, project, role_code, user_id)

    run_ids = list(
        db.execute(
            select(TestPlanRun.test_run_id).where(TestPlanRun.test_plan_id == plan.id)
        ).scalars()
    )
    if not run_ids:
        return TestPlanRollup(
            test_plan_id=plan.id, total_test_cases=0, execution_completion_percentage=0.0,
            pass_percentage=0.0, open_defects_by_severity={},
        )

    run_case_statuses = list(
        db.execute(
            select(TestRunCase.status).where(TestRunCase.test_run_id.in_(run_ids))
        ).scalars()
    )
    total = len(run_case_statuses)
    completed = sum(1 for s in run_case_statuses if s in COMPLETED_RUN_CASE_STATUSES)
    passed = sum(1 for s in run_case_statuses if s == "passed")
    completion_pct = round((completed / total) * 100, 1) if total else 0.0
    pass_pct = round((passed / completed) * 100, 1) if completed else 0.0

    open_defects = db.execute(
        select(Defect.severity, func.count())
        .where(
            Defect.tenant_id == tenant_id, Defect.test_run_id.in_(run_ids),
            Defect.status.in_(OPEN_DEFECT_STATUSES),
        )
        .group_by(Defect.severity)
    ).all()

    return TestPlanRollup(
        test_plan_id=plan.id,
        total_test_cases=total,
        execution_completion_percentage=completion_pct,
        pass_percentage=pass_pct,
        open_defects_by_severity={sev: count for sev, count in open_defects},
    )
