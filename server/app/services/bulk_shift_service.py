"""
Bulk Shift Creation Service

Handles creating multiple shifts for a week for a single employee.
"""
from typing import List, Optional, Tuple, Dict
from uuid import UUID, uuid4
from datetime import date, time, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, delete
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status
import pytz

from app.models.shift import Shift, ShiftStatus
from app.models.user import User, UserRole
from app.schemas.bulk_shift import (
    BulkWeekShiftCreate, PreviewShift, ShiftConflictDetail,
    DayTemplate, BulkWeekShiftTemplate
)


# Day name to weekday number (Monday = 0, Sunday = 6)
DAY_MAP = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}


def get_week_dates(week_start: date) -> Dict[str, date]:
    """Get all dates for the week starting from Monday.
    
    Returns a dict mapping day names (mon-sun) to dates.
    """
    # Ensure week_start is a Monday
    days_since_monday = week_start.weekday()
    if days_since_monday != 0:
        week_start = week_start - timedelta(days=days_since_monday)
    
    dates = {}
    for day_name, offset in DAY_MAP.items():
        dates[day_name] = week_start + timedelta(days=offset)
    return dates


def parse_time_string(time_str: str) -> time:
    """Parse HH:mm string to time object."""
    parts = time_str.split(":")
    return time(int(parts[0]), int(parts[1]))


def check_shift_overlap(
    shift1_date: date,
    shift1_start: time,
    shift1_end: time,
    shift2_date: date,
    shift2_start: time,
    shift2_end: time,
) -> bool:
    """Check if two shifts overlap.
    
    Handles overnight shifts correctly.
    """
    # Convert times to datetime for comparison
    dt1_start = datetime.combine(shift1_date, shift1_start)
    dt1_end = datetime.combine(shift1_date, shift1_end)
    dt2_start = datetime.combine(shift2_date, shift2_start)
    dt2_end = datetime.combine(shift2_date, shift2_end)
    
    # Handle overnight shifts (end_time <= start_time means it spans midnight)
    if dt1_end <= dt1_start:
        dt1_end += timedelta(days=1)
    if dt2_end <= dt2_start:
        dt2_end += timedelta(days=1)
    
    # Normalize shift2 relative to shift1's start date
    if shift2_date != shift1_date:
        date_diff = (shift2_date - shift1_date).days
        dt2_start += timedelta(days=date_diff)
        dt2_end += timedelta(days=date_diff)
    
    # Check for overlap: shifts overlap if one starts before the other ends
    return dt1_start < dt2_end and dt2_start < dt1_end


async def find_conflicting_shifts(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
    shift_date: date,
    start_time: time,
    end_time: time,
    exclude_shift_ids: Optional[List[UUID]] = None,
) -> List[Shift]:
    """Find existing shifts that conflict with the given shift."""
    # Check shifts on the same date and previous/next day (for overnight)
    dates_to_check = [
        shift_date,
        shift_date - timedelta(days=1),
        shift_date + timedelta(days=1),
    ]
    
    query = select(Shift).where(
        and_(
            Shift.company_id == company_id,
            Shift.employee_id == employee_id,
            Shift.shift_date.in_(dates_to_check),
            Shift.status != ShiftStatus.CANCELLED,  # Ignore cancelled shifts
        )
    )
    
    if exclude_shift_ids:
        query = query.where(~Shift.id.in_(exclude_shift_ids))
    
    result = await db.execute(query)
    existing_shifts = result.scalars().all()
    
    # Filter to only actual overlaps
    conflicting = []
    for existing in existing_shifts:
        if check_shift_overlap(
            shift_date, start_time, end_time,
            existing.shift_date, existing.start_time, existing.end_time
        ):
            conflicting.append(existing)
    
    return conflicting


async def preview_bulk_week_shifts(
    db: AsyncSession,
    company_id: UUID,
    data: BulkWeekShiftCreate,
) -> Tuple[List[PreviewShift], List[ShiftConflictDetail]]:
    """Preview shifts that would be created without actually creating them."""
    # Verify employee exists and belongs to company
    result = await db.execute(
        select(User).where(
            and_(
                User.id == data.employee_id,
                User.company_id == company_id,
                User.role == UserRole.EMPLOYEE,
            )
        )
    )
    employee = result.scalar_one_or_none()
    
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee not found: {data.employee_id}"
        )
    
    # Get week dates
    week_dates = get_week_dates(data.week_start_date)
    
    preview_shifts = []
    conflicts = []
    
    # Generate preview for each enabled day
    employee_id = data.employee_id
    
    for day_name, shift_date in week_dates.items():
        day_config = data.days.get(day_name, DayTemplate(enabled=False))
        
        if not day_config.enabled:
            continue
        
        # Determine times for this day
        if data.mode == "same_each_day":
            start_time = parse_time_string(data.template.start_time)
            end_time = parse_time_string(data.template.end_time)
            break_minutes = data.template.break_minutes
        else:  # per_day mode
            if not day_config.start_time or not day_config.end_time:
                continue  # Should have been validated, but skip just in case
            start_time = parse_time_string(day_config.start_time)
            end_time = parse_time_string(day_config.end_time)
            break_minutes = day_config.break_minutes if day_config.break_minutes is not None else data.template.break_minutes
        
        # Check for conflicts
        conflicting = await find_conflicting_shifts(
            db, company_id, employee_id, shift_date, start_time, end_time
        )
        
        has_conflict = len(conflicting) > 0
        conflict_detail = None
        
        if has_conflict:
            # Create conflict detail for first conflict
            existing = conflicting[0]
            conflict_detail = ShiftConflictDetail(
                employee_id=employee_id,
                employee_name=employee.name,
                shift_date=shift_date,
                existing_shift_id=existing.id,
                existing_start_time=existing.start_time,
                existing_end_time=existing.end_time,
                new_start_time=start_time,
                new_end_time=end_time,
                message=f"Overlaps with existing shift on {existing.shift_date} ({existing.start_time} - {existing.end_time})"
            )
            conflicts.append(conflict_detail)
        
        # Create preview shift
        preview_shift = PreviewShift(
            employee_id=employee_id,
            employee_name=employee.name,
            shift_date=shift_date,
            start_time=start_time,
            end_time=end_time,
            break_minutes=break_minutes,
            status=data.template.status,
            notes=data.template.notes,
            job_role=data.template.job_role,
            has_conflict=has_conflict,
            conflict_detail=conflict_detail,
        )
        preview_shifts.append(preview_shift)
    
    return preview_shifts, conflicts


async def create_bulk_week_shifts(
    db: AsyncSession,
    company_id: UUID,
    data: BulkWeekShiftCreate,
    created_by: UUID,
) -> Tuple[int, int, int, List[UUID], List[PreviewShift], List[ShiftConflictDetail], Optional[UUID]]:
    """Create shifts for a whole week for multiple employees.
    
    Returns:
        (created_count, skipped_count, overwritten_count, created_shift_ids, skipped_shifts, conflicts, series_id)
    """
    # Generate a series ID for this bulk creation
    series_id = uuid4()
    
    # Get preview
    preview_shifts, conflicts = await preview_bulk_week_shifts(db, company_id, data)
    
    created_count = 0
    skipped_count = 0
    overwritten_count = 0
    created_shift_ids = []
    skipped_shifts = []
    
    # Group conflicts by employee and date for efficient handling
    conflicts_by_employee_date = {}
    for conflict in conflicts:
        key = (conflict.employee_id, conflict.shift_date)
        if key not in conflicts_by_employee_date:
            conflicts_by_employee_date[key] = []
        conflicts_by_employee_date[key].append(conflict)
    
    # Handle error policy: reject if any conflicts
    if data.conflict_policy == "error" and conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Conflicts detected. Cannot create shifts.",
                "conflicts": [c.dict() for c in conflicts]
            }
        )
    
    # Process each preview shift
    for preview in preview_shifts:
        if preview.has_conflict:
            if data.conflict_policy == "skip":
                skipped_count += 1
                skipped_shifts.append(preview)
                continue
            
            elif data.conflict_policy == "overwrite":
                # Find and cancel/delete conflicting shifts
                conflicting = await find_conflicting_shifts(
                    db, company_id, preview.employee_id,
                    preview.shift_date, preview.start_time, preview.end_time
                )
                
                for existing in conflicting:
                    # Delete the conflicting shift (as per recent requirement)
                    await db.execute(
                        delete(Shift).where(Shift.id == existing.id)
                    )
                    overwritten_count += 1
            
            elif data.conflict_policy == "draft":
                # Will create as draft with conflict note (handled below)
                pass
        
        # Create the shift
        # Determine status: use preview status if no conflict, otherwise DRAFT if draft policy
        if preview.has_conflict and data.conflict_policy == "draft":
            shift_status = ShiftStatus.DRAFT
        else:
            # Convert string status to enum, with fallback to DRAFT
            try:
                shift_status = ShiftStatus(preview.status.upper()) if preview.status else ShiftStatus.DRAFT
            except (ValueError, AttributeError):
                shift_status = ShiftStatus.DRAFT
        
        shift = Shift(
            id=uuid4(),
            company_id=company_id,
            employee_id=preview.employee_id,
            shift_date=preview.shift_date,
            start_time=preview.start_time,
            end_time=preview.end_time,
            break_minutes=preview.break_minutes,
            status=shift_status,
            notes=(
                f"{preview.notes or ''}\n[Conflict detected on creation]".strip()
                if preview.has_conflict and data.conflict_policy == "draft"
                else preview.notes
            ),
            job_role=preview.job_role,
            created_by=created_by,
            series_id=series_id,
        )
        
        db.add(shift)
        created_count += 1
        created_shift_ids.append(shift.id)
    
    await db.commit()
    
    return created_count, skipped_count, overwritten_count, created_shift_ids, skipped_shifts, conflicts, series_id

