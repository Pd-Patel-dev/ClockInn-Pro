from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import date
from typing import Optional

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_admin
from app.models.user import User, UserRole
from app.models.time_entry import TimeEntryStatus
from app.schemas.time_entry import (
    TimeEntryCreate,
    TimeEntryEdit,
    TimeEntryResponse,
    TimeEntryListResponse,
    TimeEntryPunchMe,
    TimeEntryPunchByPin,
)
from app.services.time_entry_service import (
    punch,
    get_my_time_entries,
    get_admin_time_entries,
    edit_time_entry,
)

router = APIRouter()


@router.post("/punch", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
async def punch_endpoint(
    data: TimeEntryCreate,
    db: AsyncSession = Depends(get_db),
):
    """Punch in/out using email and PIN (kiosk mode). Public endpoint - no auth required."""
    from app.core.security import normalize_email
    
    # For kiosk, we need to find the employee first to get company_id
    if not data.employee_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Employee email is required for kiosk punch",
        )
    
    # Find employee to get company_id
    normalized_email = normalize_email(data.employee_email)
    result = await db.execute(
        select(User).where(
            and_(
                User.email == normalized_email,
                User.role == UserRole.EMPLOYEE,
                User.status == "active",
            )
        )
    )
    employee = result.scalar_one_or_none()
    
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    # Now punch with the employee's company_id
    entry = await punch(
        db,
        employee.company_id,
        data.employee_id,
        data.employee_email,
        data.pin,
        data.source,
    )
    
    # Get employee name
    result = await db.execute(select(User).where(User.id == entry.employee_id))
    employee = result.scalar_one_or_none()
    
    return TimeEntryResponse(
        id=entry.id,
        employee_id=entry.employee_id,
        employee_name=employee.name if employee else "Unknown",
        clock_in_at=entry.clock_in_at,
        clock_out_at=entry.clock_out_at,
        break_minutes=entry.break_minutes,
        source=entry.source,
        status=entry.status,
        note=entry.note,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.post("/punch-by-pin", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
async def punch_by_pin_endpoint(
    data: TimeEntryPunchByPin,
    db: AsyncSession = Depends(get_db),
):
    """Punch in/out using PIN only (kiosk mode). Public endpoint - no auth required."""
    from app.core.security import verify_pin
    from app.models.time_entry import TimeEntrySource
    
    # Find all active employees with PINs
    result = await db.execute(
        select(User).where(
            and_(
                User.role == UserRole.EMPLOYEE,
                User.status == "active",
                User.pin_hash.isnot(None),
            )
        )
    )
    employees = result.scalars().all()
    
    # Find employee by verifying PIN
    matching_employee = None
    for employee in employees:
        if employee.pin_hash and verify_pin(data.pin, employee.pin_hash):
            matching_employee = employee
            break
    
    if not matching_employee:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid PIN",
        )
    
    # Now punch with the employee's company_id
    # Skip PIN check since we already verified it above
    entry = await punch(
        db,
        matching_employee.company_id,
        matching_employee.id,
        None,  # No email needed
        data.pin,
        TimeEntrySource.KIOSK,
        skip_pin_verification=True,  # PIN already verified
    )
    
    return TimeEntryResponse(
        id=entry.id,
        employee_id=entry.employee_id,
        employee_name=matching_employee.name,
        clock_in_at=entry.clock_in_at,
        clock_out_at=entry.clock_out_at,
        break_minutes=entry.break_minutes,
        source=entry.source,
        status=entry.status,
        note=entry.note,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.post("/punch-me", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
async def punch_me_endpoint(
    data: TimeEntryPunchMe,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Punch in/out for authenticated user (web mode). Requires authentication."""
    from app.models.time_entry import TimeEntrySource
    
    # Check if user is an employee
    if current_user.role != UserRole.EMPLOYEE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only employees can punch in/out",
        )
    
    # Punch using authenticated user's ID
    entry = await punch(
        db,
        current_user.company_id,
        current_user.id,  # Use authenticated user's ID
        None,  # No email needed
        data.pin,
        TimeEntrySource.WEB,  # Source is WEB for authenticated users
    )
    
    return TimeEntryResponse(
        id=entry.id,
        employee_id=entry.employee_id,
        employee_name=current_user.name,
        clock_in_at=entry.clock_in_at,
        clock_out_at=entry.clock_out_at,
        break_minutes=entry.break_minutes,
        source=entry.source,
        status=entry.status,
        note=entry.note,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.get("/my", response_model=TimeEntryListResponse)
async def get_my_time_entries_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user's time entries."""
    entries, total = await get_my_time_entries(
        db,
        current_user.id,
        current_user.company_id,
        from_date,
        to_date,
        skip,
        limit,
    )
    
    # Get employee names
    from sqlalchemy import select
    employee_ids = {entry.employee_id for entry in entries}
    result = await db.execute(select(User).where(User.id.in_(employee_ids)))
    employees = {emp.id: emp.name for emp in result.scalars().all()}
    
    return TimeEntryListResponse(
        entries=[
            TimeEntryResponse(
                id=entry.id,
                employee_id=entry.employee_id,
                employee_name=employees.get(entry.employee_id, "Unknown"),
                clock_in_at=entry.clock_in_at,
                clock_out_at=entry.clock_out_at,
                break_minutes=entry.break_minutes,
                source=entry.source,
                status=entry.status,
                note=entry.note,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
            )
            for entry in entries
        ],
        total=total,
    )


@router.get("/admin/time", response_model=TimeEntryListResponse)
async def get_admin_time_entries_endpoint(
    employee_id: Optional[str] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    status: Optional[TimeEntryStatus] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get time entries for admin view."""
    from uuid import UUID
    emp_id = None
    if employee_id:
        try:
            emp_id = UUID(employee_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid employee ID",
            )
    
    entries, total = await get_admin_time_entries(
        db,
        current_user.company_id,
        emp_id,
        from_date,
        to_date,
        status,
        skip,
        limit,
    )
    
    # Get employee names
    from sqlalchemy import select
    employee_ids = {entry.employee_id for entry in entries}
    result = await db.execute(select(User).where(User.id.in_(employee_ids)))
    employees = {emp.id: emp.name for emp in result.scalars().all()}
    
    return TimeEntryListResponse(
        entries=[
            TimeEntryResponse(
                id=entry.id,
                employee_id=entry.employee_id,
                employee_name=employees.get(entry.employee_id, "Unknown"),
                clock_in_at=entry.clock_in_at,
                clock_out_at=entry.clock_out_at,
                break_minutes=entry.break_minutes,
                source=entry.source,
                status=entry.status,
                note=entry.note,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
            )
            for entry in entries
        ],
        total=total,
    )


@router.put("/admin/time/{entry_id}", response_model=TimeEntryResponse)
async def edit_time_entry_endpoint(
    entry_id: str,
    data: TimeEntryEdit,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit a time entry (admin only)."""
    from uuid import UUID
    try:
        e_id = UUID(entry_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid entry ID",
        )
    
    entry = await edit_time_entry(db, e_id, current_user.company_id, current_user.id, data)
    
    # Get employee name
    from sqlalchemy import select
    result = await db.execute(select(User).where(User.id == entry.employee_id))
    employee = result.scalar_one_or_none()
    
    return TimeEntryResponse(
        id=entry.id,
        employee_id=entry.employee_id,
        employee_name=employee.name if employee else "Unknown",
        clock_in_at=entry.clock_in_at,
        clock_out_at=entry.clock_out_at,
        break_minutes=entry.break_minutes,
        source=entry.source,
        status=entry.status,
        note=entry.note,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )

