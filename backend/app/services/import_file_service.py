"""ADR-120: reading an uploaded import file (CSV or XLSX) into plain text cells.

Only values are read: formulas, macros and external links are refused, the file size,
the unzipped size, the row count and the column count are bounded, and nothing in the
file is ever executed or fetched. Header matching and validation live in
`import_export_service`; this module only turns bytes into ``(row number, cells)``.
"""

from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.core.config import get_settings
from app.core.errors import ValidationAppError

settings = get_settings()

_MAX_ZIP_ENTRIES = 500
# A part this large that also compresses better than 1:200 is a decompression bomb.
_BOMB_RATIO = 200
_BOMB_MIN_SIZE = 5 * 1024 * 1024
_INSTRUCTION_SHEETS = {"instructions", "allowed values"}
_FORMULA_STARTERS = ("=", "+", "-", "@", "\t", "\r")


@dataclass
class ParsedFile:
    headers: list[str]
    # (row number as in the file with the header row = its own number, cells)
    rows: list[tuple[int, list[str]]]
    file_type: str
    warnings: list[str] = field(default_factory=list)


def unguard(value: str) -> str:
    """The exports prefix a quote to text that starts with = + - @ (formula-injection
    guard); read it back as the original text so an export re-imports unchanged."""
    if len(value) > 1 and value[0] == "'" and value[1] in _FORMULA_STARTERS:
        return value[1:]
    return value


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    return unguard(str(value))


def _trim(cells: list[str]) -> list[str]:
    end = len(cells)
    while end > 0 and not cells[end - 1].strip():
        end -= 1
    return cells[:end]


def read_upload(filename: str | None, raw: bytes) -> ParsedFile:
    name = (filename or "").strip()
    lower = name.lower()
    if not raw:
        raise ValidationAppError("The file is empty")
    if len(raw) > settings.import_file_max_bytes:
        limit_mb = settings.import_file_max_bytes // (1024 * 1024)
        raise ValidationAppError(f"The file is larger than the {limit_mb} MB import limit")
    if lower.endswith(".xlsm") or lower.endswith(".xlsb") or lower.endswith(".xltm"):
        raise ValidationAppError(
            "Macro-enabled workbooks are not accepted. Save the file as .xlsx or .csv."
        )
    if lower.endswith(".xls"):
        raise ValidationAppError("Old .xls workbooks are not supported. Save as .xlsx or .csv.")
    if lower.endswith(".xlsx"):
        return _read_xlsx(raw)
    if lower.endswith(".csv"):
        return _read_csv(raw)
    raise ValidationAppError("The file must be a .xlsx or .csv file")


# --- CSV ---------------------------------------------------------------------------------


def _sniff_delimiter(sample: str) -> str:
    """Comma, semicolon or tab only (anything else is read as comma)."""
    first_line = sample.split("\n", 1)[0]
    try:
        return csv.Sniffer().sniff(sample[:4096], delimiters=",;\t").delimiter
    except csv.Error:
        counts = {d: first_line.count(d) for d in (",", ";", "\t")}
        best = max(counts, key=lambda d: counts[d])
        return best if counts[best] else ","


def _read_csv(raw: bytes) -> ParsedFile:
    if b"\x00" in raw[:8192]:
        raise ValidationAppError("The file is not a text CSV file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValidationAppError("The CSV file must be UTF-8 encoded") from exc
    delimiter = _sniff_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows: list[tuple[int, list[str]]] = []
    headers: list[str] | None = None
    max_rows = settings.import_max_rows
    try:
        for number, record in enumerate(reader, start=1):
            cells = _trim([unguard(c) for c in record])
            if headers is None:
                if not cells:
                    continue
                headers = cells
                if len(headers) > settings.import_max_columns:
                    raise ValidationAppError(
                        f"The file has {len(headers)} columns; at most "
                        f"{settings.import_max_columns} are allowed"
                    )
                continue
            if not cells:
                continue
            if len(cells) > settings.import_max_columns:
                raise ValidationAppError(
                    f"Row {number} has more than {settings.import_max_columns} columns"
                )
            rows.append((number, cells))
            if len(rows) > max_rows:
                raise ValidationAppError(
                    f"The file has more than {max_rows:,} rows; split it into smaller files"
                )
    except csv.Error as exc:
        raise ValidationAppError(f"The CSV file could not be read: {exc}") from exc
    if headers is None:
        raise ValidationAppError("The file has no header row")
    return ParsedFile(headers=headers, rows=rows, file_type="csv")


# --- XLSX --------------------------------------------------------------------------------


def _check_zip(raw: bytes) -> None:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise ValidationAppError(
            "The file is not a valid .xlsx workbook (or it is password protected)"
        ) from exc
    with archive:
        infos = archive.infolist()
        if len(infos) > _MAX_ZIP_ENTRIES:
            raise ValidationAppError("The workbook has too many parts to be a plain spreadsheet")
        total = 0
        names = set()
        for info in infos:
            total += info.file_size
            lowered = info.filename.lower()
            names.add(lowered)
            if lowered.endswith("vbaproject.bin") or lowered.startswith("xl/macrosheets/"):
                raise ValidationAppError("The workbook contains macros, which are not accepted")
            if lowered.startswith("xl/externallinks/"):
                raise ValidationAppError(
                    "The workbook links to other files, which is not accepted; "
                    "paste the values into a new workbook"
                )
            if (
                info.file_size > _BOMB_MIN_SIZE
                and info.compress_size > 0
                and info.file_size / info.compress_size > _BOMB_RATIO
            ):
                raise ValidationAppError(
                    "The workbook is not a plain spreadsheet (compression bomb)"
                )
            if lowered.startswith(("/", "../")) or ".." in lowered.split("/"):
                raise ValidationAppError("The workbook has an invalid structure")
        if total > settings.import_zip_max_uncompressed_bytes:
            raise ValidationAppError("The workbook expands to more than the allowed size")
        if "xl/workbook.xml" not in names:
            raise ValidationAppError("The file is not a valid .xlsx workbook")
        try:
            content_types = archive.read("[Content_Types].xml").decode("utf-8", "ignore")
        except KeyError as exc:
            raise ValidationAppError("The file is not a valid .xlsx workbook") from exc
        if "macroEnabled" in content_types:
            raise ValidationAppError("The workbook is macro-enabled, which is not accepted")


def _read_xlsx(raw: bytes) -> ParsedFile:
    from openpyxl import load_workbook

    _check_zip(raw)
    try:
        workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
    except Exception as exc:  # noqa: BLE001 -- any parser failure is "not a readable workbook"
        raise ValidationAppError("The workbook could not be read") from exc
    try:
        sheet = None
        for candidate in workbook.worksheets:
            if getattr(candidate, "sheet_state", "visible") != "visible":
                continue
            if candidate.title.strip().lower() in _INSTRUCTION_SHEETS:
                continue
            sheet = candidate
            break
        if sheet is None:
            raise ValidationAppError("The workbook has no data sheet")
        headers: list[str] | None = None
        rows: list[tuple[int, list[str]]] = []
        formulas: list[str] = []
        max_rows = settings.import_max_rows
        iterated = 0
        for number, row in enumerate(sheet.iter_rows(), start=1):
            iterated += 1
            if iterated > max_rows * 3 + 100:
                raise ValidationAppError("The sheet is too large")
            cells: list[str] = []
            for cell in row:
                if getattr(cell, "data_type", None) == "f":
                    formulas.append(str(getattr(cell, "coordinate", "?")))
                    cells.append("")
                else:
                    cells.append(_text(getattr(cell, "value", None)))
            cells = _trim(cells)
            if len(cells) > settings.import_max_columns:
                raise ValidationAppError(
                    f"The sheet has more than {settings.import_max_columns} columns"
                )
            if headers is None:
                if not cells:
                    continue
                headers = cells
                continue
            if not cells:
                continue
            rows.append((number, cells))
            if len(rows) > max_rows:
                raise ValidationAppError(
                    f"The sheet has more than {max_rows:,} rows; split it into smaller files"
                )
        if formulas:
            shown = ", ".join(formulas[:5])
            raise ValidationAppError(
                f"The workbook contains formulas ({shown}); formulas are not accepted. "
                "Paste the values instead."
            )
        if headers is None:
            raise ValidationAppError("The sheet has no header row")
        return ParsedFile(headers=headers, rows=rows, file_type="xlsx")
    finally:
        workbook.close()
