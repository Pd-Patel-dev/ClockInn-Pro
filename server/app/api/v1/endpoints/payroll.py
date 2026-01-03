from typing import List, Optional
from uuid import UUID
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, and_

from app.core.dependencies import get_db, get_current_admin
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User
from app.models.payroll import PayrollRun, PayrollLineItem, PayrollStatus, PayrollType
from app.schemas.payroll import (
    PayrollGenerateRequest,
    PayrollRunResponse,
    PayrollRunSummaryResponse,
    PayrollLineItemResponse,
    PayrollFinalizeRequest,
    PayrollVoidRequest,
    EmployeePayrollResponse,
)
from app.services.payroll_service import (
    generate_payroll_run,
    get_payroll_run,
    list_payroll_runs,
    finalize_payroll_run,
    void_payroll_run,
    delete_payroll_run,
)
from app.services.export_service import (
    generate_payroll_pdf,
    generate_payroll_excel,
)
from app.pdf_templates.payroll_report import generate_payroll_report_pdf
import uuid

router = APIRouter()


@router.post("/admin/payroll/runs/generate", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="generate_payroll")
async def generate_payroll_endpoint(
    request: PayrollGenerateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new payroll run (admin only)."""
    payroll_run = await generate_payroll_run(
        db,
        current_user.company_id,
        request.payroll_type,
        request.start_date,
        current_user.id,
        request.include_inactive,
        request.employee_ids,
        allow_duplicate=False,
    )
    
    # Load line items with employees
    result = await db.execute(
        select(PayrollRun)
        .options(
            selectinload(PayrollRun.line_items).selectinload(PayrollLineItem.employee),
            selectinload(PayrollRun.generator),
        )
        .where(PayrollRun.id == payroll_run.id)
    )
    payroll_run = result.scalar_one()
    
    # Convert to response
    line_items = [
        PayrollLineItemResponse(
            id=item.id,
            employee_id=item.employee_id,
            employee_name=item.employee.name,
            regular_minutes=item.regular_minutes,
            overtime_minutes=item.overtime_minutes,
            total_minutes=item.total_minutes,
            pay_rate_cents=item.pay_rate_cents,
            overtime_multiplier=item.overtime_multiplier,
            regular_pay_cents=item.regular_pay_cents,
            overtime_pay_cents=item.overtime_pay_cents,
            total_pay_cents=item.total_pay_cents,
            exceptions_count=item.exceptions_count,
            details_json=item.details_json,
        )
        for item in payroll_run.line_items
    ]
    
    return PayrollRunResponse(
        id=payroll_run.id,
        company_id=payroll_run.company_id,
        payroll_type=payroll_run.payroll_type,
        period_start_date=payroll_run.period_start_date,
        period_end_date=payroll_run.period_end_date,
        timezone=payroll_run.timezone,
        status=payroll_run.status,
        generated_by=payroll_run.generated_by,
        generated_by_name=payroll_run.generator.name if payroll_run.generator else None,
        generated_at=payroll_run.generated_at,
        total_regular_hours=payroll_run.total_regular_hours,
        total_overtime_hours=payroll_run.total_overtime_hours,
        total_gross_pay_cents=payroll_run.total_gross_pay_cents,
        created_at=payroll_run.created_at,
        updated_at=payroll_run.updated_at,
        line_items=line_items,
    )


@router.get("/admin/payroll/runs", response_model=List[PayrollRunSummaryResponse])
@handle_endpoint_errors(operation_name="list_payroll_runs")
async def list_payroll_runs_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    status: Optional[PayrollStatus] = Query(None),
    payroll_type: Optional[PayrollType] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List payroll runs (admin only)."""
    runs, total = await list_payroll_runs(
        db,
        current_user.company_id,
        from_date,
        to_date,
        status,
        payroll_type,
        skip,
        limit,
    )
    
    # Get employee counts for each run
    summaries = []
    for run in runs:
        result = await db.execute(
            select(PayrollRun)
            .options(selectinload(PayrollRun.line_items))
            .where(PayrollRun.id == run.id)
        )
        run_with_items = result.scalar_one()
        employee_count = len(run_with_items.line_items)
        
        summaries.append(
            PayrollRunSummaryResponse(
                id=run.id,
                payroll_type=run.payroll_type,
                period_start_date=run.period_start_date,
                period_end_date=run.period_end_date,
                status=run.status,
                generated_at=run.generated_at,
                total_regular_hours=run.total_regular_hours,
                total_overtime_hours=run.total_overtime_hours,
                total_gross_pay_cents=run.total_gross_pay_cents,
                employee_count=employee_count,
            )
        )
    
    return summaries


@router.get("/admin/payroll/runs/{payroll_run_id}", response_model=PayrollRunResponse)
@handle_endpoint_errors(operation_name="get_payroll_run")
async def get_payroll_run_endpoint(
    payroll_run_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a payroll run with line items (admin only)."""
    run_id = parse_uuid(payroll_run_id, "Payroll run ID")
    
    payroll_run = await get_payroll_run(db, run_id, current_user.company_id)
    if not payroll_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payroll run not found",
        )
    
    # Load relationships
    result = await db.execute(
        select(PayrollRun)
        .options(
            selectinload(PayrollRun.line_items).selectinload(PayrollLineItem.employee),
            selectinload(PayrollRun.generator),
        )
        .where(PayrollRun.id == run_id)
    )
    payroll_run = result.scalar_one()
    
    line_items = [
        PayrollLineItemResponse(
            id=item.id,
            employee_id=item.employee_id,
            employee_name=item.employee.name,
            regular_minutes=item.regular_minutes,
            overtime_minutes=item.overtime_minutes,
            total_minutes=item.total_minutes,
            pay_rate_cents=item.pay_rate_cents,
            overtime_multiplier=item.overtime_multiplier,
            regular_pay_cents=item.regular_pay_cents,
            overtime_pay_cents=item.overtime_pay_cents,
            total_pay_cents=item.total_pay_cents,
            exceptions_count=item.exceptions_count,
            details_json=item.details_json,
        )
        for item in payroll_run.line_items
    ]
    
    return PayrollRunResponse(
        id=payroll_run.id,
        company_id=payroll_run.company_id,
        payroll_type=payroll_run.payroll_type,
        period_start_date=payroll_run.period_start_date,
        period_end_date=payroll_run.period_end_date,
        timezone=payroll_run.timezone,
        status=payroll_run.status,
        generated_by=payroll_run.generated_by,
        generated_by_name=payroll_run.generator.name if payroll_run.generator else None,
        generated_at=payroll_run.generated_at,
        total_regular_hours=payroll_run.total_regular_hours,
        total_overtime_hours=payroll_run.total_overtime_hours,
        total_gross_pay_cents=payroll_run.total_gross_pay_cents,
        created_at=payroll_run.created_at,
        updated_at=payroll_run.updated_at,
        line_items=line_items,
    )


@router.get("/payrolls/{payroll_run_id}/report.pdf")
@handle_endpoint_errors(operation_name="get_payroll_report_pdf")
async def get_payroll_report_pdf_endpoint(
    payroll_run_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate and download payroll report PDF (admin only).
    
    Returns a professional PDF report with header, summary cards, employee table,
    notes, and footer.
    """
    from io import BytesIO
    
    run_id = parse_uuid(payroll_run_id, "Payroll run ID")
    
    # Load payroll run with all relationships
    result = await db.execute(
        select(PayrollRun)
        .options(
            selectinload(PayrollRun.company),
            selectinload(PayrollRun.line_items).selectinload(PayrollLineItem.employee),
            selectinload(PayrollRun.generator),
        )
        .where(
            and_(
                PayrollRun.id == run_id,
                PayrollRun.company_id == current_user.company_id
            )
        )
    )
    payroll_run = result.scalar_one_or_none()
    
    if not payroll_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payroll run not found",
        )
    
    # Prepare data for PDF generator
    company_name = payroll_run.company.name if payroll_run.company else "Company"
    payroll_type = payroll_run.payroll_type.value
    status_str = payroll_run.status.value.title()
    generated_by_name = payroll_run.generator.name if payroll_run.generator else "System"
    
    # Prepare employee rows
    rows = []
    for item in payroll_run.line_items:
        employee_name = item.employee.name if item.employee else "Unknown"
        regular_hours = float(item.regular_minutes) / 60.0
        ot_hours = float(item.overtime_minutes) / 60.0
        rate = float(item.pay_rate_cents) / 100.0
        regular_pay = float(item.regular_pay_cents) / 100.0
        ot_pay = float(item.overtime_pay_cents) / 100.0
        total_pay = float(item.total_pay_cents) / 100.0
        exceptions = "-" if item.exceptions_count == 0 else f"{item.exceptions_count} exception(s)"
        
        rows.append({
            'employee_name': employee_name,
            'regular_hours': regular_hours,
            'ot_hours': ot_hours,
            'rate': rate,
            'regular_pay': regular_pay,
            'ot_pay': ot_pay,
            'total_pay': total_pay,
            'exceptions': exceptions,
        })
    
    # Generate PDF
    pdf_bytes = generate_payroll_report_pdf(
        company_name=company_name,
        payroll_type=payroll_type,
        period_start=payroll_run.period_start_date,
        period_end=payroll_run.period_end_date,
        generated_at=payroll_run.generated_at,
        generated_by=generated_by_name,
        status=status_str,
        rows=rows,
    )
    
    # Create filename
    filename = f"payroll-report-{payroll_run.period_start_date}-{payroll_run.period_end_date}.pdf"
    
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.post("/admin/payroll/runs/{payroll_run_id}/finalize", response_model=PayrollRunResponse)
@handle_endpoint_errors(operation_name="finalize_payroll_run")
async def finalize_payroll_run_endpoint(
    payroll_run_id: str,
    request: PayrollFinalizeRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Finalize a payroll run (admin only)."""
    run_id = parse_uuid(payroll_run_id, "Payroll run ID")
    
    payroll_run = await finalize_payroll_run(
        db,
        run_id,
        current_user.company_id,
        current_user.id,
        request.note,
    )
    
    # Load relationships for response
    result = await db.execute(
        select(PayrollRun)
        .options(
            selectinload(PayrollRun.line_items).selectinload(PayrollLineItem.employee),
            selectinload(PayrollRun.generator),
        )
        .where(PayrollRun.id == run_id)
    )
    payroll_run = result.scalar_one()
    
    line_items = [
        PayrollLineItemResponse(
            id=item.id,
            employee_id=item.employee_id,
            employee_name=item.employee.name,
            regular_minutes=item.regular_minutes,
            overtime_minutes=item.overtime_minutes,
            total_minutes=item.total_minutes,
            pay_rate_cents=item.pay_rate_cents,
            overtime_multiplier=item.overtime_multiplier,
            regular_pay_cents=item.regular_pay_cents,
            overtime_pay_cents=item.overtime_pay_cents,
            total_pay_cents=item.total_pay_cents,
            exceptions_count=item.exceptions_count,
            details_json=item.details_json,
        )
        for item in payroll_run.line_items
    ]
    
    return PayrollRunResponse(
        id=payroll_run.id,
        company_id=payroll_run.company_id,
        payroll_type=payroll_run.payroll_type,
        period_start_date=payroll_run.period_start_date,
        period_end_date=payroll_run.period_end_date,
        timezone=payroll_run.timezone,
        status=payroll_run.status,
        generated_by=payroll_run.generated_by,
        generated_by_name=payroll_run.generator.name if payroll_run.generator else None,
        generated_at=payroll_run.generated_at,
        total_regular_hours=payroll_run.total_regular_hours,
        total_overtime_hours=payroll_run.total_overtime_hours,
        total_gross_pay_cents=payroll_run.total_gross_pay_cents,
        created_at=payroll_run.created_at,
        updated_at=payroll_run.updated_at,
        line_items=line_items,
    )


@router.post("/admin/payroll/runs/{payroll_run_id}/void", response_model=PayrollRunResponse)
@handle_endpoint_errors(operation_name="void_payroll_run")
async def void_payroll_run_endpoint(
    payroll_run_id: str,
    request: PayrollVoidRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Void a payroll run (admin only)."""
    run_id = parse_uuid(payroll_run_id, "Payroll run ID")
    
    payroll_run = await void_payroll_run(
        db,
        run_id,
        current_user.company_id,
        current_user.id,
        request.reason,
    )
    
    # Load relationships for response
    result = await db.execute(
        select(PayrollRun)
        .options(
            selectinload(PayrollRun.line_items).selectinload(PayrollLineItem.employee),
            selectinload(PayrollRun.generator),
        )
        .where(PayrollRun.id == run_id)
    )
    payroll_run = result.scalar_one()
    
    line_items = [
        PayrollLineItemResponse(
            id=item.id,
            employee_id=item.employee_id,
            employee_name=item.employee.name,
            regular_minutes=item.regular_minutes,
            overtime_minutes=item.overtime_minutes,
            total_minutes=item.total_minutes,
            pay_rate_cents=item.pay_rate_cents,
            overtime_multiplier=item.overtime_multiplier,
            regular_pay_cents=item.regular_pay_cents,
            overtime_pay_cents=item.overtime_pay_cents,
            total_pay_cents=item.total_pay_cents,
            exceptions_count=item.exceptions_count,
            details_json=item.details_json,
        )
        for item in payroll_run.line_items
    ]
    
    return PayrollRunResponse(
        id=payroll_run.id,
        company_id=payroll_run.company_id,
        payroll_type=payroll_run.payroll_type,
        period_start_date=payroll_run.period_start_date,
        period_end_date=payroll_run.period_end_date,
        timezone=payroll_run.timezone,
        status=payroll_run.status,
        generated_by=payroll_run.generated_by,
        generated_by_name=payroll_run.generator.name if payroll_run.generator else None,
        generated_at=payroll_run.generated_at,
        total_regular_hours=payroll_run.total_regular_hours,
        total_overtime_hours=payroll_run.total_overtime_hours,
        total_gross_pay_cents=payroll_run.total_gross_pay_cents,
        created_at=payroll_run.created_at,
        updated_at=payroll_run.updated_at,
        line_items=line_items,
    )


@router.delete("/admin/payroll/runs/{payroll_run_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_endpoint_errors(operation_name="delete_payroll_run")
async def delete_payroll_run_endpoint(
    payroll_run_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a payroll run (only DRAFT status allowed, admin only)."""
    run_id = parse_uuid(payroll_run_id, "Payroll run ID")
    
    await delete_payroll_run(
        db,
        run_id,
        current_user.company_id,
        current_user.id,
    )


@router.post("/admin/payroll/runs/{payroll_run_id}/export")
@handle_endpoint_errors(operation_name="export_payroll")
async def export_payroll_endpoint(
    payroll_run_id: str,
    format: str = Query(..., regex="^(pdf|xlsx)$"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Export payroll run to PDF or Excel (admin only)."""
    run_id = parse_uuid(payroll_run_id, "Payroll run ID")
    
    payroll_run = await get_payroll_run(db, run_id, current_user.company_id)
    if not payroll_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payroll run not found",
        )
    
    # Load line items with employees
    result = await db.execute(
        select(PayrollRun)
        .options(
            selectinload(PayrollRun.line_items).selectinload(PayrollLineItem.employee),
            selectinload(PayrollRun.generator),
            selectinload(PayrollRun.company),
        )
        .where(PayrollRun.id == run_id)
    )
    payroll_run = result.scalar_one()
    
    # Create audit log
    from app.models.audit_log import AuditLog
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=current_user.company_id,
        actor_user_id=current_user.id,
        action="PAYROLL_EXPORT",
        entity_type="payroll_run",
        entity_id=run_id,
        metadata_json={"format": format},
    )
    db.add(audit_log)
    await db.commit()
    
    if format == "pdf":
        # Use new professional PDF template
        from io import BytesIO
        
        # Prepare data for new PDF generator
        company_name = payroll_run.company.name if payroll_run.company else "Company"
        payroll_type = payroll_run.payroll_type.value
        status_str = payroll_run.status.value.title()
        generated_by_name = payroll_run.generator.name if payroll_run.generator else "System"
        
        # Prepare employee rows
        rows = []
        for item in payroll_run.line_items:
            employee_name = item.employee.name if item.employee else "Unknown"
            regular_hours = float(item.regular_minutes) / 60.0
            ot_hours = float(item.overtime_minutes) / 60.0
            rate = float(item.pay_rate_cents) / 100.0
            regular_pay = float(item.regular_pay_cents) / 100.0
            ot_pay = float(item.overtime_pay_cents) / 100.0
            total_pay = float(item.total_pay_cents) / 100.0
            exceptions = "-" if item.exceptions_count == 0 else f"{item.exceptions_count} exception(s)"
            
            rows.append({
                'employee_name': employee_name,
                'regular_hours': regular_hours,
                'ot_hours': ot_hours,
                'rate': rate,
                'regular_pay': regular_pay,
                'ot_pay': ot_pay,
                'total_pay': total_pay,
                'exceptions': exceptions,
            })
        
        # Generate PDF using new template
        pdf_bytes = generate_payroll_report_pdf(
            company_name=company_name,
            payroll_type=payroll_type,
            period_start=payroll_run.period_start_date,
            period_end=payroll_run.period_end_date,
            generated_at=payroll_run.generated_at,
            generated_by=generated_by_name,
            status=status_str,
            rows=rows,
        )
        
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="payroll_{payroll_run.period_start_date}_{payroll_run.period_end_date}.pdf"'
            },
        )
    else:  # xlsx
        buffer = await generate_payroll_excel(db, payroll_run)
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="payroll_{payroll_run.period_start_date}_{payroll_run.period_end_date}.xlsx"'
            },
        )


@router.get("/payroll/my", response_model=List[EmployeePayrollResponse])
@handle_endpoint_errors(operation_name="get_my_payroll")
async def get_my_payroll_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    current_user: User = Depends(get_current_admin),  # Using get_current_admin for now, can be changed to get_current_user
    db: AsyncSession = Depends(get_db),
):
    """Get employee's own payroll (finalized only)."""
    from app.models.payroll import PayrollStatus
    from sqlalchemy import select, and_
    from decimal import Decimal
    
    # Use current_user as employee
    employee = current_user
    
    query = select(PayrollRun).join(PayrollLineItem).where(
        and_(
            PayrollRun.company_id == employee.company_id,
            PayrollLineItem.employee_id == employee.id,
            PayrollRun.status == PayrollStatus.FINALIZED,
        )
    )
    
    if from_date:
        query = query.where(PayrollRun.period_start_date >= from_date)
    if to_date:
        query = query.where(PayrollRun.period_end_date <= to_date)
    
    query = query.order_by(PayrollRun.period_start_date.desc())
    
    result = await db.execute(query)
    runs = result.scalars().unique().all()
    
    # Get line items for each run
    payroll_list = []
    for run in runs:
        result = await db.execute(
            select(PayrollLineItem).where(
                and_(
                    PayrollLineItem.payroll_run_id == run.id,
                    PayrollLineItem.employee_id == employee.id,
                )
            )
        )
        line_item = result.scalar_one_or_none()
        if line_item:
            payroll_list.append(
                EmployeePayrollResponse(
                    payroll_run_id=run.id,
                    period_start_date=run.period_start_date,
                    period_end_date=run.period_end_date,
                    payroll_type=run.payroll_type,
                    regular_hours=Decimal(line_item.regular_minutes) / Decimal(60),
                    overtime_hours=Decimal(line_item.overtime_minutes) / Decimal(60),
                    regular_pay_cents=line_item.regular_pay_cents,
                    overtime_pay_cents=line_item.overtime_pay_cents,
                    total_pay_cents=line_item.total_pay_cents,
                    generated_at=run.generated_at,
                )
            )
    
    return payroll_list

