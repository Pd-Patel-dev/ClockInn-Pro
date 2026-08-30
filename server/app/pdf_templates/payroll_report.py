"""
Professional Payroll Report PDF Generator

Clean, modern payroll export aligned with the ClockInn admin UI:
- Slate hero band with company identity and period
- KPI summary cards
- Refined employee earnings table
- Confidential footer with page numbers
"""
from typing import List, Optional, TypedDict
from datetime import datetime, date
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    Flowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
import re


# Page content width (letter with 0.55" side margins)
CONTENT_WIDTH = 7.4 * inch


class PayrollReportTotals(TypedDict):
    """Aggregated values shown on the payroll PDF summary and footer row."""

    employee_count: int
    total_regular_hours: float
    total_ot_hours: float
    total_rooms: int
    total_gross_pay: float
    total_regular_pay: float
    total_ot_pay: float
    has_per_room: bool


def _is_per_room_row(row: dict) -> bool:
    return str(row.get("pay_method") or "").upper() == "PER_ROOM"


def _row_rooms(row: dict) -> int:
    try:
        return int(row.get("rooms_cleaned") or 0)
    except (TypeError, ValueError):
        return 0


def compute_payroll_report_totals(rows: List[dict]) -> PayrollReportTotals:
    """Sum row fields the same way as the PDF generator (unit-test this; PDF streams may be compressed)."""
    hourly = [row for row in rows if not _is_per_room_row(row)]
    per_room = [row for row in rows if _is_per_room_row(row)]
    return {
        "employee_count": len(rows),
        "total_regular_hours": sum(float(row.get("regular_hours", 0) or 0) for row in hourly),
        "total_ot_hours": sum(float(row.get("ot_hours", 0) or 0) for row in hourly),
        "total_rooms": sum(_row_rooms(row) for row in per_room),
        "total_gross_pay": sum(float(row.get("total_pay", 0) or 0) for row in rows),
        "total_regular_pay": sum(float(row.get("regular_pay", 0) or 0) for row in rows),
        "total_ot_pay": sum(float(row.get("ot_pay", 0) or 0) for row in rows),
        "has_per_room": bool(per_room),
    }


def sanitize_html(text: str) -> str:
    """Sanitize text for ReportLab Paragraph (supports basic XML tags like <b>)."""
    if not text:
        return ""
    text = str(text)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"&(?!\w+;)", "&amp;", text)
    return text


def get_company_initials(company_name: str) -> str:
    """Extract initials from company name."""
    if not company_name:
        return "CO"
    words = company_name.split()
    if len(words) == 1:
        return words[0][:2].upper()
    return "".join(w[0].upper() for w in words[:2])


def _status_colors(status: str):
    """Return (bg, text) HexColors for a status pill."""
    key = (status or "").strip().upper()
    if key in ("FINALIZED", "FINAL"):
        return colors.HexColor("#059669"), colors.white
    if key in ("VOID", "VOIDED"):
        return colors.HexColor("#dc2626"), colors.white
    return colors.HexColor("#d97706"), colors.white


class HeroBanner(Flowable):
    """Full-width slate hero with company mark, title, period, and status."""

    def __init__(
        self,
        company_name: str,
        period_str: str,
        payroll_type: str,
        status: str,
        pay_date_str: str = "",
        width: float = CONTENT_WIDTH,
        height: float = 1.15 * inch,
    ):
        Flowable.__init__(self)
        self.company_name = company_name
        self.period_str = period_str
        self.payroll_type = payroll_type
        self.status = status
        self.pay_date_str = pay_date_str
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        w, h = self.width, self.height

        # Background
        c.setFillColor(colors.HexColor("#0f172a"))
        c.roundRect(0, 0, w, h, 8, fill=1, stroke=0)

        # Left accent bar
        c.setFillColor(colors.HexColor("#38bdf8"))
        c.rect(0, 0, 4, h, fill=1, stroke=0)

        # Company mark circle
        mark_x, mark_y, mark_r = 28, h / 2, 16
        c.setFillColor(colors.HexColor("#1e293b"))
        c.circle(mark_x, mark_y, mark_r, fill=1, stroke=0)
        c.setStrokeColor(colors.HexColor("#334155"))
        c.setLineWidth(1)
        c.circle(mark_x, mark_y, mark_r, fill=0, stroke=1)

        initials = get_company_initials(self.company_name)
        c.setFillColor(colors.HexColor("#e2e8f0"))
        c.setFont("Helvetica-Bold", 9)
        tw = c.stringWidth(initials, "Helvetica-Bold", 9)
        c.drawString(mark_x - tw / 2, mark_y - 3, initials)

        # Eyebrow
        c.setFillColor(colors.HexColor("#94a3b8"))
        c.setFont("Helvetica", 7.5)
        c.drawString(52, h - 26, "PAYROLL REPORT")

        # Company name
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 15)
        name = self.company_name[:42]
        c.drawString(52, h - 46, name)

        # Period + type
        c.setFillColor(colors.HexColor("#cbd5e1"))
        c.setFont("Helvetica", 8.5)
        type_label = (self.payroll_type or "").replace("_", " ").title()
        parts = [self.period_str]
        if self.pay_date_str:
            parts.append(f"Pay date {self.pay_date_str}")
        if type_label:
            parts.append(type_label)
        meta = "  ·  ".join(p for p in parts if p)
        c.drawString(52, 18, meta)

        # Status pill (right)
        status_label = (self.status or "Draft").strip().title()
        bg, fg = _status_colors(status_label)
        c.setFont("Helvetica-Bold", 8)
        label_w = c.stringWidth(status_label, "Helvetica-Bold", 8)
        pill_w = label_w + 18
        pill_h = 18
        pill_x = w - pill_w - 18
        pill_y = h - 36
        c.setFillColor(bg)
        c.roundRect(pill_x, pill_y, pill_w, pill_h, 9, fill=1, stroke=0)
        c.setFillColor(fg)
        c.drawString(pill_x + 9, pill_y + 5, status_label)


class AccentCard(Flowable):
    """KPI card with a colored top accent strip."""

    def __init__(self, value: str, label: str, accent, width, height=0.78 * inch):
        Flowable.__init__(self)
        self.value = value
        self.label = label
        self.accent = accent
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        w, h = self.width, self.height

        c.setFillColor(colors.HexColor("#f8fafc"))
        c.setStrokeColor(colors.HexColor("#e2e8f0"))
        c.setLineWidth(0.6)
        c.roundRect(0, 0, w, h, 5, fill=1, stroke=1)

        c.setFillColor(self.accent)
        c.rect(0, h - 3.5, w, 3.5, fill=1, stroke=0)

        c.setFillColor(colors.HexColor("#0f172a"))
        c.setFont("Helvetica-Bold", 13)
        vw = c.stringWidth(self.value, "Helvetica-Bold", 13)
        c.drawString((w - vw) / 2, h / 2 + 2, self.value)

        c.setFillColor(colors.HexColor("#64748b"))
        c.setFont("Helvetica", 7.5)
        lw = c.stringWidth(self.label, "Helvetica", 7.5)
        c.drawString((w - lw) / 2, 12, self.label)


def generate_payroll_report_pdf(
    company_name: str,
    payroll_type: str,
    period_start: date,
    period_end: date,
    generated_at: datetime,
    generated_by: str,
    status: str,
    rows: List[dict],
    pay_date: Optional[date] = None,
) -> bytes:
    """
    Generate professional payroll report PDF.

    rows keys: employee_name, regular_hours, ot_hours, rate,
               regular_pay, ot_pay, total_pay,
               pay_method (HOURLY | PER_ROOM), rooms_cleaned (per-room)
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.7 * inch,
    )
    story = []
    styles = getSampleStyleSheet()

    # Palette (slate / professional — matches admin UI)
    slate_900 = colors.HexColor("#0f172a")
    slate_700 = colors.HexColor("#334155")
    slate_500 = colors.HexColor("#64748b")
    slate_200 = colors.HexColor("#e2e8f0")
    slate_100 = colors.HexColor("#f1f5f9")
    slate_50 = colors.HexColor("#f8fafc")
    sky_500 = colors.HexColor("#0ea5e9")
    emerald_600 = colors.HexColor("#059669")
    amber_500 = colors.HexColor("#f59e0b")

    period_str = f"{period_start.strftime('%b %d, %Y')} – {period_end.strftime('%b %d, %Y')}"
    pay_date_str = pay_date.strftime("%b %d, %Y") if pay_date else ""
    generated_str = generated_at.strftime("%b %d, %Y · %I:%M %p")
    totals = compute_payroll_report_totals(rows)

    # ========== HERO ==========
    story.append(
        HeroBanner(
            company_name=company_name or "Company",
            period_str=period_str,
            payroll_type=payroll_type or "",
            status=status or "Draft",
            pay_date_str=pay_date_str,
        )
    )
    story.append(Spacer(1, 0.18 * inch))

    # ========== META STRIP ==========
    meta_label = ParagraphStyle(
        "MetaLabel",
        parent=styles["Normal"],
        fontSize=7,
        textColor=slate_500,
        fontName="Helvetica",
        leading=9,
    )
    meta_value = ParagraphStyle(
        "MetaValue",
        parent=styles["Normal"],
        fontSize=8.5,
        textColor=slate_900,
        fontName="Helvetica-Bold",
        leading=11,
    )

    meta_table = Table(
        [
            [
                Paragraph("GENERATED", meta_label),
                Paragraph("PREPARED BY", meta_label),
                Paragraph("PAY PERIOD", meta_label),
                Paragraph("PAY DATE", meta_label),
            ],
            [
                Paragraph(sanitize_html(generated_str), meta_value),
                Paragraph(sanitize_html(generated_by or "System"), meta_value),
                Paragraph(sanitize_html(period_str), meta_value),
                Paragraph(sanitize_html(pay_date_str or "—"), meta_value),
            ],
        ],
        colWidths=[1.85 * inch] * 4,
    )
    meta_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), slate_50),
                ("BOX", (0, 0), (-1, -1), 0.6, slate_200),
                ("LINEBELOW", (0, 0), (-1, 0), 0.4, slate_200),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("TOPPADDING", (0, 1), (-1, 1), 8),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(meta_table)
    story.append(Spacer(1, 0.22 * inch))

    # ========== KPI CARDS ==========
    card_w = 1.775 * inch
    gap = 0.1 * inch
    if totals["has_per_room"]:
        kpi_items = [
            AccentCard(f"{totals['employee_count']}", "Employees", sky_500, card_w),
            AccentCard(f"{totals['total_regular_hours']:,.1f}", "Regular Hours", slate_700, card_w),
            AccentCard(f"{totals['total_rooms']:,}", "Rooms Cleaned", amber_500, card_w),
            AccentCard(f"${totals['total_gross_pay']:,.2f}", "Gross Pay", emerald_600, card_w),
        ]
    else:
        kpi_items = [
            AccentCard(f"{totals['employee_count']}", "Employees", sky_500, card_w),
            AccentCard(f"{totals['total_regular_hours']:,.1f}", "Regular Hours", slate_700, card_w),
            AccentCard(f"{totals['total_ot_hours']:,.1f}", "Overtime Hours", amber_500, card_w),
            AccentCard(f"${totals['total_gross_pay']:,.2f}", "Gross Pay", emerald_600, card_w),
        ]
    kpi_row = Table(
        [kpi_items],
        colWidths=[card_w + gap] * 3 + [card_w],
    )
    kpi_row.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-2, -1), gap),
                ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(kpi_row)
    story.append(Spacer(1, 0.28 * inch))

    # ========== SECTION TITLE ==========
    section_style = ParagraphStyle(
        "SectionTitle",
        parent=styles["Normal"],
        fontSize=10,
        fontName="Helvetica-Bold",
        textColor=slate_900,
        spaceAfter=2,
        leading=12,
    )
    section_sub = ParagraphStyle(
        "SectionSub",
        parent=styles["Normal"],
        fontSize=7.5,
        textColor=slate_500,
        spaceAfter=8,
        leading=9,
    )
    story.append(Paragraph("Employee earnings", section_style))
    story.append(
        Paragraph(
            "Hours and pay by employee for this payroll period. Amounts shown in USD. "
            "Per-room employees are paid rooms cleaned × rate."
            if totals["has_per_room"]
            else "Hours and pay by employee for this payroll period. Amounts shown in USD.",
            section_sub,
        )
    )

    # ========== EMPLOYEE TABLE ==========
    header_cell = ParagraphStyle(
        "Hdr",
        parent=styles["Normal"],
        fontSize=7.5,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#e2e8f0"),
        alignment=TA_CENTER,
        leading=9,
    )
    header_left = ParagraphStyle(
        "HdrL",
        parent=header_cell,
        alignment=TA_LEFT,
    )
    cell_left = ParagraphStyle(
        "CellL",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica",
        textColor=slate_900,
        alignment=TA_LEFT,
        leading=10,
    )
    cell_center = ParagraphStyle(
        "CellC",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica",
        textColor=slate_700,
        alignment=TA_CENTER,
        leading=10,
    )
    cell_total = ParagraphStyle(
        "CellTot",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica-Bold",
        textColor=slate_900,
        alignment=TA_CENTER,
        leading=10,
    )
    totals_left = ParagraphStyle(
        "TotL",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica-Bold",
        textColor=colors.white,
        alignment=TA_LEFT,
        leading=10,
    )
    totals_center = ParagraphStyle(
        "TotC",
        parent=styles["Normal"],
        fontSize=7.5,
        fontName="Helvetica-Bold",
        textColor=colors.white,
        alignment=TA_CENTER,
        leading=10,
    )

    sorted_rows = sorted(rows, key=lambda r: str(r.get("employee_name", "")).lower())

    table_data = [
        [
            Paragraph("Employee", header_left),
            Paragraph("Hrs / Rms", header_cell),
            Paragraph("OT Hrs", header_cell),
            Paragraph("Rate", header_cell),
            Paragraph("Reg Pay", header_cell),
            Paragraph("OT Pay", header_cell),
            Paragraph("Total", header_cell),
        ]
    ]

    for row in sorted_rows:
        total_pay = float(row.get("total_pay", 0) or 0)
        per_room = _is_per_room_row(row)
        rooms = _row_rooms(row)
        if per_room:
            hours_cell = f"{rooms} rm" if rooms == 1 else f"{rooms} rms"
            ot_cell = "—"
            rate_cell = f"${float(row.get('rate', 0) or 0):,.2f}/rm"
        else:
            hours_cell = f"{float(row.get('regular_hours', 0) or 0):,.2f}"
            ot_cell = f"{float(row.get('ot_hours', 0) or 0):,.2f}"
            rate_cell = f"${float(row.get('rate', 0) or 0):,.2f}"

        table_data.append(
            [
                Paragraph(sanitize_html(str(row.get("employee_name", ""))), cell_left),
                Paragraph(hours_cell, cell_center),
                Paragraph(ot_cell, cell_center),
                Paragraph(rate_cell, cell_center),
                Paragraph(f"${float(row.get('regular_pay', 0) or 0):,.2f}", cell_center),
                Paragraph(f"${float(row.get('ot_pay', 0) or 0):,.2f}", cell_center),
                Paragraph(f"${total_pay:,.2f}", cell_total),
            ]
        )

    if totals["has_per_room"] and totals["total_rooms"]:
        hours_total = (
            f"{totals['total_regular_hours']:.1f}h · {totals['total_rooms']}rm"
            if totals["total_regular_hours"]
            else f"{totals['total_rooms']}rm"
        )
    else:
        hours_total = f"{totals['total_regular_hours']:.2f}"

    table_data.append(
        [
            Paragraph("TOTALS", totals_left),
            Paragraph(f"<nobr>{hours_total}</nobr>", totals_center),
            Paragraph(f"{totals['total_ot_hours']:,.2f}", totals_center),
            Paragraph("", totals_center),
            Paragraph(f"${totals['total_regular_pay']:,.2f}", totals_center),
            Paragraph(f"${totals['total_ot_pay']:,.2f}", totals_center),
            Paragraph(f"${totals['total_gross_pay']:,.2f}", totals_center),
        ]
    )

    col_widths = [
        1.70 * inch,
        1.15 * inch,
        0.70 * inch,
        0.90 * inch,
        0.95 * inch,
        0.90 * inch,
        1.10 * inch,
    ]
    table = Table(table_data, colWidths=col_widths, repeatRows=1)

    style_cmds = [
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), slate_900),
        ("TOPPADDING", (0, 0), (-1, 0), 9),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 9),
        # Body
        ("TOPPADDING", (0, 1), (-1, -2), 7),
        ("BOTTOMPADDING", (0, 1), (-1, -2), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, slate_50]),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, slate_200),
        # Totals
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#1e293b")),
        ("TOPPADDING", (0, -1), (-1, -1), 10),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 10),
        # Shared
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOX", (0, 0), (-1, -1), 0.6, slate_200),
    ]

    table.setStyle(TableStyle(style_cmds))
    story.append(table)

    # ========== FOOTER ==========
    def add_footer(canvas_obj, doc_obj):
        canvas_obj.saveState()
        y = 0.42 * inch

        canvas_obj.setStrokeColor(slate_200)
        canvas_obj.setLineWidth(0.8)
        canvas_obj.line(0.55 * inch, y + 14, 8.0 * inch, y + 14)

        canvas_obj.setFillColor(slate_500)
        canvas_obj.setFont("Helvetica", 7)
        canvas_obj.drawString(
            0.55 * inch,
            y,
            "Confidential · For internal payroll use only",
        )

        canvas_obj.setFont("Helvetica", 7)
        brand = "ClockInn Pro"
        canvas_obj.drawCentredString(4.25 * inch, y, brand)

        page_text = f"Page {canvas_obj.getPageNumber()}"
        tw = canvas_obj.stringWidth(page_text, "Helvetica", 7)
        canvas_obj.drawString(8.0 * inch - tw, y, page_text)
        canvas_obj.restoreState()

    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    buffer.seek(0)
    return buffer.read()
