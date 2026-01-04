"""
Shift and Schedule Management API Endpoints
"""
from typing import List, Optional
from uuid import UUID
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_admin, get_current_user
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User
from app.schemas.shift import (
    ShiftCreate, ShiftUpdate, ShiftResponse, ShiftConflict,
    ShiftTemplateCreate, ShiftTemplateUpdate, ShiftTemplateResponse,
    GenerateShiftsFromTemplate, ScheduleSwapCreate, ScheduleSwapResponse,
)
from app.schemas.bulk_shift import (
    BulkWeekShiftCreate, BulkWeekShiftPreviewResponse, BulkWeekShiftCreateResponse,
)
from app.services.shift_service import (
    create_shift, update_shift, get_shift, list_shifts, delete_shift, approve_shift,
    create_shift_template, generate_shifts_from_template,
)
from app.services.bulk_shift_service import (
    preview_bulk_week_shifts, create_bulk_week_shifts,
)

router = APIRouter()


@router.post("/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_shift")
async def create_shift_endpoint(
    data: ShiftCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new shift (admin only)."""
    shift, conflicts = await create_shift(
        db,
        current_user.company_id,
        data,
        created_by=current_user.id,
    )
    
    # Get employee name separately to avoid lazy loading issues
    from sqlalchemy import select
    from app.models.user import User as UserModel
    result = await db.execute(select(UserModel).where(UserModel.id == shift.employee_id))
    employee = result.scalar_one_or_none()
    
    # If conflicts exist, return them in response (but shift is still created)
    # Frontend can show warnings
    response = ShiftResponse(
        id=shift.id,
        company_id=shift.company_id,
        employee_id=shift.employee_id,
        employee_name=employee.name if employee else None,
        shift_date=shift.shift_date,
        start_time=shift.start_time,
        end_time=shift.end_time,
        break_minutes=shift.break_minutes,
        notes=shift.notes,
        job_role=shift.job_role,
        status=shift.status.value,
        requires_approval=shift.requires_approval,
        template_id=shift.template_id,
        approved_by=shift.approved_by,
        approved_at=shift.approved_at,
        created_at=shift.created_at,
        created_by=shift.created_by,
        updated_at=shift.updated_at,
    )
    
    return response


@router.get("/shifts", response_model=List[ShiftResponse])
@handle_endpoint_errors(operation_name="list_shifts")
async def list_shifts_endpoint(
    employee_id: Optional[str] = Query(None, description="Filter by employee ID"),
    start_date: Optional[date] = Query(None, description="Filter by start date"),
    end_date: Optional[date] = Query(None, description="Filter by end date"),
    status: Optional[str] = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List shifts. Employees can only see their own shifts."""
    company_id = current_user.company_id
    
    # Employees can only see their own shifts
    if current_user.role.value == "EMPLOYEE":
        employee_id = str(current_user.id)
    
    parsed_employee_id = parse_uuid(employee_id, "Employee ID") if employee_id else None
    
    shifts, total = await list_shifts(
        db,
        company_id,
        employee_id=parsed_employee_id,
        start_date=start_date,
        end_date=end_date,
        status=status,
        skip=skip,
        limit=limit,
    )
    
    return [
        ShiftResponse(
            id=shift.id,
            company_id=shift.company_id,
            employee_id=shift.employee_id,
            employee_name=shift.employee.name if shift.employee else None,
            shift_date=shift.shift_date,
            start_time=shift.start_time,
            end_time=shift.end_time,
            break_minutes=shift.break_minutes,
            notes=shift.notes,
            job_role=shift.job_role,
            status=shift.status.value,
            requires_approval=shift.requires_approval,
            template_id=shift.template_id,
            approved_by=shift.approved_by,
            approved_at=shift.approved_at,
            created_at=shift.created_at,
            created_by=shift.created_by,
            updated_at=shift.updated_at,
        )
        for shift in shifts
    ]


@router.post("/shifts/bulk/week/preview", response_model=BulkWeekShiftPreviewResponse)
@handle_endpoint_errors(operation_name="preview_bulk_week_shifts")
async def preview_bulk_week_shifts_endpoint(
    data: BulkWeekShiftCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Preview shifts that would be created for a whole week (admin only)."""
    preview_shifts, conflicts = await preview_bulk_week_shifts(
        db,
        current_user.company_id,
        data,
    )
    
    return BulkWeekShiftPreviewResponse(
        shifts_to_create=preview_shifts,
        conflicts=conflicts,
        total_shifts=len(preview_shifts),
        total_conflicts=len(conflicts),
    )


@router.post("/shifts/bulk/week", response_model=BulkWeekShiftCreateResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_bulk_week_shifts")
async def create_bulk_week_shifts_endpoint(
    data: BulkWeekShiftCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create shifts for a whole week for multiple employees (admin only)."""
    created_count, skipped_count, overwritten_count, created_shift_ids, skipped_shifts, conflicts, series_id = await create_bulk_week_shifts(
        db,
        current_user.company_id,
        data,
        created_by=current_user.id,
    )
    
    return BulkWeekShiftCreateResponse(
        created_count=created_count,
        skipped_count=skipped_count,
        overwritten_count=overwritten_count,
        created_shift_ids=created_shift_ids,
        skipped_shifts=skipped_shifts,
        conflicts=conflicts,
        series_id=series_id,
    )

@router.get("/shifts/{shift_id}", response_model=ShiftResponse)
@handle_endpoint_errors(operation_name="get_shift")
async def get_shift_endpoint(
    shift_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a shift by ID."""
    parsed_shift_id = parse_uuid(shift_id, "Shift ID")
    shift = await get_shift(db, parsed_shift_id, current_user.company_id)
    
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shift not found",
        )
    
    # Employees can only see their own shifts
    if current_user.role.value == "EMPLOYEE" and shift.employee_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own shifts",
        )
    
    return ShiftResponse(
        id=shift.id,
        company_id=shift.company_id,
        employee_id=shift.employee_id,
        employee_name=shift.employee.name if shift.employee else None,
        shift_date=shift.shift_date,
        start_time=shift.start_time,
        end_time=shift.end_time,
        break_minutes=shift.break_minutes,
        notes=shift.notes,
        job_role=shift.job_role,
        status=shift.status.value,
        requires_approval=shift.requires_approval,
        template_id=shift.template_id,
        approved_by=shift.approved_by,
        approved_at=shift.approved_at,
        created_at=shift.created_at,
        created_by=shift.created_by,
        updated_at=shift.updated_at,
    )


@router.put("/shifts/{shift_id}", response_model=ShiftResponse)
@handle_endpoint_errors(operation_name="update_shift")
async def update_shift_endpoint(
    shift_id: str,
    data: ShiftUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a shift (admin only)."""
    parsed_shift_id = parse_uuid(shift_id, "Shift ID")
    shift, conflicts = await update_shift(
        db,
        parsed_shift_id,
        current_user.company_id,
        data,
    )
    
    return ShiftResponse(
        id=shift.id,
        company_id=shift.company_id,
        employee_id=shift.employee_id,
        employee_name=shift.employee.name if shift.employee else None,
        shift_date=shift.shift_date,
        start_time=shift.start_time,
        end_time=shift.end_time,
        break_minutes=shift.break_minutes,
        notes=shift.notes,
        job_role=shift.job_role,
        status=shift.status.value,
        requires_approval=shift.requires_approval,
        template_id=shift.template_id,
        approved_by=shift.approved_by,
        approved_at=shift.approved_at,
        created_at=shift.created_at,
        created_by=shift.created_by,
        updated_at=shift.updated_at,
    )


@router.post("/shifts/{shift_id}/approve", response_model=ShiftResponse)
@handle_endpoint_errors(operation_name="approve_shift")
async def approve_shift_endpoint(
    shift_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Approve a shift (admin only)."""
    parsed_shift_id = parse_uuid(shift_id, "Shift ID")
    shift = await approve_shift(
        db,
        parsed_shift_id,
        current_user.company_id,
        current_user.id,
    )
    
    return ShiftResponse(
        id=shift.id,
        company_id=shift.company_id,
        employee_id=shift.employee_id,
        employee_name=shift.employee.name if shift.employee else None,
        shift_date=shift.shift_date,
        start_time=shift.start_time,
        end_time=shift.end_time,
        break_minutes=shift.break_minutes,
        notes=shift.notes,
        job_role=shift.job_role,
        status=shift.status.value,
        requires_approval=shift.requires_approval,
        template_id=shift.template_id,
        approved_by=shift.approved_by,
        approved_at=shift.approved_at,
        created_at=shift.created_at,
        created_by=shift.created_by,
        updated_at=shift.updated_at,
    )


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_endpoint_errors(operation_name="delete_shift")
async def delete_shift_endpoint(
    shift_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a shift (permanently removes it from the database, admin only)."""
    parsed_shift_id = parse_uuid(shift_id, "Shift ID")
    await delete_shift(
        db,
        parsed_shift_id,
        current_user.company_id,
    )


@router.post("/shift-templates", response_model=ShiftTemplateResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_shift_template")
async def create_shift_template_endpoint(
    data: ShiftTemplateCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a shift template (admin only)."""
    template = await create_shift_template(
        db,
        current_user.company_id,
        data,
        created_by=current_user.id,
    )
    
    # Load employee relationship
    from app.models.shift import ShiftTemplate
    result = await db.execute(
        select(ShiftTemplate).options(selectinload(ShiftTemplate.employee)).where(
            ShiftTemplate.id == template.id
        )
    )
    template = result.scalar_one()
    
    return ShiftTemplateResponse(
        id=template.id,
        company_id=template.company_id,
        employee_id=template.employee_id,
        employee_name=template.employee.name if template.employee else None,
        name=template.name,
        description=template.description,
        start_time=template.start_time,
        end_time=template.end_time,
        break_minutes=template.break_minutes,
        template_type=template.template_type.value,
        day_of_week=template.day_of_week,
        day_of_month=template.day_of_month,
        week_of_month=template.week_of_month,
        start_date=template.start_date,
        end_date=template.end_date,
        is_active=template.is_active,
        requires_approval=template.requires_approval,
        department=template.department,
        job_role=template.job_role,
        created_at=template.created_at,
        created_by=template.created_by,
        updated_at=template.updated_at,
    )


@router.post("/shift-templates/{template_id}/generate", response_model=List[ShiftResponse])
@handle_endpoint_errors(operation_name="generate_shifts_from_template")
async def generate_shifts_from_template_endpoint(
    template_id: str,
    data: GenerateShiftsFromTemplate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate shifts from a template (admin only)."""
    parsed_template_id = parse_uuid(template_id, "Template ID")
    data.template_id = parsed_template_id
    
    shifts, conflicts = await generate_shifts_from_template(
        db,
        current_user.company_id,
        data,
    )
    
    return [
        ShiftResponse(
            id=shift.id,
            company_id=shift.company_id,
            employee_id=shift.employee_id,
            employee_name=shift.employee.name if shift.employee else None,
            shift_date=shift.shift_date,
            start_time=shift.start_time,
            end_time=shift.end_time,
            break_minutes=shift.break_minutes,
            notes=shift.notes,
            job_role=shift.job_role,
            status=shift.status.value,
            requires_approval=shift.requires_approval,
            template_id=shift.template_id,
            approved_by=shift.approved_by,
            approved_at=shift.approved_at,
            created_at=shift.created_at,
            created_by=shift.created_by,
            updated_at=shift.updated_at,
        )
        for shift in shifts
    ]
