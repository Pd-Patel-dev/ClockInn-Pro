"""
Shift and Schedule Management Service

Handles shift creation, conflict detection, template generation, and swap requests.
"""
from typing import List, Optional, Tuple
from uuid import UUID, uuid4
from datetime import date, time, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, case, delete
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.models.shift import Shift, ShiftTemplate, ScheduleSwap, ShiftStatus, ShiftTemplateType
from app.models.user import User, UserRole, UserStatus
from app.schemas.shift import (
    ShiftCreate, ShiftUpdate, ShiftConflict,
    ShiftTemplateCreate, ShiftTemplateUpdate,
    GenerateShiftsFromTemplate, ScheduleSwapCreate, ScheduleSwapUpdate
)


def check_shift_overlap(
    shift1_date: date,
    shift1_start: time,
    shift1_end: time,
    shift2_date: date,
    shift2_start: time,
    shift2_end: time,
) -> bool:
    """Check if two shifts overlap in time.
    
    Handles overnight shifts correctly by converting all times to absolute datetimes
    and checking for overlap, even across date boundaries.
    """
    # Convert times to datetime for comparison
    dt1_start = datetime.combine(shift1_date, shift1_start)
    dt1_end = datetime.combine(shift1_date, shift1_end)
    dt2_start = datetime.combine(shift2_date, shift2_start)
    dt2_end = datetime.combine(shift2_date, shift2_end)
    
    # Handle overnight shifts (end time <= start time means it spans midnight)
    if dt1_end <= dt1_start:
        dt1_end += timedelta(days=1)
    if dt2_end <= dt2_start:
        dt2_end += timedelta(days=1)
    
    # Normalize shift2 relative to shift1's start date for cross-day comparison
    # If shift2_date is different from shift1_date, adjust its datetimes
    if shift2_date != shift1_date:
        date_diff = (shift2_date - shift1_date).days
        dt2_start += timedelta(days=date_diff)
        dt2_end += timedelta(days=date_diff)
    
    # Check for overlap: shifts overlap if one starts before the other ends
    return dt1_start < dt2_end and dt2_start < dt1_end


async def detect_shift_conflicts(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
    shift_date: date,
    start_time: time,
    end_time: time,
    exclude_shift_id: Optional[UUID] = None,
) -> List[ShiftConflict]:
    """Detect conflicts for a shift before creation/update.
    
    Handles overnight shifts correctly by checking:
    1. Shifts on the start date
    2. Shifts on the next day (if this is an overnight shift)
    3. Overnight shifts from the previous day that end on shift_date
    """
    conflicts = []
    
    # Determine if this is an overnight shift (end_time <= start_time means it spans midnight)
    is_overnight = end_time <= start_time
    
    # Dates to check for conflicts
    dates_to_check = [shift_date]
    if is_overnight:
        # For overnight shifts, also check the next day
        dates_to_check.append(shift_date + timedelta(days=1))
    
    # Also check previous day for overnight shifts that might end on shift_date
    dates_to_check.append(shift_date - timedelta(days=1))
    
    # Remove duplicates and ensure dates are valid
    dates_to_check = list(set(dates_to_check))
    
    # Find all shifts for this employee on the relevant dates
    query = select(Shift).where(
        and_(
            Shift.company_id == company_id,
            Shift.employee_id == employee_id,
            Shift.shift_date.in_(dates_to_check),
            Shift.status != ShiftStatus.CANCELLED,
        )
    )
    
    if exclude_shift_id:
        query = query.where(Shift.id != exclude_shift_id)
    
    result = await db.execute(query)
    existing_shifts = result.scalars().all()
    
    for existing_shift in existing_shifts:
        if check_shift_overlap(
            shift_date, start_time, end_time,
            existing_shift.shift_date, existing_shift.start_time, existing_shift.end_time
        ):
            # Get employee name
            emp_result = await db.execute(select(User).where(User.id == employee_id))
            employee = emp_result.scalar_one_or_none()
            employee_name = employee.name if employee else "Unknown"
            
            conflicts.append(ShiftConflict(
                conflict_type="overlap",
                conflicting_shift_id=existing_shift.id,
                conflicting_shift_date=existing_shift.shift_date,
                conflicting_employee_id=employee_id,
                conflicting_employee_name=employee_name,
                message=f"Shift overlaps with existing shift on {existing_shift.shift_date} ({existing_shift.start_time} - {existing_shift.end_time})"
            ))
    
    return conflicts


async def create_shift(
    db: AsyncSession,
    company_id: UUID,
    data: ShiftCreate,
    created_by: Optional[UUID] = None,
) -> Tuple[Shift, List[ShiftConflict]]:
    """Create a new shift with conflict detection."""
    # Verify employee exists and belongs to company (any role except ADMIN/DEVELOPER)
    result = await db.execute(
        select(User).where(
            and_(
                User.id == data.employee_id,
                User.company_id == company_id,
                User.role.in_([UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]),
            )
        )
    )
    employee = result.scalar_one_or_none()
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found or is not an employee",
        )
    
    # Check for conflicts
    conflicts = await detect_shift_conflicts(
        db, company_id, data.employee_id, data.shift_date, data.start_time, data.end_time
    )
    
    # Create shift (even if conflicts exist - admin can override)
    shift = Shift(
        id=uuid4(),
        company_id=company_id,
        employee_id=data.employee_id,
        shift_date=data.shift_date,
        start_time=data.start_time,
        end_time=data.end_time,
        break_minutes=data.break_minutes,
        notes=data.notes,
        job_role=data.job_role,
        requires_approval=data.requires_approval,
        status=ShiftStatus.DRAFT,
        created_by=created_by,
    )
    
    db.add(shift)
    await db.commit()
    await db.refresh(shift)
    
    return shift, conflicts


async def update_shift(
    db: AsyncSession,
    shift_id: UUID,
    company_id: UUID,
    data: ShiftUpdate,
) -> Tuple[Shift, List[ShiftConflict]]:
    """Update an existing shift with conflict detection."""
    result = await db.execute(
        select(Shift).where(
            and_(
                Shift.id == shift_id,
                Shift.company_id == company_id,
            )
        )
    )
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shift not found",
        )
    
    # Get updated values
    new_date = data.shift_date if data.shift_date is not None else shift.shift_date
    new_start = data.start_time if data.start_time is not None else shift.start_time
    new_end = data.end_time if data.end_time is not None else shift.end_time
    
    # Check for conflicts (excluding current shift)
    conflicts = await detect_shift_conflicts(
        db, company_id, shift.employee_id, new_date, new_start, new_end, exclude_shift_id=shift_id
    )
    
    # Update shift
    if data.shift_date is not None:
        shift.shift_date = data.shift_date
    if data.start_time is not None:
        shift.start_time = data.start_time
    if data.end_time is not None:
        shift.end_time = data.end_time
    if data.break_minutes is not None:
        shift.break_minutes = data.break_minutes
    if data.notes is not None:
        shift.notes = data.notes
    if data.job_role is not None:
        shift.job_role = data.job_role
    if data.status is not None:
        shift.status = ShiftStatus(data.status)
    if data.requires_approval is not None:
        shift.requires_approval = data.requires_approval
    
    await db.commit()
    await db.refresh(shift)
    
    return shift, conflicts


async def get_shift(
    db: AsyncSession,
    shift_id: UUID,
    company_id: UUID,
) -> Optional[Shift]:
    """Get a shift by ID."""
    result = await db.execute(
        select(Shift).options(
            selectinload(Shift.employee),
            selectinload(Shift.approver),
            selectinload(Shift.creator),
        ).where(
            and_(
                Shift.id == shift_id,
                Shift.company_id == company_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def list_shifts(
    db: AsyncSession,
    company_id: UUID,
    employee_id: Optional[UUID] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> Tuple[List[Shift], int]:
    """List shifts with filters.
    
    Handles overnight shifts correctly:
    - Includes shifts that start on or before end_date
    - Includes shifts that are overnight and end on or after start_date
    - For date range filtering, we need to check:
      1. shift_date is within range (normal case)
      2. shift is overnight and end_date (shift_date + 1) falls within range
    - Excludes CANCELLED shifts by default (unless explicitly requested)
    """
    query = select(Shift).where(Shift.company_id == company_id)
    
    # Exclude CANCELLED shifts by default (unless explicitly requested)
    if status:
        try:
            # Convert string status to enum (case-insensitive)
            status_enum = ShiftStatus(status.upper())
            query = query.where(Shift.status == status_enum)
        except (ValueError, AttributeError):
            # Invalid status provided, return empty results
            return [], 0
    else:
        # If no status filter provided, exclude CANCELLED shifts
        query = query.where(Shift.status != ShiftStatus.CANCELLED)
    
    if employee_id:
        query = query.where(Shift.employee_id == employee_id)
    
    if start_date or end_date:
        # Build filter for overnight shifts
        # Strategy: Extend the date range to include shifts that might spill into our range
        # We check:
        # 1. shift_date falls within the extended range (includes 1 day before and after)
        # 2. Then filter in Python for actual overlaps (this is more reliable than complex SQL)
        
        # Extend range by 1 day on each side to catch overnight shifts
        extended_start = start_date - timedelta(days=1) if start_date else None
        extended_end = end_date + timedelta(days=1) if end_date else None
        
        if extended_start:
            query = query.where(Shift.shift_date >= extended_start)
        if extended_end:
            query = query.where(Shift.shift_date <= extended_end)
    
    # Get total count - use a separate simpler query for better reliability
    count_query = select(func.count(Shift.id)).where(Shift.company_id == company_id)
    
    # Exclude CANCELLED shifts by default (unless explicitly requested)
    if status:
        try:
            status_enum = ShiftStatus(status.upper())
            count_query = count_query.where(Shift.status == status_enum)
        except (ValueError, AttributeError):
            return [], 0
    else:
        count_query = count_query.where(Shift.status != ShiftStatus.CANCELLED)
    
    if employee_id:
        count_query = count_query.where(Shift.employee_id == employee_id)
    
    if start_date or end_date:
        extended_start = start_date - timedelta(days=1) if start_date else None
        extended_end = end_date + timedelta(days=1) if end_date else None
        if extended_start:
            count_query = count_query.where(Shift.shift_date >= extended_start)
        if extended_end:
            count_query = count_query.where(Shift.shift_date <= extended_end)
    
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0
    
    # Get paginated results with eager loading
    query = query.options(
        selectinload(Shift.employee),
        selectinload(Shift.approver),
    ).order_by(Shift.shift_date.desc(), Shift.start_time).offset(skip).limit(limit)
    
    result = await db.execute(query)
    shifts = result.scalars().all()
    
    return list(shifts), total


async def create_shift_template(
    db: AsyncSession,
    company_id: UUID,
    data: ShiftTemplateCreate,
    created_by: Optional[UUID] = None,
) -> ShiftTemplate:
    """Create a shift template."""
    # Verify employee if provided
    if data.employee_id:
        result = await db.execute(
            select(User).where(
                and_(
                    User.id == data.employee_id,
                    User.company_id == company_id,
                )
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )
    
    template = ShiftTemplate(
        id=uuid4(),
        company_id=company_id,
        employee_id=data.employee_id,
        name=data.name,
        description=data.description,
        start_time=data.start_time,
        end_time=data.end_time,
        break_minutes=data.break_minutes,
        template_type=ShiftTemplateType(data.template_type),
        day_of_week=data.day_of_week,
        day_of_month=data.day_of_month,
        week_of_month=data.week_of_month,
        start_date=data.start_date,
        end_date=data.end_date,
        is_active=data.is_active,
        requires_approval=data.requires_approval,
        department=data.department,
        job_role=data.job_role,
        created_by=created_by,
    )
    
    db.add(template)
    await db.commit()
    await db.refresh(template)
    
    return template


async def generate_shifts_from_template(
    db: AsyncSession,
    company_id: UUID,
    data: GenerateShiftsFromTemplate,
) -> Tuple[List[Shift], List[ShiftConflict]]:
    """Generate shifts from a template."""
    # Get template
    result = await db.execute(
        select(ShiftTemplate).where(
            and_(
                ShiftTemplate.id == data.template_id,
                ShiftTemplate.company_id == company_id,
                ShiftTemplate.is_active == True,
            )
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found or is not active",
        )
    
    # Determine employees to create shifts for
    employee_ids = data.employee_ids if data.employee_ids else []
    if not employee_ids and template.employee_id:
        employee_ids = [template.employee_id]
    
    if not employee_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No employees specified for shift generation",
        )
    
    # Generate dates based on template type
    dates_to_create = []
    current_date = max(data.start_date, template.start_date)
    end_date = min(data.end_date, template.end_date) if template.end_date else data.end_date
    
    while current_date <= end_date:
        should_create = False
        
        if template.template_type == ShiftTemplateType.NONE:
            should_create = current_date == template.start_date
        elif template.template_type == ShiftTemplateType.WEEKLY:
            if template.day_of_week is not None:
                should_create = current_date.weekday() == template.day_of_week
        elif template.template_type == ShiftTemplateType.BIWEEKLY:
            if template.day_of_week is not None:
                # Check if it's the right day of week and correct week (biweekly)
                days_since_start = (current_date - template.start_date).days
                should_create = (
                    current_date.weekday() == template.day_of_week and
                    days_since_start % 14 < 7  # Every 2 weeks
                )
        elif template.template_type == ShiftTemplateType.MONTHLY:
            if template.day_of_month is not None:
                should_create = current_date.day == template.day_of_month
        
        if should_create:
            dates_to_create.append(current_date)
        
        current_date += timedelta(days=1)
    
    # Create shifts
    created_shifts = []
    all_conflicts = []
    
    for shift_date in dates_to_create:
        for employee_id in employee_ids:
            # Check for conflicts
            conflicts = await detect_shift_conflicts(
                db, company_id, employee_id, shift_date, template.start_time, template.end_time
            )
            all_conflicts.extend(conflicts)
            
            # Create shift
            shift = Shift(
                id=uuid4(),
                company_id=company_id,
                employee_id=employee_id,
                shift_date=shift_date,
                start_time=template.start_time,
                end_time=template.end_time,
                break_minutes=template.break_minutes,
                job_role=template.job_role,
                requires_approval=template.requires_approval,
                status=ShiftStatus.PUBLISHED,
                template_id=template.id,
            )
            db.add(shift)
            created_shifts.append(shift)
    
    await db.commit()
    
    # Refresh all shifts
    for shift in created_shifts:
        await db.refresh(shift)
    
    return created_shifts, all_conflicts


async def approve_shift(
    db: AsyncSession,
    shift_id: UUID,
    company_id: UUID,
    approved_by: UUID,
) -> Shift:
    """Approve a shift."""
    shift = await get_shift(db, shift_id, company_id)
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shift not found",
        )
    
    shift.status = ShiftStatus.APPROVED
    shift.approved_by = approved_by
    shift.approved_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(shift)
    
    return shift


async def delete_shift(
    db: AsyncSession,
    shift_id: UUID,
    company_id: UUID,
) -> None:
    """Delete a shift (permanently removes it from the database)."""
    shift = await get_shift(db, shift_id, company_id)
    if not shift:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shift not found",
        )
    
    # Actually delete the shift from the database
    await db.execute(
        delete(Shift).where(
            and_(
                Shift.id == shift_id,
                Shift.company_id == company_id,
            )
        )
    )
    await db.commit()

