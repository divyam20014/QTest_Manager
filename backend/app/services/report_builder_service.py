"""ADR-098: saved report builder.

Definitions are validated structured JSON (app.schemas.report_builder). This
module maps allowlisted field names to SQLAlchemy expressions; no definition
content is ever turned into SQL text. Every query is scoped by tenant RLS plus
the same project / Tester-visibility rules the Reports endpoints use, and runs
under a per-query statement timeout.
"""

import csv
import io
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, String, case, cast, func, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, aliased

from app.core.audit import record_audit_event
from app.core.db import set_tenant_context
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.xlsx_report import SheetSpec, build_workbook, safe_cell
from app.models.defect import Defect
from app.models.execution import TestRun, TestRunCase
from app.models.identity import User
from app.models.project import Project
from app.models.saved_report import SavedReport
from app.models.test_asset import Release
from app.models.test_case import TestCase
from app.models.test_module import TestModule
from app.schemas.report_builder import (
    MAX_EXPORT_ROWS,
    MAX_PAGE_SIZE,
    MAX_REPORTS_PER_USER,
    SOURCES,
    STATEMENT_TIMEOUT_MS,
    DefinitionIn,
    FieldSpec,
    FilterIn,
    SavedReportCreate,
    SavedReportUpdate,
)
from app.services import tester_visibility
from app.services.reporting_service import _accessible_project_ids

ERASED_NAME = "Erased user"


def _person(alias: Any):
    """User display name; an erased (pseudonymised) user is always masked."""
    return case((alias.pseudonymized_at.is_not(None), ERASED_NAME), else_=alias.name)


def _build_source(source: str) -> tuple[Any, Select, dict[str, Any], Any, Any]:
    """Returns (entity, joined select_from, field -> expression, project_col, tenant_col)."""
    if source == "test_cases":
        assignee = aliased(User)
        exprs = {
            "id": cast(TestCase.id, String()),
            "title": TestCase.title,
            "priority": TestCase.priority,
            "status": TestCase.status,
            "module": TestModule.name,
            "assignee": _person(assignee),
            "quarantined": TestCase.quarantined,
            "created_at": TestCase.created_at,
            "project": Project.name,
        }
        base = (
            select(TestCase.id)
            .select_from(TestCase)
            .join(Project, Project.id == TestCase.project_id)
            .outerjoin(TestModule, TestModule.id == TestCase.module_id)
            .outerjoin(assignee, assignee.id == TestCase.assignee_id)
        )
        return TestCase, base, exprs, TestCase.project_id, TestCase.tenant_id
    if source == "test_runs":
        executor = aliased(User)

        def _count(*extra: Any) -> Any:
            return (
                select(func.count())
                .select_from(TestRunCase)
                .where(TestRunCase.test_run_id == TestRun.id, *extra)
                .scalar_subquery()
            )

        exprs = {
            "id": cast(TestRun.id, String()),
            "name": TestRun.name,
            "run_type": TestRun.run_type,
            "status": case((TestRun.finished_at.is_(None), "open"), else_="finished"),
            "executor": _person(executor),
            "created_at": TestRun.created_at,
            "finished_at": TestRun.finished_at,
            "project": Project.name,
            "total_cases": _count(),
            "passed_cases": _count(TestRunCase.status == "passed"),
            "failed_cases": _count(TestRunCase.status == "failed"),
        }
        base = (
            select(TestRun.id)
            .select_from(TestRun)
            .join(Project, Project.id == TestRun.project_id)
            .outerjoin(executor, executor.id == TestRun.executed_by)
            .where(TestRun.deleted_at.is_(None))
        )
        return TestRun, base, exprs, TestRun.project_id, TestRun.tenant_id
    reporter = aliased(User)
    assignee = aliased(User)
    exprs = {
        "id": cast(Defect.id, String()),
        "title": Defect.title,
        "severity": Defect.severity,
        "status": Defect.status,
        "priority": Defect.priority,
        "environment": Defect.environment,
        "reporter": _person(reporter),
        "assignee": _person(assignee),
        "created_at": Defect.created_at,
        "project": Project.name,
        "release": Release.name,
    }
    base = (
        select(Defect.id)
        .select_from(Defect)
        .join(Project, Project.id == Defect.project_id)
        .outerjoin(reporter, reporter.id == Defect.reported_by)
        .outerjoin(assignee, assignee.id == Defect.assigned_to)
        .outerjoin(Release, Release.id == Defect.fixed_in_release_id)
        .where(Defect.deleted_at.is_(None))
    )
    return Defect, base, exprs, Defect.project_id, Defect.tenant_id


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _parse(spec: FieldSpec, v: Any) -> Any:
    if spec.type == "date":
        return datetime.fromisoformat(v)
    return v


def _predicate(expr: Any, spec: FieldSpec, flt: FilterIn) -> Any:
    op = flt.op
    if op == "is_null":
        return expr.is_(None)
    if op == "in":
        assert isinstance(flt.value, list)
        return expr.in_([_parse(spec, v) for v in flt.value])
    value = _parse(spec, flt.value)
    if op == "eq":
        return expr == value
    if op == "neq":
        return expr != value
    if op == "contains":
        return expr.ilike(f"%{_escape_like(str(value))}%", escape="\\")
    if op == "gt":
        return expr > value
    if op == "gte":
        return expr >= value
    if op == "lt":
        return expr < value
    return expr <= value


def _scoped_base(
    db: Session, ctx_tenant: UUID, role_code: str, user_id: UUID, definition: DefinitionIn
) -> tuple[Any, Select, dict[str, Any]]:
    entity, base, exprs, project_col, tenant_col = _build_source(definition.source)
    specs = SOURCES[definition.source]
    base = base.where(tenant_col == ctx_tenant)
    accessible = _accessible_project_ids(db, ctx_tenant, role_code, user_id)
    if accessible is not None:
        base = base.where(project_col.in_(accessible))
    if definition.source == "test_cases":
        base = tester_visibility.scope_case_query(db, ctx_tenant, role_code, user_id, base)
    for flt in definition.filters:
        base = base.where(_predicate(exprs[flt.field], specs[flt.field], flt))
    return entity, base, exprs


def _jsonable(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    return v


def columns_for(definition: DefinitionIn) -> list[dict[str, str]]:
    specs = SOURCES[definition.source]
    if definition.group_by:
        cols = [
            {"key": f, "label": specs[f].label, "type": specs[f].type} for f in definition.group_by
        ]
        cols.append({"key": "count", "label": "Count", "type": "number"})
        return cols
    return [{"key": f, "label": specs[f].label, "type": specs[f].type} for f in definition.fields]


def run_definition(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    definition: DefinitionIn,
    *,
    page: int,
    page_size: int,
    limit_override: int | None = None,
) -> dict[str, Any]:
    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
    set_tenant_context(db, str(tenant_id))
    try:
        db.execute(
            text("SELECT set_config('statement_timeout', :ms, true)"),
            {"ms": str(STATEMENT_TIMEOUT_MS)},
        )
        entity, base, exprs = _scoped_base(db, tenant_id, role_code, user_id, definition)
        if definition.group_by:
            gcols = [exprs[f].label(f) for f in definition.group_by]
            count_col = func.count().label("count")
            grouped = base.with_only_columns(*gcols, count_col).group_by(
                *[exprs[f] for f in definition.group_by]
            )
            total = db.execute(
                select(func.count()).select_from(grouped.order_by(None).subquery())
            ).scalar_one()
            if definition.sort is not None:
                key = definition.sort.field
                target = count_col if key == "count" else exprs[key]
                first = target.desc() if definition.sort.dir == "desc" else target.asc()
                order = [first]
            else:
                order = [count_col.desc()]
            order += [exprs[f] for f in definition.group_by]
            stmt = grouped.order_by(*order)
            keys = [*definition.group_by, "count"]
        else:
            cols = [exprs[f].label(f) for f in definition.fields]
            total = db.execute(base.with_only_columns(func.count())).scalar_one()
            stmt = base.with_only_columns(*cols)
            if definition.sort is not None:
                target = exprs[definition.sort.field]
                order = [target.desc() if definition.sort.dir == "desc" else target.asc()]
            elif "created_at" in exprs:
                order = [exprs["created_at"].desc()]
            else:
                order = []
            stmt = stmt.order_by(*order, entity.id)
            keys = list(definition.fields)
        if limit_override is not None:
            stmt = stmt.limit(limit_override)
        else:
            stmt = stmt.limit(page_size).offset((page - 1) * page_size)
        rows = [{k: _jsonable(getattr(r, k)) for k in keys} for r in db.execute(stmt).all()]
    except OperationalError as exc:
        db.rollback()
        if "statement timeout" in str(exc).lower() or "canceling statement" in str(exc).lower():
            raise ValidationAppError(
                "The report took too long to run. Add filters to narrow it."
            ) from None
        raise
    return {
        "columns": columns_for(definition),
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ---- saved reports -------------------------------------------------------


def _owner_names(db: Session, user_ids: set[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(User.id, User.name, User.pseudonymized_at).where(User.id.in_(user_ids))
    ).all()
    return {r.id: (ERASED_NAME if r.pseudonymized_at else r.name) for r in rows}


def report_out(
    report: SavedReport, user_id: UUID, role_code: str, owner_names: dict[UUID, str]
) -> dict[str, Any]:
    is_owner = report.user_id == user_id
    return {
        "id": str(report.id),
        "name": report.name,
        "source": report.source,
        "definition": report.definition,
        "is_shared": report.is_shared,
        "owner_id": str(report.user_id),
        "owner_name": owner_names.get(report.user_id, ERASED_NAME),
        "is_owner": is_owner,
        "can_edit": is_owner or role_code == "admin",
        "created_at": report.created_at.isoformat(),
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
    }


def list_reports(db: Session, tenant_id: UUID, user_id: UUID, role_code: str) -> list[dict]:
    set_tenant_context(db, str(tenant_id))
    stmt = (
        select(SavedReport)
        .where(
            SavedReport.tenant_id == tenant_id,
            (SavedReport.user_id == user_id) | SavedReport.is_shared,
        )
        .order_by(SavedReport.name, SavedReport.id)
    )
    reports = list(db.execute(stmt).scalars())
    names = _owner_names(db, {r.user_id for r in reports})
    return [report_out(r, user_id, role_code, names) for r in reports]


def get_visible(
    db: Session, tenant_id: UUID, user_id: UUID, role_code: str, report_id: UUID
) -> SavedReport:
    set_tenant_context(db, str(tenant_id))
    report = db.execute(
        select(SavedReport).where(SavedReport.tenant_id == tenant_id, SavedReport.id == report_id)
    ).scalar_one_or_none()
    if report is None or not (
        report.user_id == user_id or report.is_shared or role_code == "admin"
    ):
        raise NotFoundError("Saved report not found")
    return report


def get_out(
    db: Session, tenant_id: UUID, user_id: UUID, role_code: str, report_id: UUID
) -> dict[str, Any]:
    report = get_visible(db, tenant_id, user_id, role_code, report_id)
    names = _owner_names(db, {report.user_id})
    return report_out(report, user_id, role_code, names)


def _require_editor(report: SavedReport, user_id: UUID, role_code: str) -> None:
    if report.user_id != user_id and role_code != "admin":
        raise ForbiddenError("Only the owner or an Admin can change this report")


def create_report(
    db: Session, tenant_id: UUID, user_id: UUID, role_code: str, req: SavedReportCreate
) -> dict[str, Any]:
    set_tenant_context(db, str(tenant_id))
    count = db.execute(
        select(func.count()).select_from(SavedReport).where(SavedReport.user_id == user_id)
    ).scalar_one()
    if count >= MAX_REPORTS_PER_USER:
        raise ConflictError(f"You can save at most {MAX_REPORTS_PER_USER} reports")
    report = SavedReport(
        tenant_id=tenant_id,
        user_id=user_id,
        name=req.name.strip(),
        source=req.definition.source,
        definition=req.definition.model_dump(mode="json", exclude_none=True),
        is_shared=req.is_shared,
    )
    db.add(report)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("You already have a report with this name") from None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="report.saved",
        entity_type="saved_report",
        entity_id=report.id,
        metadata={"name": report.name, "source": report.source},
    )
    db.commit()
    return get_out(db, tenant_id, user_id, role_code, report.id)


def update_report(
    db: Session,
    tenant_id: UUID,
    user_id: UUID,
    role_code: str,
    report_id: UUID,
    req: SavedReportUpdate,
) -> dict[str, Any]:
    report = get_visible(db, tenant_id, user_id, role_code, report_id)
    _require_editor(report, user_id, role_code)
    if req.name is not None:
        report.name = req.name.strip()
    if req.definition is not None:
        report.definition = req.definition.model_dump(mode="json", exclude_none=True)
        report.source = req.definition.source
    if req.is_shared is not None:
        report.is_shared = req.is_shared
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("You already have a report with this name") from None
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="report.saved",
        entity_type="saved_report",
        entity_id=report.id,
        metadata={"name": report.name, "source": report.source},
    )
    db.commit()
    return get_out(db, tenant_id, user_id, role_code, report_id)


def delete_report(
    db: Session, tenant_id: UUID, user_id: UUID, role_code: str, report_id: UUID
) -> None:
    report = get_visible(db, tenant_id, user_id, role_code, report_id)
    _require_editor(report, user_id, role_code)
    meta = {"name": report.name, "source": report.source}
    db.delete(report)
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="report.deleted",
        entity_type="saved_report",
        entity_id=report_id,
        metadata=meta,
    )
    db.commit()


def definition_of(report: SavedReport) -> DefinitionIn:
    try:
        return DefinitionIn.model_validate(report.definition)
    except ValueError:
        raise ValidationAppError("This saved report is no longer valid; edit and save it") from None


def run_saved(
    db: Session,
    tenant_id: UUID,
    user_id: UUID,
    role_code: str,
    report_id: UUID,
    *,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    report = get_visible(db, tenant_id, user_id, role_code, report_id)
    return run_definition(
        db, tenant_id, role_code, user_id, definition_of(report), page=page, page_size=page_size
    )


def _export_rows(
    db: Session, tenant_id: UUID, user_id: UUID, role_code: str, report_id: UUID
) -> tuple[SavedReport, dict[str, Any]]:
    report = get_visible(db, tenant_id, user_id, role_code, report_id)
    result = run_definition(
        db,
        tenant_id,
        role_code,
        user_id,
        definition_of(report),
        page=1,
        page_size=MAX_PAGE_SIZE,
        limit_override=MAX_EXPORT_ROWS,
    )
    record_audit_event(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="report.exported",
        entity_type="saved_report",
        entity_id=report.id,
        metadata={"name": report.name, "source": report.source},
    )
    db.commit()
    return report, result


def export_csv(
    db: Session, tenant_id: UUID, user_id: UUID, role_code: str, report_id: UUID
) -> tuple[str, str]:
    report, result = _export_rows(db, tenant_id, user_id, role_code, report_id)
    keys = [c["key"] for c in result["columns"]]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([safe_cell(c["label"]) for c in result["columns"]])
    for row in result["rows"]:
        writer.writerow([_csv_cell(row[k]) for k in keys])
    return report.name, buf.getvalue()


def _csv_cell(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, str):
        return safe_cell(v)
    return v


def export_xlsx(
    db: Session, tenant_id: UUID, user_id: UUID, role_code: str, report_id: UUID
) -> tuple[str, bytes]:
    report, result = _export_rows(db, tenant_id, user_id, role_code, report_id)
    keys = [c["key"] for c in result["columns"]]
    sheet = SheetSpec(
        report.name,
        [c["label"] for c in result["columns"]],
        [[row[k] for k in keys] for row in result["rows"]],
    )
    return report.name, build_workbook([sheet])


def sources_metadata() -> list[dict[str, Any]]:
    out = []
    for key, specs in SOURCES.items():
        out.append(
            {
                "key": key,
                "label": key.replace("_", " ").title(),
                "fields": [
                    {
                        "key": name,
                        "label": s.label,
                        "type": s.type,
                        "operators": list(s.operators),
                        "sortable": s.sortable,
                        "groupable": s.groupable,
                        "options": list(s.options),
                    }
                    for name, s in specs.items()
                ],
            }
        )
    return out
