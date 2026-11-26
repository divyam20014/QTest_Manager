"""ADR-118: defect export (CSV and XLSX) of the 22-field standard.

Same filters, sorts and visibility as the list (they share `defect_service._defects_query`
and `_apply_sort`), optional `columns=` to select and order columns, and `ids=` to export
just the selected rows. Rows are serialised in chunks through `to_out_many`, the one
place the derived fields are computed, so an export can never disagree with the list.
"""

from collections.abc import Callable
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ValidationAppError
from app.core.field_standards import DEFECT_FIELDS
from app.core.import_steps import format_steps
from app.models.test_case import Attachment
from app.schemas.defect import DefectOut
from app.services import defect_service, export_common, test_case_service

EXPORT_CHUNK = export_common.EXPORT_CHUNK
EXPORT_MAX_ROWS = export_common.EXPORT_MAX_ROWS
MAX_IDS = 2_000

# The 22 fields in display order (key -> header), then the free-text root cause notes
# next to the root cause code they belong to is NOT merged into it: it is one extra
# column after them, followed by the defect's task id.
EXPORT_COLUMNS: list[tuple[str, str]] = [(f.key, f.label) for f in DEFECT_FIELDS] + [
    ("root_cause_notes", "Root Cause Notes"),
    ("task", "Task"),
]
EXPORT_COLUMN_KEYS = [k for k, _ in EXPORT_COLUMNS]
EXPORT_HEADER_BY_KEY = dict(EXPORT_COLUMNS)


def parse_export_columns(columns: str | None) -> list[str]:
    """`columns=display_id,title,...` -> validated keys in the requested order
    (default: every column). Unknown or repeated keys are a 422."""
    if columns is None or not columns.strip():
        return list(EXPORT_COLUMN_KEYS)
    keys = [c.strip() for c in columns.split(",") if c.strip()]
    unknown = [k for k in keys if k not in EXPORT_HEADER_BY_KEY]
    if unknown:
        raise ValidationAppError(
            f"Unknown export column(s): {', '.join(unknown)}. "
            f"Valid keys: {', '.join(EXPORT_COLUMN_KEYS)}.",
            fields={"columns": f"Unknown column(s): {', '.join(unknown)}"},
        )
    if len(set(keys)) != len(keys):
        raise ValidationAppError(
            "Export columns must not repeat", fields={"columns": "Columns must not repeat"}
        )
    return keys


def parse_ids(ids: str | None) -> list[UUID] | None:
    """`ids=<uuid>,<uuid>` -> the selected rows (at most 2,000); a malformed id is a 422."""
    if ids is None or not ids.strip():
        return None
    out: list[UUID] = []
    for part in ids.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(UUID(part))
        except ValueError as exc:
            raise ValidationAppError(
                f"'{part}' is not a valid id", fields={"ids": f"'{part}' is not a valid id"}
            ) from exc
    if len(out) > MAX_IDS:
        raise ValidationAppError(
            f"At most {MAX_IDS} ids can be exported at once", fields={"ids": "Too many ids"}
        )
    return out


def _steps_cell(steps: list[dict[str, Any]] | None) -> str:
    """'N. action | test data | expected' lines, one per step (ADR-120 import format)."""
    return format_steps(
        [(s.get("action", ""), s.get("test_data"), s.get("expected_result")) for s in steps or []]
    )


def _attachment_names(db: Session, defect_ids: list[UUID]) -> dict[UUID, list[str]]:
    names: dict[UUID, list[str]] = {d: [] for d in defect_ids}
    for owner_id, file_name in db.execute(
        select(Attachment.owner_id, Attachment.file_name)
        .where(Attachment.owner_type == "defect", Attachment.owner_id.in_(defect_ids))
        .order_by(Attachment.uploaded_at)
    ):
        names[owner_id].append(file_name)
    return names


def _module_cell(o: DefectOut, paths: dict[UUID, tuple[str, str]]) -> str:
    if o.module_id is not None and o.module_id in paths:
        return paths[o.module_id][1]
    return o.module_name or ""


def _cell_builders(
    attachments: dict[UUID, list[str]], paths: dict[UUID, tuple[str, str]]
) -> dict[str, Callable[[DefectOut], Any]]:
    return {
        "display_id": lambda o: o.display_id or "",
        "title": lambda o: o.title,
        "description": lambda o: o.description or "",
        "module": lambda o: _module_cell(o, paths),
        "preconditions": lambda o: o.preconditions or "",
        "repro_steps": lambda o: _steps_cell(o.repro_steps),
        "expected_result": lambda o: o.expected_result or "",
        "actual_result": lambda o: o.actual_result or "",
        "attachments": lambda o: "; ".join(attachments.get(o.id, [])),
        "environment": lambda o: o.environment_name or o.environment or "",
        "build_found": lambda o: o.build_found or o.found_in_build_name or "",
        "severity": lambda o: o.severity,
        "priority": lambda o: o.priority,
        "status": lambda o: o.status_label or o.status,
        "resolution": lambda o: o.resolution or "",
        "root_cause": lambda o: o.root_cause or "",
        "reporter": lambda o: o.reported_by_name or "",
        "assignee": lambda o: o.assigned_to_name or "",
        "date_reported": lambda o: o.created_at.isoformat(),
        "fix_version": lambda o: o.fix_version or o.fixed_in_release_name or "",
        "linked_issues": lambda o: "; ".join(
            c.display_id or str(c.id) for c in o.linked_test_cases
        ),
        "labels": lambda o: "; ".join(o.labels),
        "root_cause_notes": lambda o: o.root_cause_notes or "",
        "task": lambda o: o.task_display_id or "",
    }


def export_defects_data(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    filters: defect_service.DefectFilters,
    columns: str | None = None,
    sort: str | None = None,
) -> export_common.ExportData:
    """At most `EXPORT_MAX_ROWS` rows; the result is flagged when it was cut (ADR-120)."""
    keys = parse_export_columns(columns)
    query = defect_service._defects_query(db, tenant_id, role_code, user_id, filters)
    total = db.execute(select(func.count()).select_from(query.subquery())).scalar_one()
    ordered = defect_service._apply_sort(query, sort)
    wanted = min(total, EXPORT_MAX_ROWS)
    data = export_common.ExportData(
        headers=[EXPORT_HEADER_BY_KEY[k] for k in keys], truncated=total > EXPORT_MAX_ROWS
    )

    offset = 0
    while offset < wanted:
        chunk = list(
            db.execute(ordered.limit(min(EXPORT_CHUNK, wanted - offset)).offset(offset)).scalars()
        )
        if not chunk:
            break
        offset += len(chunk)
        outs = defect_service.to_out_many(db, chunk)
        attachments = _attachment_names(db, [d.id for d in chunk])
        paths = test_case_service._module_paths(
            db, {d.module_id for d in chunk if d.module_id is not None}
        )
        builders = _cell_builders(attachments, paths)
        for out in outs:
            data.rows.append([export_common.safe_text(builders[k](out)) for k in keys])
    return data


def export_defects_csv(
    db: Session,
    tenant_id: UUID,
    role_code: str,
    user_id: UUID,
    filters: defect_service.DefectFilters,
    columns: str | None = None,
    sort: str | None = None,
) -> str:
    return export_common.to_csv(
        export_defects_data(db, tenant_id, role_code, user_id, filters, columns, sort)
    )
