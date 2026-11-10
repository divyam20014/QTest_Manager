from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.models.audit import AuditLog
from app.models.identity import User
from app.models.project import Project
from app.models.requirement import Requirement, RequirementTestCaseLink, RequirementVersion
from app.models.test_case import TestCase
from app.schemas.requirement import (
    LinkedTestCaseOut,
    RequirementCoverageEntry,
    RequirementCoverageReport,
    RequirementCreateRequest,
    RequirementDetailOut,
    RequirementHistoryEntryOut,
    RequirementOut,
    RequirementUpdateRequest,
    RequirementVersionOut,
)
from app.services.project_service import is_assigned

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _get_project_or_404(db: Session, tenant_id: UUID, project_id: UUID) -> Project:
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project not found")
    return project


def _require_project_access(db: Session, project: Project, role_code: str, user_id: UUID) -> None:
    """Same visibility rule as test cases (ADR-019): tenant-wide for
    Admin/Manager; Tester must be assigned to the project."""
    if role_code in ("admin", "manager"):
        return
    if is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _get_requirement_or_404(db: Session, tenant_id: UUID, requirement_id: UUID) -> Requirement:
    req = db.execute(
        select(Requirement).where(
            Requirement.tenant_id == tenant_id, Requirement.id == requirement_id
        )
    ).scalar_one_or_none()
    if req is None:
        raise NotFoundError("Requirement not found")
    return req


def _get_current_version(db: Session, req: Requirement) -> RequirementVersion:
    version = db.execute(
        select(RequirementVersion).where(RequirementVersion.id == req.current_version_id)
    ).scalar_one()
    return version


def _authorize_requirement_access(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, req: Requirement
) -> None:
    project = _get_project_or_404(db, tenant_id, req.project_id)
    _require_project_access(db, project, role_code, user_id)


def _linked_test_case_count(db: Session, requirement_id: UUID) -> int:
    return db.execute(
        select(func.count(RequirementTestCaseLink.id)).where(
            RequirementTestCaseLink.requirement_id == requirement_id
        )
    ).scalar_one()


def to_out(db: Session, req: Requirement) -> RequirementOut:
    # Mirrors test_case_service.to_out: re-assert tenant context in case the
    # caller invoked this right after a commit ended the prior transaction.
    set_tenant_context(db, str(req.tenant_id))
    version = _get_current_version(db, req)
    return RequirementOut(
        id=req.id,
        project_id=req.project_id,
        title=req.title,
        description=version.description,
        version_number=version.version_number,
        created_by=req.created_by,
        created_at=req.created_at,
        linked_test_case_count=_linked_test_case_count(db, req.id),
    )


def to_detail_out(db: Session, req: Requirement) -> RequirementDetailOut:
    base = to_out(db, req)
    links = db.execute(
        select(RequirementTestCaseLink, TestCase)
        .join(TestCase, TestCase.id == RequirementTestCaseLink.test_case_id)
        .where(RequirementTestCaseLink.requirement_id == req.id)
        .order_by(RequirementTestCaseLink.linked_at)
    ).all()
    linked = [
        LinkedTestCaseOut(
            test_case_id=case.id,
            test_case_title=case.title,
            test_case_status=case.status,
            linked_by=link.linked_by,
            linked_at=link.linked_at,
        )
        for link, case in links
    ]
    return RequirementDetailOut(**base.model_dump(), linked_test_cases=linked)


def list_requirements(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    project_id: UUID,
    page: int,
    page_size: int,
) -> tuple[list[Requirement], int]:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)

    base_query = select(Requirement).where(
        Requirement.tenant_id == tenant_id, Requirement.project_id == project_id
    )
    total = db.execute(select(func.count()).select_from(base_query.subquery())).scalar_one()
    rows = db.execute(
        base_query.order_by(Requirement.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars()
    return list(rows), total


def get_requirement(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, requirement_id: UUID
) -> Requirement:
    req = _get_requirement_or_404(db, tenant_id, requirement_id)
    _authorize_requirement_access(db, tenant_id, role_code, user_id, req)
    return req


def get_requirement_history(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, requirement_id: UUID
) -> list[RequirementHistoryEntryOut]:
    """Per-entity activity timeline (PV-9.3) -- see
    test_case_service.get_test_case_history / defect_service.get_defect_history
    for the shared pattern this mirrors."""
    req = get_requirement(db, tenant_id, role_code, user_id, requirement_id)
    set_tenant_context(db, str(tenant_id))

    rows = db.execute(
        select(AuditLog, User.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.entity_type == "requirement",
            AuditLog.entity_id == req.id,
        )
        .order_by(AuditLog.created_at.asc())
    ).all()
    return [
        RequirementHistoryEntryOut(
            id=log.id,
            action=log.action,
            user_id=log.user_id,
            user_name=user_name,
            event_metadata=log.event_metadata or {},
            created_at=log.created_at,
        )
        for log, user_name in rows
    ]


def list_versions(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, requirement_id: UUID
) -> list[RequirementVersionOut]:
    req = get_requirement(db, tenant_id, role_code, user_id, requirement_id)
    rows = db.execute(
        select(RequirementVersion)
        .where(RequirementVersion.requirement_id == req.id)
        .order_by(RequirementVersion.version_number.desc())
    ).scalars()
    return [
        RequirementVersionOut(
            version_number=v.version_number,
            title=v.title,
            description=v.description,
            created_by=v.created_by,
            created_at=v.created_at,
        )
        for v in rows
    ]


def create_requirement(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    project_id: UUID,
    req: RequirementCreateRequest,
) -> Requirement:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, actor_user_id)

    requirement = Requirement(
        tenant_id=tenant_id,
        project_id=project_id,
        title=req.title,
        created_by=actor_user_id,
    )
    db.add(requirement)
    db.flush()

    version = RequirementVersion(
        tenant_id=tenant_id,
        requirement_id=requirement.id,
        version_number=1,
        title=req.title,
        description=req.description,
        created_by=actor_user_id,
    )
    db.add(version)
    db.flush()
    requirement.current_version_id = version.id

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.created",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={"title": requirement.title, "project_id": str(project_id)},
    )
    db.commit()
    return requirement


def update_requirement(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    req: RequirementUpdateRequest,
) -> Requirement:
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)

    current_version = _get_current_version(db, requirement)
    new_title = req.title if req.title is not None else current_version.title
    new_description = (
        req.description if req.description is not None else current_version.description
    )

    next_number = current_version.version_number + 1
    version = RequirementVersion(
        tenant_id=tenant_id,
        requirement_id=requirement.id,
        version_number=next_number,
        title=new_title,
        description=new_description,
        created_by=actor_user_id,
    )
    db.add(version)
    db.flush()
    requirement.current_version_id = version.id
    if req.title is not None:
        requirement.title = req.title

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.updated",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={"version_number": next_number},
    )
    db.commit()
    return requirement


def delete_requirement(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, requirement_id: UUID
) -> None:
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)

    db.query(RequirementTestCaseLink).filter(
        RequirementTestCaseLink.requirement_id == requirement.id
    ).delete()
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.deleted",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={"title": requirement.title},
    )

    requirement.current_version_id = None
    db.flush()
    db.query(RequirementVersion).filter(
        RequirementVersion.requirement_id == requirement.id
    ).delete()
    db.delete(requirement)
    db.commit()


def link_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    test_case_id: UUID,
) -> Requirement:
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)

    case = db.execute(
        select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    ).scalar_one_or_none()
    if case is None:
        raise NotFoundError("Test case not found")
    if case.project_id != requirement.project_id:
        raise ConflictError("Test case belongs to a different project than the requirement")

    existing = db.execute(
        select(RequirementTestCaseLink).where(
            RequirementTestCaseLink.requirement_id == requirement_id,
            RequirementTestCaseLink.test_case_id == test_case_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return requirement

    db.add(
        RequirementTestCaseLink(
            tenant_id=tenant_id,
            requirement_id=requirement_id,
            test_case_id=test_case_id,
            linked_by=actor_user_id,
        )
    )
    db.flush()

    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=actor_user_id,
        action="requirement.linked",
        entity_type="requirement",
        entity_id=requirement.id,
        metadata={"test_case_id": str(test_case_id)},
    )
    db.commit()
    return requirement


def unlink_test_case(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    actor_user_id: UUID,
    requirement_id: UUID,
    test_case_id: UUID,
) -> Requirement:
    requirement = _get_requirement_or_404(db, tenant_id, requirement_id)
    _authorize_requirement_access(db, tenant_id, role_code, actor_user_id, requirement)

    deleted = (
        db.query(RequirementTestCaseLink)
        .filter(
            RequirementTestCaseLink.requirement_id == requirement_id,
            RequirementTestCaseLink.test_case_id == test_case_id,
        )
        .delete()
    )
    if deleted:
        record_audit_event(
            db,
            tenant_id=tenant_id,
            user_id=actor_user_id,
            action="requirement.unlinked",
            entity_type="requirement",
            entity_id=requirement.id,
            metadata={"test_case_id": str(test_case_id)},
        )
    db.commit()
    return requirement


def get_coverage_report(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, project_id: UUID
) -> RequirementCoverageReport:
    project = _get_project_or_404(db, tenant_id, project_id)
    _require_project_access(db, project, role_code, user_id)

    requirements = db.execute(
        select(Requirement)
        .where(Requirement.tenant_id == tenant_id, Requirement.project_id == project_id)
        .order_by(Requirement.created_at)
    ).scalars().all()

    entries = []
    covered_count = 0
    for r in requirements:
        count = _linked_test_case_count(db, r.id)
        covered = count > 0
        if covered:
            covered_count += 1
        entries.append(
            RequirementCoverageEntry(
                requirement_id=r.id,
                requirement_title=r.title,
                linked_test_case_count=count,
                covered=covered,
            )
        )

    total = len(requirements)
    percentage = round((covered_count / total) * 100, 1) if total else 0.0
    return RequirementCoverageReport(
        project_id=project_id,
        total_requirements=total,
        covered_requirements=covered_count,
        coverage_percentage=percentage,
        requirements=entries,
    )
