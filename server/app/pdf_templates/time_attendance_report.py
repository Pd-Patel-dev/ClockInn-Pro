"""
Professional Time & Attendance Report PDF Generator

Slate visual language aligned with ClockInn payroll exports:
- Cover page with company hero, period meta, and roster summary
- One page per employee with KPIs and punch table
- Confidential footer with page numbers
"""
from typing import List, Dict
from datetime import datetime, date
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    PageBreak,
    Flowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
import re

CONTENT_WIDTH = 7.4 * inch


def sanitize_html(text: str) -> str:
    """Sanitize text for ReportLab Paragraph."""
    if not text:
        return ""
    text = str(text)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"&(?!\w+;)", "&amp;", text)
    return text


def capitalize_status(status: str) -> str:
    """Capitalize status for display."""
    if not status:
        return ""
    status_str = str(status).strip()
    if not status_str:
        return ""
    return status_str[0].upper() + status_str[1:].lower() if len(status_str) > 1 else status_str.upper()


def get_company_initials(company_name: str) -> str:
    if not company_name:
        return "CO"
    words = company_name.split()
    if len(words) == 1:
        return words[0][:2].upper()
    return "".join(w[0].upper() for w in words[:2])


def get_name_initials(name: str) -> str:
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


class HeroBanner(Flowable):
    """Full-width slate hero for cover / section headers."""

    def __init__(
        self,
        eyebrow: str,
        title: str,
        subtitle: str,
        width: float = CONTENT_WIDTH,
        height: float = 1.15 * inch,
        mark: str = "",
    ):
        Flowable.__init__(self)
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
        self.width = width
        self.height = height
        self.mark = mark

    def draw(self):
        c = self.canv
        w, h = self.width, self.height

        c.setFillColor(colors.HexColor("#0f172a"))
        c.roundRect(0, 0, w, h, 8, fill=1, stroke=0)

        c.setFillColor(colors.HexColor("#38bdf8"))
        c.rect(0, 0, 4, h, fill=1, stroke=0)

        mark = self.mark or get_company_initials(self.title)
        mark_x, mark_y, mark_r = 28, h / 2, 16
        c.setFillColor(colors.HexColor("#1e293b"))
        c.circle(mark_x, mark_y, mark_r, fill=1, stroke=0)
        c.setStrokeColor(colors.HexColor("#334155"))
        c.setLineWidth(1)
        c.circle(mark_x, mark_y, mark_r, fill=0, stroke=1)
        c.setFillColor(colors.HexColor("#e2e8f0"))
        c.setFont("Helvetica-Bold", 9)
        tw = c.stringWidth(mark, "Helvetica-Bold", 9)
        c.drawString(mark_x - tw / 2, mark_y - 3, mark)

        c.setFillColor(colors.HexColor("#94a3b8"))
        c.setFont("Helvetica", 7.5)
        c.drawString(52, h - 26, self.eyebrow.upper())

        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(52, h - 46, self.title[:48])

        c.setFillColor(colors.HexColor("#cbd5e1"))
        c.setFont("Helvetica", 8.5)
        c.drawString(52, 18, self.subtitle[:90])


class AccentCard(Flowable):
    """KPI card with colored top accent."""

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


def _status_row_tint(status: str):
    key = (status or "").strip().upper()
    if key in ("APPROVED", "CLOSED", "FINALIZED"):
        return None
    if key in ("PENDING", "OPEN"):
        return colors.HexColor("#fffbeb")  # soft amber
    if key in ("REJECTED", "VOID", "DISPUTED"):
        return colors.HexColor("#fef2f2")
    return None


def generate_time_attendance_report_pdf(
    company_name: str,
    period_start: date,
    period_end: date,
    generated_at: datetime,
    generated_by: str,
    employees_data: List[Dict],
) -> bytes:
    """
    Generate professional time attendance report PDF.

    employees_data items:
      employee_name, job_role, total_entries, total_hours,
      total_break_minutes, avg_hours_per_day, entries[]
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

    slate_900 = colors.HexColor("#0f172a")
    slate_800 = colors.HexColor("#1e293b")
    slate_700 = colors.HexColor("#334155")
    slate_500 = colors.HexColor("#64748b")
    slate_200 = colors.HexColor("#e2e8f0")
    slate_50 = colors.HexColor("#f8fafc")
    sky_500 = colors.HexColor("#0ea5e9")
    emerald_600 = colors.HexColor("#059669")
    amber_500 = colors.HexColor("#f59e0b")
    violet_ish = colors.HexColor("#475569")  # slate, not purple

    period_str = f"{period_start.strftime('%b %d, %Y')} – {period_end.strftime('%b %d, %Y')}"
    generated_str = generated_at.strftime("%b %d, %Y · %I:%M %p")
    company = company_name or "Company"

    total_employees = len(employees_data)
    total_hours_all = sum(float(e.get("total_hours", 0) or 0) for e in employees_data)
    total_entries_all = sum(int(e.get("total_entries", 0) or 0) for e in employees_data)
    total_break_all = sum(int(e.get("total_break_minutes", 0) or 0) for e in employees_data)

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
    emp_name_style = ParagraphStyle(
        "EmpName",
        parent=styles["Normal"],
        fontSize=14,
        fontName="Helvetica-Bold",
        textColor=slate_900,
        spaceAfter=2,
        leading=17,
    )
    emp_role_style = ParagraphStyle(
        "EmpRole",
        parent=styles["Normal"],
        fontSize=9,
        textColor=slate_500,
        spaceAfter=10,
        leading=11,
    )

    # ========== COVER ==========
    story.append(
        HeroBanner(
            eyebrow="Time & Attendance Report",
            title=company,
            subtitle=f"{period_str}  ·  Prepared by {generated_by or 'System'}",
            mark=get_company_initials(company),
        )
    )
    story.append(Spacer(1, 0.18 * inch))

    meta_table = Table(
        [
            [
                Paragraph("GENERATED", meta_label),
                Paragraph("PREPARED BY", meta_label),
                Paragraph("EMPLOYEES", meta_label),
                Paragraph("PAY PERIOD", meta_label),
            ],
            [
                Paragraph(sanitize_html(generated_str), meta_value),
                Paragraph(sanitize_html(generated_by or "System"), meta_value),
                Paragraph(str(total_employees), meta_value),
                Paragraph(sanitize_html(period_str), meta_value),
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
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
                ("TOPPADDING", (0, 1), (-1, 1), 2),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(meta_table)
    story.append(Spacer(1, 0.22 * inch))

    card_w = 1.775 * inch
    gap = 0.1 * inch
    kpi_row = Table(
        [
            [
                AccentCard(f"{total_employees}", "Employees", sky_500, card_w),
                AccentCard(f"{total_entries_all}", "Time Entries", violet_ish, card_w),
                AccentCard(f"{total_hours_all:,.1f}", "Total Hours", emerald_600, card_w),
                AccentCard(f"{total_break_all}", "Break Minutes", amber_500, card_w),
            ]
        ],
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

    story.append(Paragraph("Roster summary", section_style))
    story.append(
        Paragraph(
            "Hours and entry counts by employee for this period. Detail pages follow.",
            section_sub,
        )
    )

    header_cell = ParagraphStyle(
        "Hdr",
        parent=styles["Normal"],
        fontSize=7.5,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#e2e8f0"),
        alignment=TA_CENTER,
        leading=9,
    )
    header_left = ParagraphStyle("HdrL", parent=header_cell, alignment=TA_LEFT)
    cell_left = ParagraphStyle(
        "CellL",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica",
        textColor=slate_900,
        alignment=TA_LEFT,
        leading=10,
    )
    cell_right = ParagraphStyle(
        "CellR",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica",
        textColor=slate_700,
        alignment=TA_RIGHT,
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
    totals_left = ParagraphStyle(
        "TotL",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica-Bold",
        textColor=colors.white,
        alignment=TA_LEFT,
        leading=10,
    )
    totals_right = ParagraphStyle(
        "TotR",
        parent=styles["Normal"],
        fontSize=8,
        fontName="Helvetica-Bold",
        textColor=colors.white,
        alignment=TA_RIGHT,
        leading=10,
    )

    summary_data = [
        [
            Paragraph("Employee", header_left),
            Paragraph("Role", header_left),
            Paragraph("Entries", header_cell),
            Paragraph("Hours", header_cell),
            Paragraph("Break", header_cell),
            Paragraph("Avg/Day", header_cell),
        ]
    ]

    sorted_emps = sorted(employees_data, key=lambda e: str(e.get("employee_name", "")).lower())
    for emp in sorted_emps:
        summary_data.append(
            [
                Paragraph(sanitize_html(str(emp.get("employee_name", ""))), cell_left),
                Paragraph(sanitize_html(str(emp.get("job_role", "") or "—")), cell_left),
                Paragraph(str(int(emp.get("total_entries", 0) or 0)), cell_center),
                Paragraph(f"{float(emp.get('total_hours', 0) or 0):,.2f}", cell_right),
                Paragraph(str(int(emp.get("total_break_minutes", 0) or 0)), cell_right),
                Paragraph(f"{float(emp.get('avg_hours_per_day', 0) or 0):,.2f}", cell_right),
            ]
        )

    summary_data.append(
        [
            Paragraph("TOTALS", totals_left),
            Paragraph("", totals_left),
            Paragraph(str(total_entries_all), totals_right),
            Paragraph(f"{total_hours_all:,.2f}", totals_right),
            Paragraph(str(total_break_all), totals_right),
            Paragraph("", totals_right),
        ]
    )

    summary_table = Table(
        summary_data,
        colWidths=[1.7 * inch, 1.5 * inch, 0.85 * inch, 0.95 * inch, 0.85 * inch, 0.95 * inch],
        repeatRows=1,
    )
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), slate_900),
                ("TOPPADDING", (0, 0), (-1, 0), 9),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 9),
                ("TOPPADDING", (0, 1), (-1, -2), 6),
                ("BOTTOMPADDING", (0, 1), (-1, -2), 6),
                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, slate_50]),
                ("LINEBELOW", (0, 1), (-1, -2), 0.4, slate_200),
                ("BACKGROUND", (0, -1), (-1, -1), slate_800),
                ("TOPPADDING", (0, -1), (-1, -1), 9),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("BOX", (0, 0), (-1, -1), 0.6, slate_200),
            ]
        )
    )
    story.append(summary_table)

    notes = ParagraphStyle(
        "Notes",
        parent=styles["Normal"],
        fontSize=7.5,
        textColor=slate_500,
        leading=10,
    )
    story.append(Spacer(1, 0.22 * inch))
    notes_table = Table(
        [
            [
                Paragraph(
                    "<b>Notes</b><br/>Hours reflect company rounding and break policies. "
                    "Open shifts show 0.00 hours until clocked out. "
                    "Confidential — for internal use only.",
                    notes,
                )
            ]
        ],
        colWidths=[CONTENT_WIDTH],
    )
    notes_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), slate_50),
                ("BOX", (0, 0), (-1, -1), 0.5, slate_200),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    story.append(notes_table)

    # ========== EMPLOYEE PAGES ==========
    for emp in sorted_emps:
        story.append(PageBreak())

        emp_name = str(emp.get("employee_name", "Unknown"))
        job_role = str(emp.get("job_role", "") or "")
        role_bit = f"  ·  {job_role}" if job_role else ""

        story.append(
            HeroBanner(
                eyebrow="Employee Time Report",
                title=emp_name,
                subtitle=f"{period_str}{role_bit}",
                height=1.05 * inch,
                mark=get_name_initials(emp_name),
            )
        )
        story.append(Spacer(1, 0.16 * inch))

        story.append(Paragraph(sanitize_html(emp_name), emp_name_style))
        story.append(Paragraph(sanitize_html(job_role) if job_role else "Team member", emp_role_style))

        total_entries = int(emp.get("total_entries", 0) or 0)
        total_hours = float(emp.get("total_hours", 0) or 0)
        total_break_minutes = int(emp.get("total_break_minutes", 0) or 0)
        avg_hours = float(emp.get("avg_hours_per_day", 0) or 0)

        emp_kpis = Table(
            [
                [
                    AccentCard(f"{total_entries}", "Entries", sky_500, card_w),
                    AccentCard(f"{total_hours:,.2f}", "Total Hours", emerald_600, card_w),
                    AccentCard(f"{total_break_minutes}", "Break (min)", amber_500, card_w),
                    AccentCard(f"{avg_hours:,.2f}", "Avg Hours/Day", violet_ish, card_w),
                ]
            ],
            colWidths=[card_w + gap] * 3 + [card_w],
        )
        emp_kpis.setStyle(
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
        story.append(emp_kpis)
        story.append(Spacer(1, 0.24 * inch))

        story.append(Paragraph("Time entries", section_style))
        story.append(Paragraph("Clock in / out punches for this period.", section_sub))

        entries = emp.get("entries", []) or []
        if entries:
            table_data = [
                [
                    Paragraph("Date", header_left),
                    Paragraph("Clock In", header_cell),
                    Paragraph("Clock Out", header_cell),
                    Paragraph("Hours", header_cell),
                    Paragraph("Break", header_cell),
                    Paragraph("Status", header_cell),
                ]
            ]

            for entry in entries:
                table_data.append(
                    [
                        Paragraph(sanitize_html(str(entry.get("date", ""))), cell_left),
                        Paragraph(sanitize_html(str(entry.get("clock_in", ""))), cell_center),
                        Paragraph(sanitize_html(str(entry.get("clock_out", "Open"))), cell_center),
                        Paragraph(f"{float(entry.get('hours', 0) or 0):.2f}", cell_right),
                        Paragraph(str(int(entry.get("break_minutes", 0) or 0)), cell_right),
                        Paragraph(
                            sanitize_html(capitalize_status(str(entry.get("status", "")))),
                            cell_center,
                        ),
                    ]
                )

            table_data.append(
                [
                    Paragraph("TOTAL", totals_left),
                    Paragraph("", totals_left),
                    Paragraph("", totals_left),
                    Paragraph(f"{total_hours:.2f}", totals_right),
                    Paragraph(f"{total_break_minutes}", totals_right),
                    Paragraph("", totals_left),
                ]
            )

            table = Table(
                table_data,
                colWidths=[1.55 * inch, 1.1 * inch, 1.1 * inch, 0.9 * inch, 0.85 * inch, 1.1 * inch],
                repeatRows=1,
            )

            style_cmds = [
                ("BACKGROUND", (0, 0), (-1, 0), slate_900),
                ("TOPPADDING", (0, 0), (-1, 0), 9),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 9),
                ("TOPPADDING", (0, 1), (-1, -2), 6),
                ("BOTTOMPADDING", (0, 1), (-1, -2), 6),
                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, slate_50]),
                ("LINEBELOW", (0, 1), (-1, -2), 0.4, slate_200),
                ("BACKGROUND", (0, -1), (-1, -1), slate_800),
                ("TOPPADDING", (0, -1), (-1, -1), 9),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("BOX", (0, 0), (-1, -1), 0.6, slate_200),
            ]

            for i, entry in enumerate(entries, start=1):
                tint = _status_row_tint(str(entry.get("status", "")))
                if tint is not None:
                    style_cmds.append(("BACKGROUND", (0, i), (-1, i), tint))

            table.setStyle(TableStyle(style_cmds))
            story.append(table)
        else:
            empty = ParagraphStyle(
                "Empty",
                parent=styles["Normal"],
                fontSize=9,
                textColor=slate_500,
                alignment=TA_CENTER,
            )
            empty_box = Table(
                [[Paragraph("No time entries found for this period.", empty)]],
                colWidths=[CONTENT_WIDTH],
            )
            empty_box.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), slate_50),
                        ("BOX", (0, 0), (-1, -1), 0.5, slate_200),
                        ("TOPPADDING", (0, 0), (-1, -1), 18),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
                    ]
                )
            )
            story.append(empty_box)

    def add_footer(canvas_obj, doc_obj):
        canvas_obj.saveState()
        y = 0.42 * inch
        canvas_obj.setStrokeColor(slate_200)
        canvas_obj.setLineWidth(0.8)
        canvas_obj.line(0.55 * inch, y + 14, 8.0 * inch, y + 14)

        canvas_obj.setFillColor(slate_500)
        canvas_obj.setFont("Helvetica", 7)
        canvas_obj.drawString(0.55 * inch, y, "Confidential · For internal use only")
        canvas_obj.drawCentredString(4.25 * inch, y, "ClockInn Pro")
        page_text = f"Page {canvas_obj.getPageNumber()}"
        tw = canvas_obj.stringWidth(page_text, "Helvetica", 7)
        canvas_obj.drawString(8.0 * inch - tw, y, page_text)
        canvas_obj.restoreState()

    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    buffer.seek(0)
    return buffer.read()
