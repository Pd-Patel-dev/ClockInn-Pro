from typing import List, Optional
from uuid import UUID
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, and_

from app.core.dependencies import get_db, get_current_admin
from app.models.user import User
from app.models.payroll import PayrollRun, PayrollLineItem
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
)
from app.services.export_service import (
    generate_payroll_pdf,
    generate_payroll_excel,
)
import uuid

router = APIRouter()


@router.post("/admin/payroll/runs/generate", response_model=PayrollRunResponse, status_code=status.HTTP_201_CREATED)
async def generate_payroll_endpoint(
    request: PayrollGenerateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new payroll run (admin only)."""
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate payroll: {str(e)}",
        )


@router.get("/admin/payroll/runs", response_model=List[PayrollRunSummaryResponse])
async def list_payroll_runs_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
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
async def get_payroll_run_endpoint(
    payroll_run_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a payroll run with line items (admin only)."""
    try:
        run_id = UUID(payroll_run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payroll run ID",
        )
    
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


@router.post("/admin/payroll/runs/{payroll_run_id}/finalize", response_model=PayrollRunResponse)
async def finalize_payroll_run_endpoint(
    payroll_run_id: str,
    request: PayrollFinalizeRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Finalize a payroll run (admin only)."""
    try:
        run_id = UUID(payroll_run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payroll run ID",
        )
    
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
async def void_payroll_run_endpoint(
    payroll_run_id: str,
    request: PayrollVoidRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Void a payroll run (admin only)."""
    try:
        run_id = UUID(payroll_run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payroll run ID",
        )
    
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


@router.post("/admin/payroll/runs/{payroll_run_id}/export")
async def export_payroll_endpoint(
    payroll_run_id: str,
    format: str = Query(..., regex="^(pdf|xlsx)$"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Export payroll run to PDF or Excel (admin only)."""
    try:
        run_id = UUID(payroll_run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payroll run ID",
        )
    
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
        buffer = await generate_payroll_pdf(db, payroll_run)
        return StreamingResponse(
            buffer,
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

