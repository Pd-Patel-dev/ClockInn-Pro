"""
Professional Payroll Report PDF Generator

Generates a clean, professional payroll report PDF with:
- Header with company logo circle and metadata
- Summary cards
- Employee table with proper formatting
- Notes section
- Footer with confidentiality notice
"""
from typing import List
from datetime import datetime, date
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, 
    PageBreak, KeepTogether, Flowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import re


def sanitize_html(text: str) -> str:
    """Sanitize text for ReportLab Paragraph (supports basic XML tags like <b>)."""
    if not text:
        return ""
    text = str(text)
    # ReportLab Paragraph supports XML-style tags, but we should escape entities properly
    # Only escape & if it's not part of an entity
    # For now, just remove potentially dangerous tags and keep safe ones like <b>
    # Remove script tags and similar
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.IGNORECASE | re.DOTALL)
    # Replace & with &amp; only if not already an entity
    text = re.sub(r'&(?!\w+;)', '&amp;', text)
    return text


class CircularLogo(Flowable):
    """Draw a circular logo with company initials."""
    def __init__(self, initials: str, size: float = 0.4, color: str = "#2563eb"):
        Flowable.__init__(self)
        self.initials = initials.upper()[:2]
        self.size = size * inch
        self.color = colors.HexColor(color)
        self.width = self.size
        self.height = self.size
    
    def draw(self):
        canvas_obj = self.canv
        # Draw circle
        canvas_obj.setFillColor(self.color)
        canvas_obj.circle(
            self.size / 2,
            self.size / 2,
            self.size / 2,
            fill=1
        )
        # Draw initials
        canvas_obj.setFillColor(colors.white)
        canvas_obj.setFont("Helvetica-Bold", self.size * 0.4)
        text_width = canvas_obj.stringWidth(self.initials, "Helvetica-Bold", self.size * 0.4)
        canvas_obj.drawString(
            (self.size - text_width) / 2,
            self.size * 0.3,
            self.initials
        )


def get_company_initials(company_name: str) -> str:
    """Extract initials from company name."""
    if not company_name:
        return "CO"
    words = company_name.split()
    if len(words) == 1:
        return words[0][:2].upper()
    return "".join(w[0].upper() for w in words[:2])


def generate_payroll_report_pdf(
    company_name: str,
    payroll_type: str,
    period_start: date,
    period_end: date,
    generated_at: datetime,
    generated_by: str,
    status: str,
    rows: List[dict],
) -> bytes:
    """
    Generate professional payroll report PDF.
    
    Args:
        company_name: Company name
        payroll_type: Payroll type (WEEKLY, BIWEEKLY, etc.)
        period_start: Period start date
        period_end: Period end date
        generated_at: Generation timestamp
        generated_by: Name of person who generated report
        status: Payroll status (Draft, Finalized, etc.)
        rows: List of employee payroll data dicts with keys:
            - employee_name
            - regular_hours
            - ot_hours
            - rate
            - regular_pay
            - ot_pay
            - total_pay
            - exceptions
    
    Returns:
        PDF bytes
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.6*inch,
        rightMargin=0.6*inch,
        topMargin=0.65*inch,
        bottomMargin=0.65*inch,
    )
    story = []
    styles = getSampleStyleSheet()
    
    # Color scheme - refined professional palette
    primary_color = colors.HexColor('#2563eb')
    accent_blue = colors.HexColor('#1e40af')
    header_bg = colors.HexColor('#1e293b')
    light_bg = colors.HexColor('#f1f5f9')
    medium_gray = colors.HexColor('#cbd5e1')
    light_gray = colors.HexColor('#e2e8f0')
    muted_gray = colors.HexColor('#64748b')
    dark_gray = colors.HexColor('#334155')
    notes_bg = colors.HexColor('#eff6ff')
    border_gray = colors.HexColor('#e2e8f0')
    
    # ========== HEADER ==========
    # Create header table: Company Info | Metadata
    # Left side: Company info only (no logo)
    company_style = ParagraphStyle(
        'Company',
        parent=styles['Normal'],
        fontSize=14,
        fontName='Helvetica-Bold',
        textColor=header_bg,
        leftIndent=0,
        spaceAfter=3,
        leading=16,
    )
    title_style = ParagraphStyle(
        'Title',
        parent=styles['Normal'],
        fontSize=12,
        textColor=muted_gray,
        leftIndent=0,
        spaceAfter=0,
        leading=14,
    )
    
    company_text = f'<para leftIndent="0">{sanitize_html(company_name)}</para>'
    
    left_content = [
        [Paragraph(company_text, company_style)]
    ]
    
    # Right side: Metadata with improved styling
    meta_label_style = ParagraphStyle(
        'MetaLabel',
        parent=styles['Normal'],
        fontSize=7.5,
        textColor=muted_gray,
        alignment=TA_LEFT,
        fontName='Helvetica',
        leading=9,
    )
    meta_value_style = ParagraphStyle(
        'MetaValue',
        parent=styles['Normal'],
        fontSize=7.5,
        textColor=dark_gray,
        alignment=TA_LEFT,
        fontName='Helvetica-Bold',
        leading=9,
    )
    
    period_str = f"{period_start.strftime('%b %d, %Y')} - {period_end.strftime('%b %d, %Y')}"
    generated_str = generated_at.strftime('%b %d, %Y at %I:%M %p')
    
    metadata = [
        [Paragraph("<b>Payroll Type:</b>", meta_label_style), Paragraph(sanitize_html(payroll_type), meta_value_style)],
        [Paragraph("<b>Period:</b>", meta_label_style), Paragraph(sanitize_html(period_str), meta_value_style)],
        [Paragraph("<b>Status:</b>", meta_label_style), Paragraph(sanitize_html(status), meta_value_style)],
        [Paragraph("<b>Generated:</b>", meta_label_style), Paragraph(sanitize_html(generated_str), meta_value_style)],
        [Paragraph("<b>Generated By:</b>", meta_label_style), Paragraph(sanitize_html(generated_by), meta_value_style)],
    ]
    
    header_table = Table(
        [
            [
                Table(left_content, colWidths=[None]),
                Table(metadata, colWidths=[1.25*inch, 2.4*inch]),
            ]
        ],
        colWidths=[3.6*inch, 3.4*inch],
    )
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    
    story.append(header_table)
    story.append(Spacer(1, 0.2*inch))
    
    # Divider line - thicker and more prominent
    divider = Table([['']], colWidths=[6.8*inch], rowHeights=[2])
    divider.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 1.5, medium_gray),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(divider)
    story.append(Spacer(1, 0.25*inch))
    
    # Payroll Report title above KPIs
    report_title_style = ParagraphStyle(
        'ReportTitle',
        parent=styles['Normal'],
        fontSize=16,
        fontName='Helvetica-Bold',
        textColor=header_bg,
        alignment=TA_LEFT,
        spaceAfter=12,
        leading=19,
    )
    story.append(Paragraph("Payroll Report", report_title_style))
    
    # ========== SUMMARY CARDS ==========
    total_employees = len(rows)
    total_regular_hours = sum(float(row.get('regular_hours', 0)) for row in rows)
    total_ot_hours = sum(float(row.get('ot_hours', 0)) for row in rows)
    total_gross_pay = sum(float(row.get('total_pay', 0)) for row in rows)
    
    card_number_style = ParagraphStyle(
        'CardNumber',
        parent=styles['Normal'],
        fontSize=18,
        fontName='Helvetica-Bold',
        textColor=header_bg,
        alignment=TA_CENTER,
        spaceAfter=4,
        leading=21,
    )
    card_label_style = ParagraphStyle(
        'CardLabel',
        parent=styles['Normal'],
        fontSize=9.5,
        textColor=muted_gray,
        alignment=TA_CENTER,
        spaceAfter=0,
        fontName='Helvetica',
        leading=11,
    )
    
    summary_cards = Table([
        [
            [Paragraph(f"{total_employees}", card_number_style), Paragraph("Total Employees", card_label_style)],
            [Paragraph(f"{total_regular_hours:,.2f}", card_number_style), Paragraph("Regular Hours", card_label_style)],
            [Paragraph(f"{total_ot_hours:,.2f}", card_number_style), Paragraph("OT Hours", card_label_style)],
            [Paragraph(f"${total_gross_pay:,.2f}", card_number_style), Paragraph("Gross Pay", card_label_style)],
        ]
    ], colWidths=[1.7*inch] * 4)
    
    summary_cards.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, border_gray),
        ('BOX', (0, 0), (-1, -1), 0.5, border_gray),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 14),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 14),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    
    story.append(summary_cards)
    story.append(Spacer(1, 0.3*inch))
    
    # ========== EMPLOYEE TABLE ==========
    # Prepare table data
    table_data = []
    
    # Header row
    header_row = [
        "Employee",
        "Reg Hrs",
        "OT Hrs",
        "Rate",
        "Reg Pay",
        "OT Pay",
        "Total Pay"
    ]
    header_cell_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontSize=9.5,
        fontName='Helvetica-Bold',
        textColor=colors.white,
        alignment=TA_CENTER,
        leading=11,
    )
    table_data.append([Paragraph(sanitize_html(str(cell)), header_cell_style) for cell in header_row])
    
    # Data rows - improved styling
    cell_style_left = ParagraphStyle(
        'Cell',
        parent=styles['Normal'],
        fontSize=8.5,
        alignment=TA_LEFT,
        fontName='Helvetica',
        leading=10,
        textColor=dark_gray,
    )
    cell_style_right = ParagraphStyle(
        'Cell',
        parent=styles['Normal'],
        fontSize=8.5,
        alignment=TA_RIGHT,
        fontName='Helvetica',
        leading=10,
        textColor=dark_gray,
    )
    cell_style_center = ParagraphStyle(
        'Cell',
        parent=styles['Normal'],
        fontSize=8.5,
        alignment=TA_CENTER,
        fontName='Helvetica',
        leading=10,
        textColor=dark_gray,
    )
    
    for row in rows:
        employee_name = sanitize_html(str(row.get('employee_name', '')))
        regular_hours = float(row.get('regular_hours', 0))
        ot_hours = float(row.get('ot_hours', 0))
        rate = float(row.get('rate', 0))
        regular_pay = float(row.get('regular_pay', 0))
        ot_pay = float(row.get('ot_pay', 0))
        total_pay = float(row.get('total_pay', 0))
        
        table_data.append([
            Paragraph(employee_name, cell_style_left),
            Paragraph(f"{regular_hours:,.2f}", cell_style_right),
            Paragraph(f"{ot_hours:,.2f}", cell_style_right),
            Paragraph(f"${rate:,.2f}", cell_style_right),
            Paragraph(f"${regular_pay:,.2f}", cell_style_right),
            Paragraph(f"${ot_pay:,.2f}", cell_style_right),
            Paragraph(f"${total_pay:,.2f}", cell_style_right),
        ])
    
    # Totals row
    totals_style = ParagraphStyle(
        'Totals',
        parent=styles['Normal'],
        fontSize=9,
        fontName='Helvetica-Bold',
        textColor=colors.white,
        alignment=TA_CENTER,
    )
    totals_style_right = ParagraphStyle(
        'TotalsRight',
        parent=styles['Normal'],
        fontSize=9,
        fontName='Helvetica-Bold',
        textColor=colors.white,
        alignment=TA_RIGHT,
    )
    
    total_regular_pay = sum(float(row.get('regular_pay', 0)) for row in rows)
    total_ot_pay = sum(float(row.get('ot_pay', 0)) for row in rows)
    
    table_data.append([
        Paragraph("TOTALS", totals_style),
        Paragraph(f"{total_regular_hours:,.2f}", totals_style_right),
        Paragraph(f"{total_ot_hours:,.2f}", totals_style_right),
        Paragraph("", totals_style),
        Paragraph(f"${total_regular_pay:,.2f}", totals_style_right),
        Paragraph(f"${total_ot_pay:,.2f}", totals_style_right),
        Paragraph(f"${total_gross_pay:,.2f}", totals_style_right),
    ])
    
    # Create table with improved styling
    col_widths = [1.8*inch, 0.85*inch, 0.85*inch, 0.9*inch, 1.1*inch, 1.1*inch, 1.2*inch]
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    
    table.setStyle(TableStyle([
        # Header row - enhanced
        ('BACKGROUND', (0, 0), (-1, 0), header_bg),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9.5),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('LINEBELOW', (0, 0), (-1, 0), 2, header_bg),
        
        # Data rows - better spacing and zebra striping
        ('BACKGROUND', (0, 1), (-1, -2), colors.white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, light_bg]),
        ('TOPPADDING', (0, 1), (-1, -2), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -2), 8),
        
        # Alignment
        ('ALIGN', (0, 1), (0, -2), 'LEFT'),  # Employee name
        ('ALIGN', (1, 1), (6, -2), 'RIGHT'),  # Numeric columns
        
        # Totals row - enhanced
        ('BACKGROUND', (0, -1), (-1, -1), accent_blue),
        ('TEXTCOLOR', (0, -1), (-1, -1), colors.white),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, -1), (-1, -1), 9.5),
        ('TOPPADDING', (0, -1), (-1, -1), 12),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 12),
        ('LINEABOVE', (0, -1), (-1, -1), 2.5, accent_blue),
        ('ALIGN', (0, -1), (0, -1), 'LEFT'),
        ('ALIGN', (1, -1), (6, -1), 'RIGHT'),
        
        # Grid - refined borders
        ('GRID', (0, 0), (-1, -1), 0.5, border_gray),
        ('LINEBELOW', (0, 0), (-1, 0), 2, header_bg),
        ('LINEABOVE', (0, -1), (-1, -1), 2.5, accent_blue),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    
    story.append(table)
    story.append(Spacer(1, 0.3*inch))
    
    # ========== NOTES SECTION ==========
    notes_style = ParagraphStyle(
        'Notes',
        parent=styles['Normal'],
        fontSize=9,
        textColor=dark_gray,
        leftIndent=0,
        rightIndent=0,
        spaceAfter=4,
        leading=13,
    )
    
    notes_text = (
        "<b>Notes</b><br/>"
        "Exceptions are shown per-employee when applicable (e.g., missing punches, approvals pending). "
        "This report reflects the payroll as of the generated timestamp."
    )
    
    notes_table = Table([
        [Paragraph(notes_text, notes_style)]
    ], colWidths=[6.8*inch])
    
    notes_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), notes_bg),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#bfdbfe')),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LEFTPADDING', (0, 0), (-1, -1), 14),
        ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    story.append(notes_table)
    
    # ========== FOOTER ==========
    def add_footer(canvas_obj, doc):
        """Add footer with divider, confidentiality notice, and page number."""
        canvas_obj.saveState()
        
        # Draw divider line - more prominent
        canvas_obj.setStrokeColor(medium_gray)
        canvas_obj.setLineWidth(1)
        y = 0.55 * inch
        canvas_obj.line(0.6 * inch, y, 7.4 * inch, y)
        
        # Confidentiality notice (left) - improved styling
        canvas_obj.setFont("Helvetica", 8.5)
        canvas_obj.setFillColor(muted_gray)
        canvas_obj.drawString(0.6 * inch, y - 16, "Confidential - For internal use only")
        
        # Page number (right) - improved styling
        page_num = canvas_obj.getPageNumber()
        page_text = f"Page {page_num}"
        canvas_obj.setFont("Helvetica", 8.5)
        text_width = canvas_obj.stringWidth(page_text, "Helvetica", 8.5)
        canvas_obj.drawString(7.4 * inch - text_width, y - 16, page_text)
        
        canvas_obj.restoreState()
    
    # Build PDF
    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    buffer.seek(0)
    return buffer.read()

