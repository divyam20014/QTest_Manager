"""ADR-120: shared pieces of the csv / xlsx exports of test cases and defects."""

import csv
import io
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from fastapi.responses import Response, StreamingResponse

from app.core.xlsx_report import XLSX_MEDIA_TYPE, SheetSpec, build_workbook

# An export is built in memory; above this the result is cut and flagged.
EXPORT_MAX_ROWS = 50_000
EXPORT_CHUNK = 500
STREAM_CHUNK_CHARS = 64 * 1024

_FORMULA_STARTERS = ("=", "+", "-", "@", "\t", "\r")


def safe_text(value: Any) -> str:
    """CSV formula-injection guard (same rule as the xlsx writer): text that starts with
    = + - @ gets a leading quote so a spreadsheet shows it as text. The importer reads
    that quote back off, so an export re-imports unchanged."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_STARTERS) else text


@dataclass
class ExportData:
    headers: list[str]
    rows: list[list[str]] = field(default_factory=list)
    truncated: bool = False


def to_csv(data: ExportData) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(data.headers)
    writer.writerows(data.rows)
    return buffer.getvalue()


def _chunks(text: str) -> Iterator[bytes]:
    for start in range(0, len(text), STREAM_CHUNK_CHARS):
        yield text[start : start + STREAM_CHUNK_CHARS].encode("utf-8")
    if not text:
        yield b""


def _headers(filename: str, truncated: bool) -> dict[str, str]:
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if truncated:
        headers["X-Result-Truncated"] = "true"
    return headers


def csv_response(data: ExportData, filename: str) -> StreamingResponse:
    """Sent chunked (no Content-Length); the rows were read from the database in chunks."""
    return StreamingResponse(
        _chunks(to_csv(data)),
        media_type="text/csv; charset=utf-8",
        headers=_headers(filename, data.truncated),
    )


def xlsx_response(data: ExportData, sheet: str, filename: str) -> Response:
    """Header row bold and frozen, column widths from the content (core.xlsx_report)."""
    contents = build_workbook([SheetSpec(sheet, data.headers, data.rows)])
    return Response(
        contents, media_type=XLSX_MEDIA_TYPE, headers=_headers(filename, data.truncated)
    )
