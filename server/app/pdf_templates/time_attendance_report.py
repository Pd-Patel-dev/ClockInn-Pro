"""
Professional Time & Attendance Report PDF Generator

Generates a clean, professional time attendance report PDF with:
- Header with company name and metadata
- One page per employee with summary cards, time entries table, and notes
- Footer with confidentiality notice
"""
from typing import List, Dict
from datetime import datetime, date
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, 
    PageBreak, Flowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas
import re


def sanitize_html(text: str) -> str:
    """Sanitize text for ReportLab Paragraph (supports basic XML tags like <b>)."""
    if not text:
        return ""
    text = str(text)
    # ReportLab Paragraph supports XML-style tags, but we should escape entities properly
    # Remove script tags and similar
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.IGNORECASE | re.DOTALL)
    # Replace & with &amp; only if not already an entity
    text = re.sub(r'&(?!\w+;)', '&amp;', text)
    return text


def capitalize_status(status: str) -> str:
    """Capitalize the first letter of status string."""
    if not status:
        return ""
    status_str = str(status).strip()
    if not status_str:
        return ""
    return status_str[0].upper() + status_str[1:].lower() if len(status_str) > 1 else status_str.upper()


def generate_time_attendance_report_pdf(
    company_name: str,
    period_start: date,
    period_end: date,
    generated_at: datetime,
    generated_by: str,
    employees_data: List[Dict],
) -> bytes:
    """
    Generate professional time attendance report PDF with one page per employee.
    
    Args:
        company_name: Company name
        period_start: Period start date
        period_end: Period end date
        generated_at: Generation timestamp
        generated_by: Name of person who generated report
        employees_data: List of employee data dicts, each containing:
            - employee_name: str
            - job_role: str (optional)
            - total_entries: int
            - total_hours: float
            - total_break_minutes: int
            - avg_hours_per_day: float
            - entries: List of time entry dicts with:
                - date: str
                - clock_in: str
                - clock_out: str
                - hours: float
                - break_minutes: int
                - status: str
    
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
    
    # Color scheme
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
    
    # Process each employee - one page per employee
    for emp_idx, emp_data in enumerate(employees_data):
        if emp_idx > 0:
            story.append(PageBreak())
        
        # ========== HEADER (same for all pages) ==========
        # Left side: Company info
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
        
        company_text = f'<para leftIndent="0">{sanitize_html(company_name)}</para>'
        left_content = [[Paragraph(company_text, company_style)]]
        
        # Right side: Metadata
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
            [Paragraph("<b>Period:</b>", meta_label_style), Paragraph(sanitize_html(period_str), meta_value_style)],
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
        
        # Divider line
        divider = Table([['']], colWidths=[6.8*inch], rowHeights=[2])
        divider.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 1.5, medium_gray),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        story.append(divider)
        story.append(Spacer(1, 0.25*inch))
        
        # Employee name and title
        employee_name = sanitize_html(str(emp_data.get('employee_name', 'Unknown')))
        job_role = sanitize_html(str(emp_data.get('job_role', '')))
        
        employee_title_style = ParagraphStyle(
            'EmployeeTitle',
            parent=styles['Normal'],
            fontSize=16,
            fontName='Helvetica-Bold',
            textColor=header_bg,
            alignment=TA_LEFT,
            spaceAfter=4,
            leading=19,
        )
        
        employee_title_text = employee_name
        if job_role:
            employee_title_text += f" <font color='{muted_gray}' size='12'>• {job_role}</font>"
        
        story.append(Paragraph(employee_title_text, employee_title_style))
        story.append(Spacer(1, 0.2*inch))
        
        # ========== SUMMARY CARDS ==========
        total_entries = emp_data.get('total_entries', 0)
        total_hours = float(emp_data.get('total_hours', 0))
        total_break_minutes = int(emp_data.get('total_break_minutes', 0))
        avg_hours = float(emp_data.get('avg_hours_per_day', 0))
        
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
                [Paragraph(f"{total_entries}", card_number_style), Paragraph("Total Entries", card_label_style)],
                [Paragraph(f"{total_hours:,.2f}", card_number_style), Paragraph("Total Hours", card_label_style)],
                [Paragraph(f"{total_break_minutes}", card_number_style), Paragraph("Break (min)", card_label_style)],
                [Paragraph(f"{avg_hours:.2f}", card_number_style), Paragraph("Avg Hours/Day", card_label_style)],
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
        
        # ========== TIME ENTRIES TABLE ==========
        entries = emp_data.get('entries', [])
        
        if entries:
            table_data = []
            
            # Header row
            header_row = [
                "Date",
                "Clock In",
                "Clock Out",
                "Hours",
                "Break",
                "Status"
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
            
            # Data rows
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
            
            for entry in entries:
                date_str = sanitize_html(str(entry.get('date', '')))
                clock_in = sanitize_html(str(entry.get('clock_in', '')))
                clock_out = sanitize_html(str(entry.get('clock_out', 'Open')))
                hours = float(entry.get('hours', 0))
                break_minutes = int(entry.get('break_minutes', 0))
                status_raw = str(entry.get('status', ''))
                status = sanitize_html(capitalize_status(status_raw))
                
                table_data.append([
                    Paragraph(date_str, cell_style_left),
                    Paragraph(clock_in, cell_style_center),
                    Paragraph(clock_out, cell_style_center),
                    Paragraph(f"{hours:.2f}", cell_style_right),
                    Paragraph(f"{break_minutes} min", cell_style_right),
                    Paragraph(status, cell_style_center),
                ])
            
            # Totals row
            totals_style = ParagraphStyle(
                'Totals',
                parent=styles['Normal'],
                fontSize=9.5,
                fontName='Helvetica-Bold',
                textColor=colors.white,
                alignment=TA_CENTER,
            )
            totals_style_right = ParagraphStyle(
                'TotalsRight',
                parent=styles['Normal'],
                fontSize=9.5,
                fontName='Helvetica-Bold',
                textColor=colors.white,
                alignment=TA_RIGHT,
            )
            
            table_data.append([
                Paragraph("TOTALS", totals_style),
                Paragraph("", totals_style),
                Paragraph("", totals_style),
                Paragraph(f"{total_hours:,.2f}", totals_style_right),
                Paragraph(f"{total_break_minutes} min", totals_style_right),
                Paragraph("", totals_style),
            ])
            
            # Create table
            col_widths = [1.3*inch, 1.1*inch, 1.1*inch, 0.9*inch, 0.9*inch, 1.0*inch]
            table = Table(table_data, colWidths=col_widths)
            
            table.setStyle(TableStyle([
                # Header row
                ('BACKGROUND', (0, 0), (-1, 0), header_bg),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9.5),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('TOPPADDING', (0, 0), (-1, 0), 12),
                ('LINEBELOW', (0, 0), (-1, 0), 2, header_bg),
                
                # Data rows
                ('BACKGROUND', (0, 1), (-1, -2), colors.white),
                ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, light_bg]),
                ('TOPPADDING', (0, 1), (-1, -2), 8),
                ('BOTTOMPADDING', (0, 1), (-1, -2), 8),
                
                # Alignment
                ('ALIGN', (0, 1), (0, -2), 'LEFT'),  # Date
                ('ALIGN', (1, 1), (2, -2), 'CENTER'),  # Clock in/out
                ('ALIGN', (3, 1), (4, -2), 'RIGHT'),  # Hours, Break
                ('ALIGN', (5, 1), (5, -2), 'CENTER'),  # Status
                
                # Totals row
                ('BACKGROUND', (0, -1), (-1, -1), accent_blue),
                ('TEXTCOLOR', (0, -1), (-1, -1), colors.white),
                ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, -1), (-1, -1), 9.5),
                ('TOPPADDING', (0, -1), (-1, -1), 12),
                ('BOTTOMPADDING', (0, -1), (-1, -1), 12),
                ('LINEABOVE', (0, -1), (-1, -1), 2.5, accent_blue),
                ('ALIGN', (0, -1), (2, -1), 'LEFT'),
                ('ALIGN', (3, -1), (4, -1), 'RIGHT'),
                
                # Grid
                ('GRID', (0, 0), (-1, -1), 0.5, border_gray),
                ('LINEBELOW', (0, 0), (-1, 0), 2, header_bg),
                ('LINEABOVE', (0, -1), (-1, -1), 2.5, accent_blue),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
                ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ]))
            
            story.append(table)
        else:
            # No entries message
            no_entries_style = ParagraphStyle(
                'NoEntries',
                parent=styles['Normal'],
                fontSize=10,
                textColor=muted_gray,
                alignment=TA_CENTER,
                spaceAfter=20,
            )
            story.append(Paragraph("No time entries found for this period", no_entries_style))
        
        story.append(Spacer(1, 0.25*inch))
        
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
            "Hours are calculated based on company rounding policy. Open entries indicate clock-in without clock-out. "
            "This report reflects time entries as of the generated timestamp."
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
        
        # Draw divider line
        canvas_obj.setStrokeColor(medium_gray)
        canvas_obj.setLineWidth(1)
        y = 0.55 * inch
        canvas_obj.line(0.6 * inch, y, 7.4 * inch, y)
        
        # Confidentiality notice (left)
        canvas_obj.setFont("Helvetica", 8.5)
        canvas_obj.setFillColor(muted_gray)
        canvas_obj.drawString(0.6 * inch, y - 16, "Confidential - For internal use only")
        
        # Page number (right)
        page_num = canvas_obj.getPageNumber()
        page_text = f"Page {page_num}"
        text_width = canvas_obj.stringWidth(page_text, "Helvetica", 8.5)
        canvas_obj.drawString(7.4 * inch - text_width, y - 16, page_text)
        
        canvas_obj.restoreState()
    
    # Build PDF
    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    buffer.seek(0)
    return buffer.read()

