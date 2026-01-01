from typing import List
from uuid import UUID
from datetime import datetime, date, timedelta
from io import BytesIO
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter

from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User


async def generate_pdf_report(
    db: AsyncSession,
    company_id: UUID,
    employee_ids: List[UUID],
    start_date: date,
    end_date: date,
) -> BytesIO:
    """Generate PDF report for time entries."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(letter))
    story = []
    styles = getSampleStyleSheet()
    
    # Title
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        textColor=colors.HexColor('#1a1a1a'),
        spaceAfter=30,
        alignment=1,  # Center
    )
    story.append(Paragraph("Time & Attendance Report", title_style))
    story.append(Paragraph(f"Period: {start_date} to {end_date}", styles['Normal']))
    story.append(Spacer(1, 0.2 * inch))
    
    # Get employees
    result = await db.execute(
        select(User).where(
            and_(
                User.id.in_(employee_ids),
                User.company_id == company_id,
            )
        )
    )
    employees = result.scalars().all()
    
    for employee in employees:
        # Get time entries
        result = await db.execute(
            select(TimeEntry).where(
                and_(
                    TimeEntry.employee_id == employee.id,
                    TimeEntry.company_id == company_id,
                    TimeEntry.clock_in_at >= datetime.combine(start_date, datetime.min.time()),
                    TimeEntry.clock_in_at <= datetime.combine(end_date, datetime.max.time()),
                )
            ).order_by(TimeEntry.clock_in_at)
        )
        entries = result.scalars().all()
        
        if not entries:
            continue
        
        # Employee header
        story.append(Paragraph(f"<b>{employee.name}</b> ({employee.email})", styles['Heading2']))
        story.append(Spacer(1, 0.1 * inch))
        
        # Calculate totals
        total_hours = 0
        total_break_minutes = 0
        
        # Table data
        data = [['Date', 'Clock In', 'Clock Out', 'Hours', 'Break (min)', 'Status']]
        
        for entry in entries:
            clock_in = entry.clock_in_at.strftime("%Y-%m-%d %H:%M")
            clock_out = entry.clock_out_at.strftime("%Y-%m-%d %H:%M") if entry.clock_out_at else "Open"
            
            if entry.clock_out_at:
                delta = entry.clock_out_at - entry.clock_in_at
                hours = (delta.total_seconds() - entry.break_minutes * 60) / 3600
                total_hours += hours
            else:
                hours = 0
            
            total_break_minutes += entry.break_minutes
            
            data.append([
                entry.clock_in_at.strftime("%Y-%m-%d"),
                clock_in,
                clock_out,
                f"{hours:.2f}",
                str(entry.break_minutes),
                entry.status.value,
            ])
        
        # Add totals row
        data.append([
            '<b>TOTAL</b>',
            '',
            '',
            f"<b>{total_hours:.2f}</b>",
            f"<b>{total_break_minutes}</b>",
            '',
        ])
        
        # Create table
        table = Table(data, colWidths=[1.2*inch, 1.5*inch, 1.5*inch, 0.8*inch, 0.8*inch, 0.8*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -2), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('BACKGROUND', (0, -1), (-1, -1), colors.lightgrey),
        ]))
        
        story.append(table)
        story.append(Spacer(1, 0.3 * inch))
    
    doc.build(story)
    buffer.seek(0)
    return buffer


async def generate_excel_report(
    db: AsyncSession,
    company_id: UUID,
    employee_ids: List[UUID],
    start_date: date,
    end_date: date,
) -> BytesIO:
    """Generate Excel report for time entries."""
    wb = Workbook()
    wb.remove(wb.active)  # Remove default sheet
    
    # Summary sheet
    summary_ws = wb.create_sheet("Summary")
    summary_headers = ['Employee', 'Total Hours', 'Regular Hours', 'Overtime Hours', 'Total Break Minutes']
    summary_ws.append(summary_headers)
    
    # Style headers
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    
    for cell in summary_ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    # Detailed sheet
    detail_ws = wb.create_sheet("Detailed")
    detail_headers = ['Employee', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Break (min)', 'Status']
    detail_ws.append(detail_headers)
    
    for cell in detail_ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    
    # Get employees
    result = await db.execute(
        select(User).where(
            and_(
                User.id.in_(employee_ids),
                User.company_id == company_id,
            )
        )
    )
    employees = result.scalars().all()
    
    for employee in employees:
        # Get time entries
        result = await db.execute(
            select(TimeEntry).where(
                and_(
                    TimeEntry.employee_id == employee.id,
                    TimeEntry.company_id == company_id,
                    TimeEntry.clock_in_at >= datetime.combine(start_date, datetime.min.time()),
                    TimeEntry.clock_in_at <= datetime.combine(end_date, datetime.max.time()),
                )
            ).order_by(TimeEntry.clock_in_at)
        )
        entries = result.scalars().all()
        
        if not entries:
            continue
        
        # Calculate totals
        total_hours = 0
        total_break_minutes = 0
        
        for entry in entries:
            if entry.clock_out_at:
                delta = entry.clock_out_at - entry.clock_in_at
                hours = (delta.total_seconds() - entry.break_minutes * 60) / 3600
                total_hours += hours
            total_break_minutes += entry.break_minutes
            
            # Add to detailed sheet
            detail_ws.append([
                employee.name,
                entry.clock_in_at.strftime("%Y-%m-%d"),
                entry.clock_in_at.strftime("%H:%M"),
                entry.clock_out_at.strftime("%H:%M") if entry.clock_out_at else "Open",
                f"{hours:.2f}" if entry.clock_out_at else "0.00",
                entry.break_minutes,
                entry.status.value,
            ])
        
        # Calculate regular vs overtime (assuming 40 hours/week)
        regular_hours = min(total_hours, 40.0)
        overtime_hours = max(0, total_hours - 40.0)
        
        # Add to summary sheet
        summary_ws.append([
            employee.name,
            f"{total_hours:.2f}",
            f"{regular_hours:.2f}",
            f"{overtime_hours:.2f}",
            total_break_minutes,
        ])
    
    # Auto-adjust column widths
    for ws in [summary_ws, detail_ws]:
        for column in ws.columns:
            max_length = 0
            column_letter = get_column_letter(column[0].column)
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)
            ws.column_dimensions[column_letter].width = adjusted_width
    
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer

