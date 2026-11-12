from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ForbiddenError, NotFoundError
from app.models.project import Project
from app.models.test_case import TestCase
from app.models.test_data_set import TestDataSet, TestDataSetRow
from app.schemas.test_data_set import (
    TestDataSetCreateRequest,
    TestDataSetOut,
    TestDataSetRowCreateRequest,
    TestDataSetRowOut,
)
from app.services.project_service import is_assigned


def _get_test_case_or_404(db: Session, tenant_id: UUID, test_case_id: UUID) -> TestCase:
    case = db.execute(
        select(TestCase).where(TestCase.tenant_id == tenant_id, TestCase.id == test_case_id)
    ).scalar_one_or_none()
    if case is None:
        raise NotFoundError("Test case not found")
    return case


def _require_project_access(
    db: Session, tenant_id: UUID, project_id: UUID, role_code: str, user_id: UUID
) -> None:
    if role_code in ("admin", "manager"):
        return
    project = db.execute(
        select(Project).where(Project.tenant_id == tenant_id, Project.id == project_id)
    ).scalar_one_or_none()
    if project is not None and is_assigned(db, project, user_id):
        return
    raise ForbiddenError("You are not assigned to this project")


def _get_data_set_or_404(db: Session, tenant_id: UUID, data_set_id: UUID) -> TestDataSet:
    ds = db.execute(
        select(TestDataSet).where(TestDataSet.tenant_id == tenant_id, TestDataSet.id == data_set_id)
    ).scalar_one_or_none()
    if ds is None:
        raise NotFoundError("Test data set not found")
    return ds


def _row_out(row: TestDataSetRow) -> TestDataSetRowOut:
    return TestDataSetRowOut(
        id=row.id, test_data_set_id=row.test_data_set_id, name=row.name, data=row.data,
        created_at=row.created_at,
    )


def _to_out(db: Session, ds: TestDataSet) -> TestDataSetOut:
    rows = db.execute(
        select(TestDataSetRow)
        .where(TestDataSetRow.test_data_set_id == ds.id)
        .order_by(TestDataSetRow.created_at)
    ).scalars()
    return TestDataSetOut(
        id=ds.id, test_case_id=ds.test_case_id, name=ds.name, created_at=ds.created_at,
        rows=[_row_out(r) for r in rows],
    )


def list_data_sets(
    db: Session, tenant_id: UUID, role_code: str, user_id: UUID, test_case_id: UUID
) -> list[TestDataSetOut]:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _require_project_access(db, tenant_id, case.project_id, role_code, user_id)
    rows = db.execute(
        select(TestDataSet)
        .where(TestDataSet.tenant_id == tenant_id, TestDataSet.test_case_id == test_case_id)
        .order_by(TestDataSet.name)
    ).scalars()
    return [_to_out(db, ds) for ds in rows]


def create_data_set(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, test_case_id: UUID,
    req: TestDataSetCreateRequest,
) -> TestDataSetOut:
    case = _get_test_case_or_404(db, tenant_id, test_case_id)
    _require_project_access(db, tenant_id, case.project_id, role_code, actor_user_id)

    ds = TestDataSet(tenant_id=tenant_id, test_case_id=test_case_id, name=req.name)
    db.add(ds)
    db.flush()
    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_data_set.created",
        entity_type="test_data_set", entity_id=ds.id, metadata={"name": req.name},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, ds)


def delete_data_set(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, data_set_id: UUID
) -> None:
    ds = _get_data_set_or_404(db, tenant_id, data_set_id)
    case = _get_test_case_or_404(db, tenant_id, ds.test_case_id)
    _require_project_access(db, tenant_id, case.project_id, role_code, actor_user_id)

    db.query(TestDataSetRow).filter(TestDataSetRow.test_data_set_id == ds.id).delete()
    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_data_set.deleted",
        entity_type="test_data_set", entity_id=ds.id,
    )
    db.delete(ds)
    db.commit()


def add_row(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, data_set_id: UUID,
    req: TestDataSetRowCreateRequest,
) -> TestDataSetOut:
    ds = _get_data_set_or_404(db, tenant_id, data_set_id)
    case = _get_test_case_or_404(db, tenant_id, ds.test_case_id)
    _require_project_access(db, tenant_id, case.project_id, role_code, actor_user_id)

    row = TestDataSetRow(
        tenant_id=tenant_id, test_data_set_id=ds.id, name=req.name, data=req.data,
    )
    db.add(row)
    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_data_set.row_added",
        entity_type="test_data_set", entity_id=ds.id, metadata={"row_name": req.name},
    )
    db.commit()
    set_tenant_context(db, str(tenant_id))
    return _to_out(db, ds)


def delete_row(
    db: Session, tenant_id: UUID, role_code: str, actor_user_id: UUID, row_id: UUID
) -> None:
    row = db.execute(
        select(TestDataSetRow).where(
            TestDataSetRow.tenant_id == tenant_id, TestDataSetRow.id == row_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("Data row not found")
    ds = _get_data_set_or_404(db, tenant_id, row.test_data_set_id)
    case = _get_test_case_or_404(db, tenant_id, ds.test_case_id)
    _require_project_access(db, tenant_id, case.project_id, role_code, actor_user_id)

    record_audit_event(
        db, tenant_id=tenant_id, user_id=actor_user_id, action="test_data_set.row_deleted",
        entity_type="test_data_set", entity_id=ds.id, metadata={"row_id": str(row_id)},
    )
    db.delete(row)
    db.commit()
