from typing import List
from uuid import UUID
from datetime import datetime, date, timedelta
from io import BytesIO
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter

from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User


class NumberedCanvas:
    """Custom canvas for page numbers and headers/footers."""
    def __init__(self, canvas, doc):
        self.canvas = canvas
        self.doc = doc
        
    def draw_page_number(self, page_num):
        """Draw page number at bottom center."""
        self.canvas.saveState()
        self.canvas.setFont("Helvetica", 9)
        self.canvas.setFillColor(colors.HexColor('#666666'))
        page_text = f"Page {page_num}"
        text_width = self.canvas.stringWidth(page_text, "Helvetica", 9)
        page_width = self.doc.pagesize[0]
        self.canvas.drawString((page_width - text_width) / 2, 0.5 * inch, page_text)
        self.canvas.restoreState()


async def generate_pdf_report(
    db: AsyncSession,
    company_id: UUID,
    employee_ids: List[UUID],
    start_date: date,
    end_date: date,
) -> BytesIO:
    """Generate professional PDF report for time entries."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(letter), 
                           leftMargin=0.75*inch, rightMargin=0.75*inch,
                           topMargin=1*inch, bottomMargin=0.75*inch)
    story = []
    styles = getSampleStyleSheet()
    
    # Get company information
    from app.models.company import Company
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    company_name = company.name if company else "Company"
    
    # Professional color scheme
    primary_color = colors.HexColor('#2563eb')  # Blue
    secondary_color = colors.HexColor('#1e40af')  # Darker blue
    accent_color = colors.HexColor('#10b981')  # Green
    header_bg = colors.HexColor('#1e293b')  # Dark slate
    light_bg = colors.HexColor('#f8fafc')  # Light gray
    border_color = colors.HexColor('#e2e8f0')  # Light border
    
    # Title style with gradient effect
    title_style = ParagraphStyle(
        'ReportTitle',
        parent=styles['Heading1'],
        fontSize=28,
        textColor=primary_color,
        spaceAfter=10,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        leading=32,
    )
    
    # Subtitle style
    subtitle_style = ParagraphStyle(
        'ReportSubtitle',
        parent=styles['Normal'],
        fontSize=14,
        textColor=colors.HexColor('#64748b'),
        spaceAfter=20,
        alignment=TA_CENTER,
        fontName='Helvetica',
    )
    
    # Company header
    header_style = ParagraphStyle(
        'CompanyHeader',
        parent=styles['Normal'],
        fontSize=18,
        textColor=header_bg,
        spaceAfter=5,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
    )
    
    # Period info style
    period_style = ParagraphStyle(
        'PeriodInfo',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.HexColor('#475569'),
        spaceAfter=25,
        alignment=TA_CENTER,
        fontName='Helvetica',
    )
    
    # Employee header style
    employee_header_style = ParagraphStyle(
        'EmployeeHeader',
        parent=styles['Heading2'],
        fontSize=16,
        textColor=secondary_color,
        spaceBefore=20,
        spaceAfter=12,
        fontName='Helvetica-Bold',
        leftIndent=0,
    )
    
    # Summary box style
    summary_style = ParagraphStyle(
        'Summary',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor('#334155'),
        fontName='Helvetica',
    )
    
    # Header section with company name
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(f"<b>{company_name}</b>", header_style))
    story.append(Paragraph("Time & Attendance Report", title_style))
    
    # Period information in a styled box
    period_text = f"<b>Reporting Period:</b> {start_date.strftime('%B %d, %Y')} to {end_date.strftime('%B %d, %Y')}"
    story.append(Paragraph(period_text, period_style))
    story.append(Paragraph(f"<b>Generated:</b> {datetime.now().strftime('%B %d, %Y at %I:%M %p')}", period_style))
    story.append(Spacer(1, 0.3 * inch))
    
    # Get employees
    result = await db.execute(
        select(User).where(
            and_(
                User.id.in_(employee_ids),
                User.company_id == company_id,
            )
        ).order_by(User.name)
    )
    employees = result.scalars().all()
    
    # Overall summary statistics
    total_employees = len(employees)
    total_all_hours = 0
    total_all_breaks = 0
    
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
        
        # Employee section with styled header
        employee_info = f"<b>{employee.name}</b>"
        if employee.job_role:
            employee_info += f" <i>• {employee.job_role}</i>"
        story.append(Paragraph(employee_info, employee_header_style))
        
        # Calculate totals
        total_hours = 0
        total_break_minutes = 0
        entry_count = 0
        
        # Table data with improved formatting
        data = [['Date', 'Clock In', 'Clock Out', 'Hours', 'Break', 'Status']]
        
        for entry in entries:
            entry_count += 1
            date_str = entry.clock_in_at.strftime("%m/%d/%Y")
            clock_in = entry.clock_in_at.strftime("%I:%M %p")
            clock_out = entry.clock_out_at.strftime("%I:%M %p") if entry.clock_out_at else "<i>Open</i>"
            
            if entry.clock_out_at:
                # Use rounding service for consistent calculation
                from app.services.rounding_service import (
                    compute_minutes_with_rounding_and_breaks,
                    get_company_rounding_policy,
                )
                from app.services.company_service import get_company_settings
                
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
            
            # Status badge color
            status_text = entry.status.value.title()
            if entry.status == TimeEntryStatus.CLOSED:
                status_color = accent_color
            elif entry.status == TimeEntryStatus.OPEN:
                status_color = colors.HexColor('#f59e0b')  # Amber
            else:
                status_color = colors.HexColor('#6366f1')  # Indigo
            
            data.append([
                date_str,
                clock_in,
                clock_out,
                f"{hours:.2f}",
                f"{entry.break_minutes} min",
                status_text,
            ])
        
        total_all_hours += total_hours
        total_all_breaks += total_break_minutes
        
        # Employee summary box
        summary_data = [
            ['<b>Summary</b>', '', '', '', '', ''],
            ['Total Entries:', f'<b>{entry_count}</b>', '', 'Total Hours:', f'<b>{total_hours:.2f}</b>', ''],
            ['Total Breaks:', f'<b>{total_break_minutes} min</b>', '', 'Avg Hours/Day:', f'<b>{(total_hours / entry_count) if entry_count > 0 else 0:.2f}</b>', ''],
        ]
        
        summary_table = Table(summary_data, colWidths=[1.2*inch, 1*inch, 0.5*inch, 1.2*inch, 1*inch, 0.5*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), light_bg),
            ('TEXTCOLOR', (0, 0), (-1, 0), secondary_color),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('FONTSIZE', (0, 1), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(summary_table)
        story.append(Spacer(1, 0.15 * inch))
        
        # Add totals row to main table
        data.append([
            '<b>TOTAL</b>',
            '',
            '',
            f"<b>{total_hours:.2f} hrs</b>",
            f"<b>{total_break_minutes} min</b>",
            '',
        ])
        
        # Create main table with professional styling
        table = Table(data, colWidths=[1.1*inch, 1.2*inch, 1.2*inch, 0.9*inch, 0.9*inch, 0.9*inch])
        table.setStyle(TableStyle([
            # Header row
            ('BACKGROUND', (0, 0), (-1, 0), header_bg),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('TOPPADDING', (0, 0), (-1, 0), 12),
            
            # Data rows - alternating colors
            ('BACKGROUND', (0, 1), (-1, -2), colors.white),
            ('TEXTCOLOR', (0, 1), (-1, -2), colors.HexColor('#1e293b')),
            ('FONTSIZE', (0, 1), (-1, -2), 9),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, light_bg]),
            
            # Totals row
            ('BACKGROUND', (0, -1), (-1, -1), secondary_color),
            ('TEXTCOLOR', (0, -1), (-1, -1), colors.white),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, -1), (-1, -1), 10),
            ('TOPPADDING', (0, -1), (-1, -1), 10),
            ('BOTTOMPADDING', (0, -1), (-1, -1), 10),
            
            # Grid and borders
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('LINEBELOW', (0, 0), (-1, 0), 2, header_bg),
            ('LINEABOVE', (0, -1), (-1, -1), 2, secondary_color),
            
            # Padding
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        
        story.append(table)
        story.append(Spacer(1, 0.4 * inch))
    
    # Overall summary at the end
    if total_employees > 0:
        story.append(PageBreak())
        overall_summary_style = ParagraphStyle(
            'OverallSummary',
            parent=styles['Heading1'],
            fontSize=20,
            textColor=primary_color,
            spaceAfter=15,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold',
        )
        
        story.append(Paragraph("Overall Summary", overall_summary_style))
        
        summary_data = [
            ['<b>Metric</b>', '<b>Value</b>'],
            ['Total Employees', f'{total_employees}'],
            ['Total Hours Worked', f'{total_all_hours:.2f} hours'],
            ['Total Break Time', f'{total_all_breaks} minutes'],
            ['Average Hours per Employee', f'{(total_all_hours / total_employees):.2f} hours'],
        ]
        
        summary_table = Table(summary_data, colWidths=[3*inch, 2*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), primary_color),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('FONTSIZE', (0, 1), (-1, -1), 11),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 12),
            ('RIGHTPADDING', (0, 0), (-1, -1), 12),
            ('GRID', (0, 0), (-1, -1), 0.5, border_color),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, light_bg]),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(summary_table)
    
    # Build PDF with custom page numbering
    def on_first_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(colors.HexColor('#94a3b8'))
        page_text = f"Page 1"
        text_width = canvas.stringWidth(page_text, "Helvetica", 9)
        page_width = doc.pagesize[0]
        canvas.drawString((page_width - text_width) / 2, 0.5 * inch, page_text)
        canvas.restoreState()
    
    def on_later_pages(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(colors.HexColor('#94a3b8'))
        page_num = canvas.getPageNumber()
        page_text = f"Page {page_num}"
        text_width = canvas.stringWidth(page_text, "Helvetica", 9)
        page_width = doc.pagesize[0]
        canvas.drawString((page_width - text_width) / 2, 0.5 * inch, page_text)
        canvas.restoreState()
    
    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
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
    """Generate professional PDF payroll report."""
    from app.models.payroll import PayrollRun, PayrollLineItem
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter,
                           leftMargin=0.75*inch, rightMargin=0.75*inch,
                           topMargin=1*inch, bottomMargin=0.75*inch)
    story = []
    styles = getSampleStyleSheet()
    
    # Professional color scheme
    primary_color = colors.HexColor('#2563eb')
    secondary_color = colors.HexColor('#1e40af')
    header_bg = colors.HexColor('#1e293b')
    light_bg = colors.HexColor('#f8fafc')
    border_color = colors.HexColor('#e2e8f0')
    
    # Title style
    title_style = ParagraphStyle(
        'PayrollTitle',
        parent=styles['Heading1'],
        fontSize=26,
        textColor=primary_color,
        spaceAfter=10,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
    )
    
    # Company and period info
    company_name = payroll_run.company.name if payroll_run.company else "Company"
    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(f"<b>{company_name}</b>", ParagraphStyle(
        'CompanyName',
        parent=styles['Normal'],
        fontSize=18,
        textColor=header_bg,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
    )))
    story.append(Paragraph("Payroll Report", title_style))
    
    # Info section
    info_style = ParagraphStyle(
        'Info',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor('#475569'),
        spaceAfter=5,
        alignment=TA_CENTER,
    )
    
    story.append(Paragraph(f"<b>Payroll Type:</b> {payroll_run.payroll_type.value}", info_style))
    story.append(Paragraph(f"<b>Period:</b> {payroll_run.period_start_date.strftime('%B %d, %Y')} to {payroll_run.period_end_date.strftime('%B %d, %Y')}", info_style))
    story.append(Paragraph(f"<b>Generated:</b> {payroll_run.generated_at.strftime('%B %d, %Y at %I:%M %p')}", info_style))
    if payroll_run.generator:
        story.append(Paragraph(f"<b>Generated By:</b> {payroll_run.generator.name}", info_style))
    story.append(Paragraph(f"<b>Status:</b> {payroll_run.status.value.title()}", info_style))
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
        f"<b>${total_gross_dollars:,.2f}</b>",
        "",
    ])
    
    # Create table with professional styling
    table = Table(data, colWidths=[2*inch, 0.9*inch, 0.9*inch, 0.9*inch, 1.1*inch, 1.1*inch, 1.1*inch, 0.8*inch])
    table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), header_bg),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 11),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        
        # Data rows
        ('BACKGROUND', (0, 1), (-1, -2), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -2), colors.HexColor('#1e293b')),
        ('FONTSIZE', (0, 1), (-1, -2), 9),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, light_bg]),
        
        # Totals row
        ('BACKGROUND', (0, -1), (-1, -1), secondary_color),
        ('TEXTCOLOR', (0, -1), (-1, -1), colors.white),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, -1), (-1, -1), 10),
        ('TOPPADDING', (0, -1), (-1, -1), 10),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 10),
        
        # Grid
        ('GRID', (0, 0), (-1, -1), 0.5, border_color),
        ('LINEBELOW', (0, 0), (-1, 0), 2, header_bg),
        ('LINEABOVE', (0, -1), (-1, -1), 2, secondary_color),
        
        # Padding
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    story.append(table)
    
    # Page numbering
    def on_first_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(colors.HexColor('#94a3b8'))
        page_text = f"Page 1"
        text_width = canvas.stringWidth(page_text, "Helvetica", 9)
        page_width = doc.pagesize[0]
        canvas.drawString((page_width - text_width) / 2, 0.5 * inch, page_text)
        canvas.restoreState()
    
    def on_later_pages(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(colors.HexColor('#94a3b8'))
        page_num = canvas.getPageNumber()
        page_text = f"Page {page_num}"
        text_width = canvas.stringWidth(page_text, "Helvetica", 9)
        page_width = doc.pagesize[0]
        canvas.drawString((page_width - text_width) / 2, 0.5 * inch, page_text)
        canvas.restoreState()
    
    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
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
