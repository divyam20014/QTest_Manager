from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.defect import Defect
from app.models.project import Project
from app.models.requirement import Requirement
from app.models.test_case import TestCase
from app.schemas.search import SearchResponse, SearchResultEntry
from app.services.reporting_service import _accessible_project_ids

MAX_RESULTS_PER_TYPE = 10


def search(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, query: str
) -> SearchResponse:
    """Simple ILIKE search across test cases, defects, and requirements by
    title, scoped to projects the caller can see (ADR-019/027's existing
    Tester-restricted-to-assigned-projects rule) -- no dedicated search
    engine, just a straightforward query per entity type."""
    accessible = _accessible_project_ids(db, tenant_id, role_code, user_id)
    pattern = f"%{query}%"

    def _project_filter(project_id_col):
        if accessible is not None:
            return project_id_col.in_(accessible)
        return project_id_col.is_not(None)

    results: list[SearchResultEntry] = []

    tc_rows = db.execute(
        select(TestCase.id, TestCase.title, TestCase.project_id, Project.name)
        .join(Project, Project.id == TestCase.project_id)
        .where(
            TestCase.tenant_id == tenant_id,
            TestCase.title.ilike(pattern),
            _project_filter(TestCase.project_id),
        )
        .limit(MAX_RESULTS_PER_TYPE)
    ).all()
    results += [
        SearchResultEntry(type="test_case", id=tid, title=title, project_id=pid, project_name=pname)
        for tid, title, pid, pname in tc_rows
    ]

    defect_rows = db.execute(
        select(Defect.id, Defect.title, Defect.project_id, Project.name)
        .join(Project, Project.id == Defect.project_id)
        .where(
            Defect.tenant_id == tenant_id,
            Defect.title.ilike(pattern),
            _project_filter(Defect.project_id),
        )
        .limit(MAX_RESULTS_PER_TYPE)
    ).all()
    results += [
        SearchResultEntry(type="defect", id=did, title=title, project_id=pid, project_name=pname)
        for did, title, pid, pname in defect_rows
    ]

    req_rows = db.execute(
        select(Requirement.id, Requirement.title, Requirement.project_id, Project.name)
        .join(Project, Project.id == Requirement.project_id)
        .where(
            Requirement.tenant_id == tenant_id,
            Requirement.title.ilike(pattern),
            _project_filter(Requirement.project_id),
        )
        .limit(MAX_RESULTS_PER_TYPE)
    ).all()
    results += [
        SearchResultEntry(
            type="requirement", id=rid, title=title, project_id=pid, project_name=pname
        )
        for rid, title, pid, pname in req_rows
    ]

    return SearchResponse(query=query, results=results)
