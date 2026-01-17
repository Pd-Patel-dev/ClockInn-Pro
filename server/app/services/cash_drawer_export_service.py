"""
Cash Drawer Export Service

Generates PDF and Excel exports for cash drawer sessions.
"""
from typing import List
from uuid import UUID
from datetime import date, datetime
from io import BytesIO
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.cash_drawer import CashDrawerSession
from app.models.user import User
from app.models.company import Company
from app.services.company_service import get_company_settings


async def generate_cash_drawer_pdf(
    db: AsyncSession,
    company_id: UUID,
    sessions: List[CashDrawerSession],
    from_date: date,
    to_date: date,
) -> BytesIO:
    """Generate PDF report for cash drawer sessions."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    
    # Get company info
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    company_name = company.name if company else "Company"
    company_settings = get_company_settings(company) if company else {}
    currency = company_settings.get("cash_drawer_currency", "USD")
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.75*inch,
        rightMargin=0.75*inch,
        topMargin=0.75*inch,
        bottomMargin=0.75*inch,
    )
    story = []
    styles = getSampleStyleSheet()
    
    # Colors
    primary_color = colors.HexColor('#1e40af')
    dark_text = colors.HexColor('#1f2937')
    gray_text = colors.HexColor('#6b7280')
    light_gray = colors.HexColor('#f3f4f6')
    border_color = colors.HexColor('#e5e7eb')
    
    # Header
    header_style = ParagraphStyle(
        'Header',
        parent=styles['Normal'],
        fontSize=18,
        fontName='Helvetica-Bold',
        textColor=dark_text,
        spaceAfter=8,
        leading=22,
    )
    
    meta_style = ParagraphStyle(
        'Meta',
        parent=styles['Normal'],
        fontSize=9,
        textColor=gray_text,
        alignment=TA_RIGHT,
        leading=12,
    )
    
    period_str = f"{from_date.strftime('%b %d, %Y')} - {to_date.strftime('%b %d, %Y')}"
    generated_str = datetime.utcnow().strftime('%b %d, %Y at %I:%M %p')
    
    header_table = Table([
        [
            Paragraph(company_name, header_style),
            Paragraph(f"<b>Report Period:</b> {period_str}<br/><b>Generated:</b> {generated_str}", meta_style)
        ]
    ], colWidths=[4*inch, 2.5*inch])
    
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    
    story.append(header_table)
    story.append(Spacer(1, 0.15*inch))
    
    # Divider
    divider = Table([['']], colWidths=[6.5*inch], rowHeights=[1])
    divider.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 1, border_color),
    ]))
    story.append(divider)
    story.append(Spacer(1, 0.25*inch))
    
    # Table
    if sessions:
        table_data = []
        
        # Header
        header_style_cell = ParagraphStyle(
            'HeaderCell',
            parent=styles['Normal'],
            fontSize=10,
            fontName='Helvetica-Bold',
            textColor=colors.white,
            alignment=TA_CENTER,
            leading=12,
        )
        
        header_row = ["Date", "Employee", "Start Cash", "End Cash", "Delta", "Status"]
        table_data.append([Paragraph(cell, header_style_cell) for cell in header_row])
        
        # Data rows
        cell_style = ParagraphStyle(
            'Cell',
            parent=styles['Normal'],
            fontSize=9,
            alignment=TA_LEFT,
            fontName='Helvetica',
            leading=11,
            textColor=dark_text,
        )
        cell_style_right = ParagraphStyle(
            'CellRight',
            parent=styles['Normal'],
            fontSize=9,
            alignment=TA_RIGHT,
            fontName='Helvetica',
            leading=11,
            textColor=dark_text,
        )
        cell_style_center = ParagraphStyle(
            'CellCenter',
            parent=styles['Normal'],
            fontSize=9,
            alignment=TA_CENTER,
            fontName='Helvetica',
            leading=11,
            textColor=dark_text,
        )
        
        total_delta = 0
        for session in sessions:
            # Get employee name
            emp_result = await db.execute(
                select(User).where(User.id == session.employee_id)
            )
            employee = emp_result.scalar_one_or_none()
            emp_name = employee.name if employee else "Unknown"
            
            date_str = session.start_counted_at.strftime("%m/%d/%Y")
            start_cash = f"${session.start_cash_cents / 100:.2f}"
            end_cash = f"${session.end_cash_cents / 100:.2f}" if session.end_cash_cents else "N/A"
            delta = f"${session.delta_cents / 100:.2f}" if session.delta_cents is not None else "N/A"
            
            if session.delta_cents:
                total_delta += session.delta_cents
            
            table_data.append([
                Paragraph(date_str, cell_style),
                Paragraph(emp_name, cell_style),
                Paragraph(start_cash, cell_style_right),
                Paragraph(end_cash, cell_style_right),
                Paragraph(delta, cell_style_right),
                Paragraph(session.status.value, cell_style_center),
            ])
        
        # Totals row
        totals_style = ParagraphStyle(
            'Totals',
            parent=styles['Normal'],
            fontSize=10,
            fontName='Helvetica-Bold',
            textColor=colors.white,
            alignment=TA_RIGHT,
        )
        
        table_data.append([
            Paragraph("TOTAL", totals_style),
            Paragraph("", totals_style),
            Paragraph("", totals_style),
            Paragraph("", totals_style),
            Paragraph(f"${total_delta / 100:.2f}", totals_style),
            Paragraph("", totals_style),
        ])
        
        # Create table
        col_widths = [1.0*inch, 2.0*inch, 1.0*inch, 1.0*inch, 1.0*inch, 0.5*inch]
        table = Table(table_data, colWidths=col_widths)
        
        table.setStyle(TableStyle([
            # Header
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('TOPPADDING', (0, 0), (-1, 0), 10),
            
            # Data rows
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, light_gray]),
            ('TOPPADDING', (0, 1), (-1, -2), 8),
            ('BOTTOMPADDING', (0, 1), (-1, -2), 8),
            
            # Totals
            ('BACKGROUND', (0, -1), (-1, -1), primary_color),
            ('TEXTCOLOR', (0, -1), (-1, -1), colors.white),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, -1), (-1, -1), 10),
            ('TOPPADDING', (0, -1), (-1, -1), 10),
            ('BOTTOMPADDING', (0, -1), (-1, -1), 10),
            
            # Grid
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        
        story.append(table)
    else:
        no_data_style = ParagraphStyle(
            'NoData',
            parent=styles['Normal'],
            fontSize=10,
            textColor=gray_text,
            alignment=TA_CENTER,
        )
        story.append(Paragraph("No cash drawer sessions found for this period", no_data_style))
    
    # Footer
    def add_footer(canvas_obj, doc):
        canvas_obj.saveState()
        page_num = canvas_obj.getPageNumber()
        canvas_obj.setFont("Helvetica", 9)
        canvas_obj.setFillColor(gray_text)
        page_text = f"Page {page_num}"
        text_width = canvas_obj.stringWidth(page_text, "Helvetica", 9)
        page_width = doc.pagesize[0]
        canvas_obj.drawString((page_width - text_width) / 2, 0.5 * inch, page_text)
        canvas_obj.restoreState()
    
    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    buffer.seek(0)
    return buffer


async def generate_cash_drawer_excel(
    db: AsyncSession,
    company_id: UUID,
    sessions: List[CashDrawerSession],
    from_date: date,
    to_date: date,
) -> BytesIO:
    """Generate Excel report for cash drawer sessions."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    
    wb = Workbook()
    
    # Summary sheet
    summary_ws = wb.active
    summary_ws.title = "Summary"
    summary_ws.append(["Employee", "Total Sessions", "Total Delta"])
    
    # Style header
    header_fill = PatternFill(start_color="1e40af", end_color="1e40af", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    
    for cell in summary_ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    # Group by employee
    employee_totals = {}
    for session in sessions:
        emp_id = str(session.employee_id)
        if emp_id not in employee_totals:
            employee_totals[emp_id] = {
                "employee_id": session.employee_id,
                "count": 0,
                "total_delta": 0,
            }
        employee_totals[emp_id]["count"] += 1
        if session.delta_cents:
            employee_totals[emp_id]["total_delta"] += session.delta_cents
    
    # Get employee names and add to summary
    for emp_id, totals in employee_totals.items():
        emp_result = await db.execute(
            select(User).where(User.id == totals["employee_id"])
        )
        employee = emp_result.scalar_one_or_none()
        emp_name = employee.name if employee else "Unknown"
        summary_ws.append([
            emp_name,
            totals["count"],
            totals["total_delta"] / 100,
        ])
    
    # Detailed sheet
    detail_ws = wb.create_sheet("Detailed")
    detail_headers = ["Date", "Employee", "Start Cash", "End Cash", "Delta", "Status"]
    detail_ws.append(detail_headers)
    
    for cell in detail_ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    for session in sessions:
        emp_result = await db.execute(
            select(User).where(User.id == session.employee_id)
        )
        employee = emp_result.scalar_one_or_none()
        emp_name = employee.name if employee else "Unknown"
        
        detail_ws.append([
            session.start_counted_at.strftime("%m/%d/%Y"),
            emp_name,
            session.start_cash_cents / 100,
            session.end_cash_cents / 100 if session.end_cash_cents else None,
            session.delta_cents / 100 if session.delta_cents else None,
            session.status.value,
        ])
    
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer
