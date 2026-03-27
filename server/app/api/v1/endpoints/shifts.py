"""
Shift and Schedule Management API Endpoints
"""
import logging
from typing import List, Optional, Dict
from uuid import UUID
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_admin, get_current_user, require_permission
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User, UserRole
from app.models.shift import Shift, ShiftStatus
from app.schemas.shift import (
    ShiftCreate,
    ShiftUpdate,
    ShiftResponse,
    ShiftResponseWithConflicts,
    ShiftConflict,
    ShiftTemplateCreate,
    ShiftTemplateUpdate,
    ShiftTemplateResponse,
    GenerateShiftsFromTemplate,
    GenerateShiftsFromTemplateBody,
    ScheduleSwapCreate,
    ScheduleSwapResponse,
    SendScheduleRequest,
)
from app.schemas.bulk_shift import (
    BulkWeekShiftCreate, BulkWeekShiftPreviewResponse, BulkWeekShiftCreateResponse,
)
from app.schemas.schedule_context import SchedulePageContextResponse
from app.schemas.user import UserResponse
from app.services.shift_service import (
    create_shift, update_shift, get_shift, list_shifts, delete_shift, approve_shift,
    create_shift_template, generate_shifts_from_template,
)
from app.services.bulk_shift_service import (
    preview_bulk_week_shifts, create_bulk_week_shifts,
)
from app.services.schedule_context_service import get_schedule_page_context
from app.services.user_service import list_employee_user_responses

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/shifts", response_model=ShiftResponseWithConflicts, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="create_shift")
async def create_shift_endpoint(
    data: ShiftCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new shift (admin only). No email is sent on create; use Send schedule to email employee.
    Returns the created shift and any overlapping conflicts (shift is still created)."""
    shift, conflicts = await create_shift(
        db,
        current_user.company_id,
        data,
        created_by=current_user.id,
    )

    result = await db.execute(select(User).where(User.id == shift.employee_id))
    employee = result.scalar_one_or_none()

    shift_response = ShiftResponse(
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
    return ShiftResponseWithConflicts(shift=shift_response, conflicts=conflicts)


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
    
    # Non-admin employees can only see their own shifts
    if current_user.role in [UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]:
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


@router.get("/schedules/employees", response_model=List[UserResponse])
@handle_endpoint_errors(operation_name="list_schedules_employees")
async def list_schedules_employees_endpoint(
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=1000),
    current_user: User = Depends(require_permission("schedule")),
    db: AsyncSession = Depends(get_db),
):
    """Employee list for scheduling UIs (same payload shape as GET /users/admin/employees; requires ``schedule``)."""
    return await list_employee_user_responses(db, current_user.company_id, skip, limit)


@router.get("/schedules/view-context", response_model=SchedulePageContextResponse)
@handle_endpoint_errors(operation_name="get_schedule_page_context")
async def get_schedule_page_context_endpoint(
    start_date: date = Query(..., description="Range start (inclusive)"),
    end_date: date = Query(..., description="Range end (inclusive)"),
    employee_id: Optional[str] = Query(None, description="Filter shifts by employee"),
    limit: int = Query(1000, ge=1, le=1000),
    current_user: User = Depends(require_permission("schedule")),
    db: AsyncSession = Depends(get_db),
):
    """Batch employees, shifts in range, and timeline hours. Requires ``schedule`` (not ``user_management``).
    Operational roles still only receive their own shifts in ``shifts`` (see ``list_shifts`` rules)."""
    return await get_schedule_page_context(
        db,
        current_user,
        start_date=start_date,
        end_date=end_date,
        employee_id=employee_id,
        shift_limit=limit,
    )


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
    """Create shifts for a whole week for multiple employees (admin only). No email is sent; use Send schedule to email employees."""
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


@router.post("/shifts/send-schedule")
@handle_endpoint_errors(operation_name="send_schedule")
async def send_schedule_endpoint(
    data: SendScheduleRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Send the schedule email for an employee for the given week (admin only).
    week_start_date must be a Monday; week is Monday through Sunday."""
    from app.services.email_service import email_service
    from sqlalchemy import and_

    # SendScheduleRequest validates week_start_date is Monday; so Monday + 6 = Sunday of same week
    week_end = data.week_start_date + timedelta(days=6)
    result = await db.execute(
        select(User).where(
            and_(User.id == data.employee_id, User.company_id == current_user.company_id)
        )
    )
    employee = result.scalar_one_or_none()
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    shift_result = await db.execute(
        select(Shift).where(
            and_(
                Shift.company_id == current_user.company_id,
                Shift.employee_id == data.employee_id,
                Shift.shift_date >= data.week_start_date,
                Shift.shift_date <= week_end,
                Shift.status != ShiftStatus.CANCELLED,
            )
        ).order_by(Shift.shift_date, Shift.start_time)
    )
    shifts = shift_result.scalars().all()

    shift_rows = []
    for s in shifts:
        start_str = s.start_time.strftime("%H:%M") if hasattr(s.start_time, "strftime") else str(s.start_time)
        end_str = s.end_time.strftime("%H:%M") if hasattr(s.end_time, "strftime") else str(s.end_time)
        shift_rows.append({
            "date": str(s.shift_date),
            "start_time": start_str,
            "end_time": end_str,
            "break_minutes": s.break_minutes or 0,
            "notes": s.notes,
            "job_role": s.job_role,
        })

    if not getattr(employee, "email", None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Employee has no email set",
        )

    ok = await email_service.send_schedule_notification(
        employee_email=employee.email,
        employee_name=employee.name or "Employee",
        shifts=shift_rows,
        week_start_date=data.week_start_date,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to send schedule email. Check Gmail configuration.",
        )
    return {"sent": True, "message": "Schedule sent to employee"}


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
    
    # Non-admin employees can only see their own shifts
    if current_user.role in [UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING] and shift.employee_id != current_user.id:
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


@router.put("/shifts/{shift_id}", response_model=ShiftResponseWithConflicts)
@handle_endpoint_errors(operation_name="update_shift")
async def update_shift_endpoint(
    shift_id: str,
    data: ShiftUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a shift (admin only). Returns the updated shift and any overlapping conflicts (shift is still updated)."""
    parsed_shift_id = parse_uuid(shift_id, "Shift ID")
    shift, conflicts = await update_shift(
        db,
        parsed_shift_id,
        current_user.company_id,
        data,
    )

    shift_response = ShiftResponse(
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
    return ShiftResponseWithConflicts(shift=shift_response, conflicts=conflicts)


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
    """Delete a shift (soft delete: sets status to CANCELLED and records audit note; admin only)."""
    parsed_shift_id = parse_uuid(shift_id, "Shift ID")
    await delete_shift(
        db,
        parsed_shift_id,
        current_user.company_id,
        deleted_by=current_user.id,
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
    data: GenerateShiftsFromTemplateBody,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate shifts from a template (admin only). template_id is from the URL path."""
    parsed_template_id = parse_uuid(template_id, "Template ID")
    payload = GenerateShiftsFromTemplate(
        template_id=parsed_template_id,
        start_date=data.start_date,
        end_date=data.end_date,
        employee_ids=data.employee_ids,
    )
    shifts, conflicts = await generate_shifts_from_template(
        db,
        current_user.company_id,
        payload,
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
