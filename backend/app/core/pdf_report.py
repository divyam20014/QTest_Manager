"""Pass 4 (ADR-065): server-side PDF generation for the compliance report.

Reverses ADR-027/038's deliberate "browser-print-to-PDF only, no PDF
library" decision -- scheduled/emailed reports need a real file
attachment, not a link to a page someone has to open and print manually.
Explicit user approval for this reversal; documented in ADR-065.

Library choice: reportlab. Pure-Python, no system-level dependencies
(no pango/cairo/gdk-pixbuf the way weasyprint would need), so the backend
Docker image stays exactly as lean as it was -- `pip install` is enough,
no new `apt-get` lines in the Dockerfile. It builds the PDF directly from
structured data (not by converting the existing print view's HTML/CSS),
which is more code here but avoids a second rendering engine's worth of
image bloat for a report this structured (tables and headings, not a
free-form layout) in the only format reportlab doesn't need extra help
with.
"""

import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.schemas.reporting import ComplianceReport

_STYLES = getSampleStyleSheet()
_TITLE = ParagraphStyle("QTHTitle", parent=_STYLES["Title"], fontSize=18, spaceAfter=4)
_H2 = ParagraphStyle("QTHH2", parent=_STYLES["Heading2"], spaceBefore=14, spaceAfter=6)
_META = ParagraphStyle("QTHMeta", parent=_STYLES["Normal"], textColor=colors.grey)


def _table(
    headers: list[str], rows: list[list[str]], col_widths: list[float] | None = None
) -> Table:
    data = [headers] + rows
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return t


def render_compliance_report_pdf(report: ComplianceReport) -> bytes:
    """Builds the same content as the existing JSON/print view
    (get_compliance_report) as a real downloadable PDF."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
    )
    story: list = []

    story.append(Paragraph("QTestHub Compliance Report", _TITLE))
    story.append(Paragraph(report.tenant_name, _STYLES["Heading3"]))
    period = (
        f"{report.period_from:%Y-%m-%d} to {report.period_to:%Y-%m-%d}"
        if report.period_from and report.period_to
        else "All time"
    )
    officer = f"{report.reporting_officer_name} ({report.reporting_officer_email})"
    story.append(
        Paragraph(
            f"Generated {report.generated_at:%Y-%m-%d %H:%M UTC} by {officer} "
            f"&#8212; period: {period}",
            _META,
        )
    )

    if report.trend:
        story.append(Paragraph("Period-over-Period Trend", _H2))
        t = report.trend
        story.append(
            _table(
                ["Metric", "Current period", "Prior period"],
                [
                    [
                        "Test cases created",
                        str(t.test_cases_created_current),
                        str(t.test_cases_created_prior),
                    ],
                    [
                        "Defects opened",
                        str(t.defects_opened_current),
                        str(t.defects_opened_prior),
                    ],
                    [
                        "Defects closed",
                        str(t.defects_closed_current),
                        str(t.defects_closed_prior),
                    ],
                ],
            )
        )

    for section in report.projects:
        story.append(PageBreak())
        story.append(Paragraph(f"{section.name} ({section.domain})", _H2))
        story.append(
            _table(
                ["Metric", "Value"],
                [
                    ["Total test cases", str(section.total_test_cases)],
                    ["Approved", str(section.approved_test_cases)],
                    ["Draft", str(section.draft_test_cases)],
                    ["Ready for review", str(section.ready_for_review_test_cases)],
                    ["Open defects", str(section.open_defects)],
                    ["Critical defects", str(section.critical_defects)],
                    [
                        "Requirement coverage",
                        f"{section.requirement_covered}/{section.requirement_total} "
                        f"({section.requirement_coverage_percentage:.1f}%)",
                    ],
                    ["Defects breaching SLA", str(section.defect_aging.total_breached)],
                ],
                col_widths=[2.5 * inch, 2.5 * inch],
            )
        )

        if section.test_cases:
            story.append(Spacer(1, 10))
            story.append(Paragraph("Test Cases", _STYLES["Heading4"]))
            story.append(
                _table(
                    ["Title", "Status", "Priority"],
                    [[tc.title, tc.status, tc.priority] for tc in section.test_cases],
                    col_widths=[3.5 * inch, 1.5 * inch, 1.5 * inch],
                )
            )

        if section.defects:
            story.append(Spacer(1, 10))
            story.append(Paragraph("Defects", _STYLES["Heading4"]))
            story.append(
                _table(
                    ["Title", "Severity", "Status"],
                    [[d.title, d.severity, d.status] for d in section.defects],
                    col_widths=[3.5 * inch, 1.5 * inch, 1.5 * inch],
                )
            )

    doc.build(story)
    return buffer.getvalue()
