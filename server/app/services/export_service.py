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
                # Use rounding service for consistent calculation
                from app.services.rounding_service import (
                    compute_minutes_with_rounding_and_breaks,
                    get_company_rounding_policy,
                )
                from app.services.company_service import get_company_settings
                from app.models.company import Company
                
                # Get company settings
                result = await db.execute(
                    select(Company).where(Company.id == company_id)
                )
                company = result.scalar_one_or_none()
                if company:
                    company_settings = get_company_settings(company)
                    rounding_policy = company_settings["rounding_policy"]
                    breaks_paid = company_settings["breaks_paid"]
                else:
                    rounding_policy = await get_company_rounding_policy(db, company_id)
                    breaks_paid = False
                
                rounded_minutes = compute_minutes_with_rounding_and_breaks(
                    entry.clock_in_at,
                    entry.clock_out_at,
                    entry.break_minutes,
                    rounding_policy,
                    breaks_paid,
                )
                hours = rounded_minutes / 60.0
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
                # Use rounding service for consistent calculation
                from app.services.rounding_service import (
                    compute_minutes_with_rounding_and_breaks,
                    get_company_rounding_policy,
                )
                from app.services.company_service import get_company_settings
                from app.models.company import Company
                
                # Get company settings
                result = await db.execute(
                    select(Company).where(Company.id == company_id)
                )
                company = result.scalar_one_or_none()
                if company:
                    company_settings = get_company_settings(company)
                    rounding_policy = company_settings["rounding_policy"]
                    breaks_paid = company_settings["breaks_paid"]
                else:
                    rounding_policy = await get_company_rounding_policy(db, company_id)
                    breaks_paid = False
                
                rounded_minutes = compute_minutes_with_rounding_and_breaks(
                    entry.clock_in_at,
                    entry.clock_out_at,
                    entry.break_minutes,
                    rounding_policy,
                    breaks_paid,
                )
                hours = rounded_minutes / 60.0
                total_hours += hours
            total_break_minutes += entry.break_minutes
            
            # Add to detailed sheet (use rounded hours)
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


async def generate_payroll_pdf(
    db: AsyncSession,
    payroll_run,
) -> BytesIO:
    """Generate PDF payroll report."""
    from app.models.payroll import PayrollRun, PayrollLineItem
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
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
    story.append(Paragraph("Payroll Report", title_style))
    
    # Company and period info
    company_name = payroll_run.company.name if payroll_run.company else "Company"
    story.append(Paragraph(f"<b>Company:</b> {company_name}", styles['Normal']))
    story.append(Paragraph(f"<b>Payroll Type:</b> {payroll_run.payroll_type.value}", styles['Normal']))
    story.append(Paragraph(f"<b>Period:</b> {payroll_run.period_start_date} to {payroll_run.period_end_date}", styles['Normal']))
    story.append(Paragraph(f"<b>Generated:</b> {payroll_run.generated_at.strftime('%Y-%m-%d %H:%M:%S')}", styles['Normal']))
    if payroll_run.generator:
        story.append(Paragraph(f"<b>Generated By:</b> {payroll_run.generator.name}", styles['Normal']))
    story.append(Paragraph(f"<b>Status:</b> {payroll_run.status.value}", styles['Normal']))
    story.append(Spacer(1, 0.3 * inch))
    
    # Table data
    data = [["Employee", "Regular Hours", "OT Hours", "Rate", "Regular Pay", "OT Pay", "Total Pay", "Exceptions"]]
    
    for item in payroll_run.line_items:
        regular_hours = item.regular_minutes / 60.0
        ot_hours = item.overtime_minutes / 60.0
        rate_dollars = item.pay_rate_cents / 100.0
        regular_pay_dollars = item.regular_pay_cents / 100.0
        ot_pay_dollars = item.overtime_pay_cents / 100.0
        total_pay_dollars = item.total_pay_cents / 100.0
        
        data.append([
            item.employee.name if item.employee else "Unknown",
            f"{regular_hours:.2f}",
            f"{ot_hours:.2f}",
            f"${rate_dollars:.2f}",
            f"${regular_pay_dollars:.2f}",
            f"${ot_pay_dollars:.2f}",
            f"${total_pay_dollars:.2f}",
            str(item.exceptions_count) if item.exceptions_count > 0 else "-",
        ])
    
    # Totals row
    total_regular_hours = float(payroll_run.total_regular_hours)
    total_ot_hours = float(payroll_run.total_overtime_hours)
    total_gross_dollars = payroll_run.total_gross_pay_cents / 100.0
    
    data.append([
        "<b>TOTALS</b>",
        f"<b>{total_regular_hours:.2f}</b>",
        f"<b>{total_ot_hours:.2f}</b>",
        "",
        "",
        "",
        f"<b>${total_gross_dollars:.2f}</b>",
        "",
    ])
    
    # Create table
    table = Table(data, colWidths=[2*inch, 0.8*inch, 0.8*inch, 0.8*inch, 1*inch, 1*inch, 1*inch, 0.8*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -2), colors.beige),
        ('TEXTCOLOR', (0, 1), (-1, -2), colors.black),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, -1), (-1, -1), 10),
        ('BACKGROUND', (0, -1), (-1, -1), colors.lightgrey),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
    ]))
    
    story.append(table)
    
    doc.build(story)
    buffer.seek(0)
    return buffer


async def generate_payroll_excel(
    db: AsyncSession,
    payroll_run,
) -> BytesIO:
    """Generate Excel payroll report."""
    from app.models.payroll import PayrollRun, PayrollLineItem
    
    wb = Workbook()
    
    # Remove default sheet
    wb.remove(wb.active)
    
    # Summary sheet
    summary_ws = wb.create_sheet("Payroll Summary")
    summary_ws.append(["Payroll Report"])
    summary_ws.append([])
    summary_ws.append(["Company:", payroll_run.company.name if payroll_run.company else "Company"])
    summary_ws.append(["Payroll Type:", payroll_run.payroll_type.value])
    summary_ws.append(["Period Start:", payroll_run.period_start_date.isoformat()])
    summary_ws.append(["Period End:", payroll_run.period_end_date.isoformat()])
    summary_ws.append(["Generated:", payroll_run.generated_at.strftime('%Y-%m-%d %H:%M:%S')])
    if payroll_run.generator:
        summary_ws.append(["Generated By:", payroll_run.generator.name])
    summary_ws.append(["Status:", payroll_run.status.value])
    summary_ws.append([])
    
    # Summary table headers
    summary_ws.append([
        "Employee Name",
        "Regular Hours",
        "Overtime Hours",
        "Pay Rate",
        "Regular Pay",
        "OT Pay",
        "Total Pay",
        "Exceptions",
    ])
    
    # Summary data
    for item in payroll_run.line_items:
        regular_hours = item.regular_minutes / 60.0
        ot_hours = item.overtime_minutes / 60.0
        rate_dollars = item.pay_rate_cents / 100.0
        regular_pay_dollars = item.regular_pay_cents / 100.0
        ot_pay_dollars = item.overtime_pay_cents / 100.0
        total_pay_dollars = item.total_pay_cents / 100.0
        
        summary_ws.append([
            item.employee.name if item.employee else "Unknown",
            regular_hours,
            ot_hours,
            rate_dollars,
            regular_pay_dollars,
            ot_pay_dollars,
            total_pay_dollars,
            item.exceptions_count,
        ])
    
    # Totals row
    total_regular_hours = float(payroll_run.total_regular_hours)
    total_ot_hours = float(payroll_run.total_overtime_hours)
    total_gross_dollars = payroll_run.total_gross_pay_cents / 100.0
    
    summary_ws.append([
        "TOTALS",
        total_regular_hours,
        total_ot_hours,
        "",
        "",
        "",
        total_gross_dollars,
        "",
    ])
    
    # Details sheet
    detail_ws = wb.create_sheet("Payroll Details")
    detail_ws.append(["Payroll Details"])
    detail_ws.append([])
    detail_ws.append([
        "Employee",
        "Date",
        "Minutes",
        "Regular Minutes",
        "OT Minutes",
        "Notes/Exceptions",
    ])
    
    for item in payroll_run.line_items:
        employee_name = item.employee.name if item.employee else "Unknown"
        details = item.details_json or {}
        days = details.get("days", {})
        
        for date_str, minutes in days.items():
            # Determine if minutes are regular or OT (simplified - would need week breakdown)
            # For now, just show total minutes
            detail_ws.append([
                employee_name,
                date_str,
                minutes,
                "",  # Would need to calculate from week_blocks
                "",  # Would need to calculate from week_blocks
                f"Exceptions: {item.exceptions_count}" if item.exceptions_count > 0 else "",
            ])
    
    # Style headers
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    
    for ws in [summary_ws, detail_ws]:
        for row in ws.iter_rows(min_row=1, max_row=1):
            for cell in row:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center")
    
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
