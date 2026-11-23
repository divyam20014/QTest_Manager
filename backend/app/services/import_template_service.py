"""ADR-120: downloadable import templates (xlsx and csv) for test cases and defects.

Headers are the labels of the 22-field catalogue (plus the module's few extra import
columns), one example row, and in the workbook an 'Instructions' sheet, an 'Allowed values'
sheet and dropdown data validation on the enum columns (values come from the tenant's own
configured options). Mandatory columns have an amber header and a comment.
"""

from __future__ import annotations

import csv
import io
from uuid import UUID

import xlsxwriter
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.field_standards import (
    AUTOMATION_STATUSES,
    DEFECT_STATUSES,
    RESOLUTION_RULES,
    RESOLUTIONS,
    TEST_TYPE_DEFAULTS,
)
from app.core.import_columns import COLUMNS_BY_KIND, ImportColumn
from app.core.xlsx_report import XLSX_MEDIA_TYPE, safe_cell
from app.services import field_option_service

settings = get_settings()

CSV_MEDIA_TYPE = "text/csv"
VALIDATION_ROWS = 5000
_ROOT_CAUSES = [
    "requirements_gap",
    "code_defect",
    "design_flaw",
    "test_data_issue",
    "environment_issue",
    "third_party_integration",
    "other",
]
_REVIEW_STATUSES = ["Draft", "Ready for Review", "Approved", "Deprecated"]


def allowed_values(db: Session, tenant_id: UUID, kind: str) -> dict[str, list[str]]:
    """enum name -> allowed values for the module (the tenant's configured options)."""

    def opts(key: str) -> list[str]:
        return [o.code for o in field_option_service.list_options(db, tenant_id, key)]

    if kind == "test_case":
        return {
            "Test Type": opts("test_type") or list(TEST_TYPE_DEFAULTS),
            "Priority": opts("test_case_priority"),
            "Severity": opts("test_case_severity"),
            "Automation Status": list(AUTOMATION_STATUSES),
            "Review Status": list(_REVIEW_STATUSES),
        }
    return {
        "Severity": opts("defect_severity"),
        "Priority": opts("defect_priority"),
        "Status": list(DEFECT_STATUSES),
        "Resolution": list(RESOLUTIONS),
        "Root Cause": list(_ROOT_CAUSES),
    }


def _columns(kind: str) -> list[ImportColumn]:
    return list(COLUMNS_BY_KIND[kind])


def _sheet_title(kind: str) -> str:
    return "Test Cases" if kind == "test_case" else "Defects"


def build_csv(kind: str) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    columns = _columns(kind)
    writer.writerow([c.header for c in columns])
    writer.writerow([c.example for c in columns])
    return buffer.getvalue()


def _instruction_rows(kind: str, enums: dict[str, list[str]]) -> list[list[str]]:
    noun = "test case" if kind == "test_case" else "defect"
    rows: list[list[str]] = [
        [f"How to import {noun}s"],
        [
            "1. Fill one row per "
            + noun
            + " on the first sheet. Keep the header row exactly as it is."
        ],
        ["2. Delete the example row (or leave it: it is skipped)."],
        ["3. In the application choose Import, pick the project and upload the file."],
        ["4. Review the preview; fix rows with errors, or import only the valid rows."],
        [],
        ["Steps format"],
        ["Write all steps of a " + noun + " in ONE cell, one step per line (Alt+Enter in Excel):"],
        ["N. action | test data | expected result"],
        ["Example: 1. Open the claim | Policy: AUTO-100234 | The claim opens"],
        [
            "Keep the bars when a part is empty, e.g. '2. Click Save | | The record is saved'. "
            "A literal bar inside a part is written \\|. A line that does not start with a "
            "number continues the previous step."
        ],
        [
            "Each step needs an action"
            + (
                " and an expected result."
                if kind == "test_case"
                else "; test data and expected result are optional."
            )
        ],
        [],
        ["Rules"],
        [
            "Module: a path 'Module/Submodule/Feature'. Modules that do not exist are created "
            "(the preview lists them)."
        ],
        [
            "IDs: an id in the "
            + ("Test Case ID" if kind == "test_case" else "Bug ID")
            + " column is kept when it looks like "
            + ("TC_000123" if kind == "test_case" else "BUG_000123")
            + " and is not used twice in the file or already in your workspace; otherwise the "
            "next id is assigned. Leave it empty to get the next ids."
        ],
        [
            "Allowed file types: .xlsx and .csv (UTF-8; comma, semicolon or tab). Formulas, macros "
            f"and external links are not accepted. At most {settings.import_max_rows:,} rows and "
            f"{settings.import_file_max_bytes // (1024 * 1024)} MB per file."
        ],
        [
            "Columns marked 'ignored' are produced by an export and are not read on import "
            "(they are derived by the application)."
        ],
    ]
    if kind == "defect":
        rows += [
            [
                "Reporter is the user who imports; Date Reported is the import time. "
                "Status defaults to New; any status is accepted when its Resolution fits "
                "(see the Allowed values sheet)."
            ],
            ["Linked Issues / Test Case ID: test case ids of the same project separated by ';'."],
        ]
    rows += [[], ["Columns"], ["Column", "Required", "Allowed values / format", "Notes"]]
    for col in _columns(kind):
        values = enums.get(col.enum or "")
        fmt = ", ".join(values) if values else "Text"
        required = "Ignored" if col.readonly else ("Required" if col.mandatory else "Optional")
        rows.append([col.header, required, fmt, col.note])
    return rows


def build_xlsx(db: Session, tenant_id: UUID, kind: str) -> bytes:
    enums = allowed_values(db, tenant_id, kind)
    columns = _columns(kind)
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(
        buffer, {"in_memory": True, "strings_to_formulas": False, "remove_timezone": True}
    )
    header_fmt = workbook.add_format(
        {
            "bold": True,
            "bg_color": "#1E293B",
            "font_color": "#FFFFFF",
            "border": 1,
            "valign": "top",
            "text_wrap": True,
        }
    )
    required_fmt = workbook.add_format(
        {
            "bold": True,
            "bg_color": "#FDE68A",
            "font_color": "#1F2937",
            "border": 1,
            "valign": "top",
            "text_wrap": True,
        }
    )
    ignored_fmt = workbook.add_format(
        {
            "bold": True,
            "bg_color": "#CBD5E1",
            "font_color": "#334155",
            "border": 1,
            "valign": "top",
            "text_wrap": True,
        }
    )
    cell_fmt = workbook.add_format({"valign": "top", "text_wrap": True})
    title_fmt = workbook.add_format({"bold": True, "font_size": 14})
    bold_fmt = workbook.add_format({"bold": True})
    wrap_fmt = workbook.add_format({"text_wrap": True, "valign": "top"})

    data = workbook.add_worksheet(_sheet_title(kind))
    instructions = workbook.add_worksheet("Instructions")
    allowed = workbook.add_worksheet("Allowed values")

    # --- Allowed values sheet: one column per list, validation points here ------------------
    ranges: dict[str, str] = {}
    for index, (name, values) in enumerate(enums.items()):
        allowed.write_string(0, index, name, header_fmt)
        for row, value in enumerate(values, start=1):
            allowed.write_string(row, index, safe_cell(value))
        letter = xlsxwriter.utility.xl_col_to_name(index)
        if values:
            ranges[name] = f"='Allowed values'!${letter}$2:${letter}${len(values) + 1}"
        allowed.set_column(index, index, max(14, len(name) + 2, *(len(v) + 2 for v in values)))
    if kind == "defect":
        start = max((len(v) for v in enums.values()), default=0) + 3
        allowed.write_string(start, 0, "Status", bold_fmt)
        allowed.write_string(start, 1, "Resolution rule", bold_fmt)
        for offset, status in enumerate(DEFECT_STATUSES, start=1):
            rule = RESOLUTION_RULES[status]
            if rule.allowed:
                text_rule = ("Required: " if rule.required else "Optional: ") + ", ".join(
                    sorted(rule.allowed)
                )
            else:
                text_rule = "Must be empty"
            allowed.write_string(start + offset, 0, status)
            allowed.write_string(start + offset, 1, text_rule)
        allowed.set_column(1, 1, 40)

    # --- data sheet -------------------------------------------------------------------------
    for index, col in enumerate(columns):
        fmt = ignored_fmt if col.readonly else (required_fmt if col.mandatory else header_fmt)
        data.write_string(0, index, col.header, fmt)
        if col.mandatory:
            data.write_comment(0, index, "Required")
        elif col.readonly:
            data.write_comment(0, index, "Ignored on import (derived by the application)")
        data.write_string(1, index, safe_cell(col.example), cell_fmt)
        width = 60 if col.key in ("steps", "repro_steps") else max(14, min(len(col.header) + 4, 34))
        data.set_column(index, index, width)
        if col.enum and col.enum in ranges and not col.readonly:
            data.data_validation(
                1,
                index,
                VALIDATION_ROWS,
                index,
                {
                    "validate": "list",
                    "source": ranges[col.enum],
                    "ignore_blank": True,
                    "error_title": col.header,
                    "error_message": "Choose one of the values on the 'Allowed values' sheet.",
                },
            )
    data.set_row(1, 48)
    data.freeze_panes(1, 0)

    # --- instructions sheet -----------------------------------------------------------------
    rows = _instruction_rows(kind, enums)
    for row_index, line in enumerate(rows):
        for col_index, value in enumerate(line):
            if row_index == 0:
                instructions.write_string(row_index, col_index, value, title_fmt)
            elif len(line) == 1 and value in ("Steps format", "Rules", "Columns"):
                instructions.write_string(row_index, col_index, value, bold_fmt)
            elif line == ["Column", "Required", "Allowed values / format", "Notes"]:
                instructions.write_string(row_index, col_index, value, header_fmt)
            elif len(line) == 1:
                instructions.write_string(row_index, col_index, safe_cell(value))
            else:
                instructions.write_string(row_index, col_index, safe_cell(value), wrap_fmt)
    instructions.set_column(0, 0, 34)
    instructions.set_column(1, 1, 12)
    instructions.set_column(2, 2, 60)
    instructions.set_column(3, 3, 60)
    workbook.close()
    return buffer.getvalue()


def template_filename(kind: str, fmt: str) -> str:
    base = "test_case_import_template" if kind == "test_case" else "defect_import_template"
    return f"{base}.{fmt}"


__all__ = [
    "CSV_MEDIA_TYPE",
    "XLSX_MEDIA_TYPE",
    "allowed_values",
    "build_csv",
    "build_xlsx",
    "template_filename",
]
