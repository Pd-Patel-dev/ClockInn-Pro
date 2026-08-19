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
import re

from app.models.cash_drawer import CashDrawerSession
from app.models.user import User
from app.models.company import Company
from app.services.cash_drawer_service import (
    expected_balance_cents,
    resolve_current_cash_cents,
)


def sanitize_html(text: str) -> str:
    """Sanitize text for ReportLab Paragraph."""
    if not text:
        return ""
    text = str(text)
    # Remove script tags
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.IGNORECASE | re.DOTALL)
    # Escape & if not already an entity
    text = re.sub(r'&(?!\w+;)', '&amp;', text)
    # Remove path-like characters that might confuse reportlab (but keep / for dates)
    text = re.sub(r'[<>:"|?*\\]', '', text)
    return text


async def generate_cash_drawer_pdf(
    db: AsyncSession,
    company_id: UUID,
    sessions: List[CashDrawerSession],
    from_date: date,
    to_date: date,
) -> BytesIO:
    """Generate PDF report for cash drawer sessions."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.enums import TA_CENTER
    
    buffer = BytesIO()
    
    # Get company name
    company_result = await db.execute(select(Company).where(Company.id == company_id))
    company = company_result.scalar_one_or_none()
    company_name = company.name if company else "Company"
    
    # Create PDF
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(letter),
        rightMargin=0.4*inch,
        leftMargin=0.4*inch,
        topMargin=0.4*inch,
        bottomMargin=0.4*inch
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=14,
        alignment=TA_CENTER,
        spaceAfter=6
    )
    subtitle_style = ParagraphStyle(
        'Subtitle',
        parent=styles['Normal'],
        fontSize=9,
        alignment=TA_CENTER,
        textColor=colors.grey,
        spaceAfter=12
    )
    
    header_bg = colors.HexColor('#374151')
    story = []
    
    period_str = f"{from_date.strftime('%m/%d/%Y')} - {to_date.strftime('%m/%d/%Y')}"
    
    story.append(Paragraph(f"{company_name} - Cash Drawer Report", title_style))
    story.append(Paragraph(f"Period: {period_str} | Generated: {datetime.utcnow().strftime('%m/%d/%Y %I:%M %p')}", subtitle_style))
    story.append(Spacer(1, 0.2*inch))
    
    # Balance / Expected = current − drop (cash after drop)
    if sessions:
        table_data = [["Date", "Employee", "Start", "Current", "Drop", "After Drop", "End", "+/-", "Status"]]
        
        total_delta = 0
        total_start = 0
        total_end = 0
        
        for session in sessions:
            # Get employee name
            emp_result = await db.execute(select(User).where(User.id == session.employee_id))
            employee = emp_result.scalar_one_or_none()
            emp_name = str(employee.name)[:15] if employee and employee.name else "Unknown"
            
            date_str = session.start_counted_at.strftime("%m/%d/%y")
            start_cash = f"${session.start_cash_cents / 100:.0f}"
            current = resolve_current_cash_cents(session)
            current_str = f"${current / 100:.0f}" if current is not None else "-"
            drop_cash = f"${(session.drop_amount_cents or 0) / 100:.0f}"
            expected = expected_balance_cents(session)
            after_drop_str = f"${expected / 100:.0f}" if expected is not None and session.end_cash_cents is not None else "-"
            end_cash = f"${session.end_cash_cents / 100:.0f}" if session.end_cash_cents else "-"
            
            delta_val = session.delta_cents or 0
            if delta_val > 0:
                delta_str = f"+${delta_val / 100:.0f}"
            elif delta_val < 0:
                delta_str = f"-${abs(delta_val) / 100:.0f}"
            else:
                delta_str = "$0"
            
            status = "Open" if session.status.value == "OPEN" else "OK" if session.status.value == "CLOSED" else "Review"
            
            total_delta += delta_val
            total_start += session.start_cash_cents
            if session.end_cash_cents:
                total_end += session.end_cash_cents
            
            table_data.append([
                date_str, emp_name, start_cash, current_str, drop_cash,
                after_drop_str, end_cash, delta_str, status,
            ])
        
        # Totals row
        total_delta_str = f"+${total_delta / 100:.0f}" if total_delta >= 0 else f"-${abs(total_delta) / 100:.0f}"
        table_data.append([
            "TOTAL", f"{len(sessions)} sessions", f"${total_start / 100:.0f}",
            "-", "-", "-", f"${total_end / 100:.0f}", total_delta_str, "",
        ])
        
        col_widths = [0.65*inch, 1.1*inch, 0.6*inch, 0.65*inch, 0.55*inch, 0.7*inch, 0.55*inch, 0.55*inch, 0.55*inch]
        table = Table(table_data, colWidths=col_widths)
        
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), header_bg),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('ALIGN', (2, 1), (7, -1), 'RIGHT'),
            ('ALIGN', (8, 1), (8, -1), 'CENTER'),
            ('BACKGROUND', (0, -1), (-1, -1), header_bg),
            ('TEXTCOLOR', (0, -1), (-1, -1), colors.white),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 3),
            ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ]))
        
        story.append(table)
    else:
        story.append(Paragraph("No cash drawer sessions found for this period", styles['Normal']))
    
    try:
        doc.build(story)
        buffer.seek(0)
        return buffer
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Error building PDF: {str(e)}", exc_info=True)
        raise ValueError(f"Failed to generate PDF: {str(e)}")


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
    ws = wb.active
    ws.title = "Cash Drawer"
    
    headers = ["Date", "Employee", "Start", "Current", "Drop", "After Drop", "End", "+/-", "Status"]
    ws.append(headers)
    
    header_fill = PatternFill(start_color="374151", end_color="374151", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=9)
    
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    for session in sessions:
        emp_result = await db.execute(select(User).where(User.id == session.employee_id))
        employee = emp_result.scalar_one_or_none()
        emp_name = employee.name if employee else "Unknown"
        
        status = "Open" if session.status.value == "OPEN" else "OK" if session.status.value == "CLOSED" else "Review"
        current = resolve_current_cash_cents(session) if session.end_cash_cents is not None else None
        expected = expected_balance_cents(session) if session.end_cash_cents is not None else None
        
        ws.append([
            session.start_counted_at.strftime("%m/%d/%y"),
            emp_name,
            session.start_cash_cents / 100,
            current / 100 if current is not None else None,
            (session.drop_amount_cents or 0) / 100,
            expected / 100 if expected is not None else None,
            session.end_cash_cents / 100 if session.end_cash_cents else None,
            session.delta_cents / 100 if session.delta_cents else 0,
            status,
        ])
    
    ws.column_dimensions['A'].width = 10
    ws.column_dimensions['B'].width = 15
    ws.column_dimensions['C'].width = 8
    ws.column_dimensions['D'].width = 9
    ws.column_dimensions['E'].width = 8
    ws.column_dimensions['F'].width = 10
    ws.column_dimensions['G'].width = 8
    ws.column_dimensions['H'].width = 8
    ws.column_dimensions['I'].width = 8
    
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer
