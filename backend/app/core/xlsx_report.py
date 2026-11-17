"""ADR-071: Excel (.xlsx) export helper.

One small, dependency-light builder (XlsxWriter, write-only) shared by every
report/list export, so formatting and the spreadsheet-injection guard live in
exactly one place.

Injection guard: a cell whose text starts with `=`, `+`, `-` or `@` (or a
tab/CR, which some spreadsheet apps also treat as formula starters) would be
evaluated as a formula when the file is opened in Excel/LibreOffice. Every
*string* cell therefore goes through `safe_cell`, which prefixes a single
quote so the value is stored and shown as literal text. Numbers, booleans and
dates are written with their native types (never as strings), so they are not
affected and stay usable in the sheet.
"""

import io
from collections.abc import Iterable, Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import xlsxwriter

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Excel hard limits (a longer name/row count makes the file unopenable).
_MAX_SHEET_NAME = 31
_MAX_ROWS = 1_048_575  # minus the header row
_MAX_COL_WIDTH = 60
_MIN_COL_WIDTH = 8
_FORMULA_STARTERS = ("=", "+", "-", "@", "\t", "\r")
_INVALID_SHEET_CHARS = set("[]:*?/\\")


def safe_cell(value: str) -> str:
    """Neutralise formula injection in a text cell."""
    if value.startswith(_FORMULA_STARTERS):
        return "'" + value
    return value


def _sheet_name(name: str, used: set[str]) -> str:
    cleaned = "".join("_" if c in _INVALID_SHEET_CHARS else c for c in name).strip("'") or "Sheet"
    cleaned = cleaned[:_MAX_SHEET_NAME]
    candidate = cleaned
    n = 2
    while candidate.lower() in used:
        suffix = f" ({n})"
        candidate = cleaned[: _MAX_SHEET_NAME - len(suffix)] + suffix
        n += 1
    used.add(candidate.lower())
    return candidate


class SheetSpec:
    """A table (header + rows) or a key/value block, in one worksheet."""

    def __init__(
        self,
        name: str,
        headers: Sequence[str],
        rows: Iterable[Sequence[Any]],
        *,
        title: str | None = None,
        notes: Sequence[tuple[str, Any]] = (),
    ) -> None:
        self.name = name
        self.headers = list(headers)
        self.rows = rows
        self.title = title
        self.notes = list(notes)


def build_workbook(sheets: Sequence[SheetSpec]) -> bytes:
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(
        buffer,
        {"in_memory": True, "remove_timezone": True, "strings_to_formulas": False},
    )
    header_fmt = workbook.add_format(
        {"bold": True, "bg_color": "#1E293B", "font_color": "#FFFFFF", "border": 1, "valign": "top"}
    )
    title_fmt = workbook.add_format({"bold": True, "font_size": 14})
    note_label_fmt = workbook.add_format({"bold": True, "font_color": "#475569"})
    date_fmt = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    day_fmt = workbook.add_format({"num_format": "yyyy-mm-dd"})
    pct_fmt = workbook.add_format({"num_format": "0.0"})

    used_names: set[str] = set()
    for spec in sheets:
        sheet = workbook.add_worksheet(_sheet_name(spec.name, used_names))
        widths = [len(h) for h in spec.headers]
        row_idx = 0
        if spec.title:
            sheet.write_string(row_idx, 0, safe_cell(spec.title), title_fmt)
            row_idx += 1
        for label, value in spec.notes:
            sheet.write_string(row_idx, 0, safe_cell(str(label)), note_label_fmt)
            _write(sheet, row_idx, 1, value, date_fmt, day_fmt, pct_fmt)
            widths_len = len(str(value))
            if len(widths) < 2:
                widths += [0] * (2 - len(widths))
            widths[0] = max(widths[0], len(str(label)))
            widths[1] = max(widths[1], min(widths_len, _MAX_COL_WIDTH))
            row_idx += 1
        if spec.title or spec.notes:
            row_idx += 1

        header_row = row_idx
        for col, header in enumerate(spec.headers):
            sheet.write_string(header_row, col, safe_cell(header), header_fmt)
        count = 0
        for r, row in enumerate(spec.rows, start=header_row + 1):
            if count >= _MAX_ROWS:
                break
            count += 1
            for col, value in enumerate(row):
                _write(sheet, r, col, value, date_fmt, day_fmt, pct_fmt)
                if col >= len(widths):
                    widths.append(0)
                widths[col] = max(widths[col], min(len(_text(value)), _MAX_COL_WIDTH))
        if spec.headers:
            sheet.freeze_panes(header_row + 1, 0)
        for col, w in enumerate(widths):
            sheet.set_column(col, col, max(_MIN_COL_WIDTH, min(w + 2, _MAX_COL_WIDTH)))
    workbook.close()
    return buffer.getvalue()


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    return str(value)


def _write(
    sheet: Any, row: int, col: int, value: Any, date_fmt: Any, day_fmt: Any, pct_fmt: Any
) -> None:
    if value is None:
        sheet.write_blank(row, col, None)
    elif isinstance(value, bool):
        sheet.write_boolean(row, col, value)
    elif isinstance(value, int):
        sheet.write_number(row, col, value)
    elif isinstance(value, float | Decimal):
        sheet.write_number(row, col, float(value), pct_fmt if isinstance(value, float) else None)
    elif isinstance(value, datetime):
        sheet.write_datetime(row, col, value, date_fmt)
    elif isinstance(value, date):
        sheet.write_datetime(row, col, datetime(value.year, value.month, value.day), day_fmt)
    else:
        sheet.write_string(row, col, safe_cell(str(value)))
