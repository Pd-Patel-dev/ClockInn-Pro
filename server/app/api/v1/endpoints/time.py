from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import date
from typing import Optional
from uuid import UUID
import uuid

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_admin, get_current_verified_user
from app.core.error_handling import handle_endpoint_errors, parse_uuid
from app.models.user import User, UserRole, UserStatus
from app.models.time_entry import TimeEntryStatus
from app.schemas.time_entry import (
    TimeEntryCreate,
    TimeEntryEdit,
    TimeEntryResponse,
    TimeEntryListResponse,
    TimeEntryPunchMe,
    TimeEntryPunchByPin,
    TimeEntryManualCreate,
)
from app.services.time_entry_service import (
    punch,
    get_my_time_entries,
    get_admin_time_entries,
    edit_time_entry,
)
from app.models.time_entry import TimeEntry

router = APIRouter()


async def get_rounded_hours_for_entry(
    db: AsyncSession,
    entry: TimeEntry,
    company_id: UUID,
) -> tuple[Optional[float], Optional[int]]:
    """Helper to calculate rounded hours for a time entry."""
    from app.services.time_entry_service import calculate_rounded_hours
    return await calculate_rounded_hours(db, entry, company_id)


async def get_timezone_formatted_times(
    db: AsyncSession,
    entry: TimeEntry,
    company_id: UUID,
) -> tuple[Optional[str], Optional[str], str]:
    """Helper to format times in company timezone."""
    from app.services.timezone_service import (
        get_company_timezone,
        format_datetime_for_company,
    )
    timezone_str = await get_company_timezone(db, company_id)
    
    clock_in_local = format_datetime_for_company(entry.clock_in_at, timezone_str) if entry.clock_in_at else None
    clock_out_local = format_datetime_for_company(entry.clock_out_at, timezone_str) if entry.clock_out_at else None
    
    return clock_in_local, clock_out_local, timezone_str


async def build_time_entry_response(
    db: AsyncSession,
    entry: TimeEntry,
    employee_name: str,
    company_id: UUID,
) -> TimeEntryResponse:
    """Build a TimeEntryResponse from a TimeEntry with all computed fields."""
    rounded_hours, rounded_minutes = await get_rounded_hours_for_entry(db, entry, company_id)
    clock_in_local, clock_out_local, timezone_str = await get_timezone_formatted_times(db, entry, company_id)
    
    return TimeEntryResponse(
        id=entry.id,
        employee_id=entry.employee_id,
        employee_name=employee_name,
        clock_in_at=entry.clock_in_at,
        clock_out_at=entry.clock_out_at,
        break_minutes=entry.break_minutes,
        source=entry.source,
        status=entry.status,
        note=entry.note,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        rounded_hours=rounded_hours,
        rounded_minutes=rounded_minutes,
        clock_in_at_local=clock_in_local,
        clock_out_at_local=clock_out_local,
        company_timezone=timezone_str,
        ip_address=entry.ip_address,
        user_agent=entry.user_agent,
        clock_out_ip_address=entry.clock_out_ip_address,
        clock_out_user_agent=entry.clock_out_user_agent,
        clock_in_latitude=entry.clock_in_latitude,
        clock_in_longitude=entry.clock_in_longitude,
        clock_out_latitude=entry.clock_out_latitude,
        clock_out_longitude=entry.clock_out_longitude,
    )


@router.post("/punch", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="punch")
async def punch_endpoint(
    data: TimeEntryCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Punch in/out using email and PIN (kiosk mode). Public endpoint - no auth required."""
    from app.core.security import normalize_email
    
    # Get client IP address and user agent
    client_ip = request.client.host if request.client else None
    # Check for forwarded IP (if behind proxy)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    user_agent = request.headers.get("User-Agent")
    
    # For kiosk, we need to find the employee first to get company_id
    if not data.employee_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Employee email is required for kiosk punch",
        )
    
    # Find employee to get company_id (any role except ADMIN/DEVELOPER)
    normalized_email = normalize_email(data.employee_email)
    result = await db.execute(
        select(User).where(
            and_(
                User.email == normalized_email,
                User.role.in_([UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]),
                User.status == UserStatus.ACTIVE,
            )
        )
    )
    employee = result.scalar_one_or_none()
    
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    # Check if employee's email is verified
    from app.services.verification_service import check_verification_required
    if check_verification_required(employee):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "EMAIL_VERIFICATION_REQUIRED",
                "message": "Your email must be verified to punch in/out. Please verify your email first.",
            }
        )
    
    # Now punch with the employee's company_id
    entry = await punch(
        db,
        employee.company_id,
        employee.id,
        None,
        data.pin,
        data.source,
        skip_pin_verification=False,
        cash_start_cents=data.cash_start_cents,
        cash_end_cents=data.cash_end_cents,
        collected_cash_cents=data.collected_cash_cents,
        beverages_cash_cents=data.beverages_cash_cents,
        ip_address=client_ip,
        user_agent=user_agent,
        latitude=data.latitude,
        longitude=data.longitude,
    )
    
    return await build_time_entry_response(db, entry, employee.name, employee.company_id)


@router.post("/punch-by-pin", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="punch_by_pin")
async def punch_by_pin_endpoint(
    request: Request,
    data: TimeEntryPunchByPin,
    db: AsyncSession = Depends(get_db),
):
    """Punch in/out using PIN only (kiosk mode). Public endpoint - no auth required."""
    from app.core.security import verify_pin
    from app.models.time_entry import TimeEntrySource
    
    # Capture IP and User-Agent
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
    if client_ip and "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()
    user_agent = request.headers.get("User-Agent")
    
    # Find all active employees with PINs (any role except ADMIN/DEVELOPER)
    result = await db.execute(
        select(User).where(
            and_(
                User.role.in_([UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]),
                User.status == UserStatus.ACTIVE,
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
    
    # Check if employee's email is verified
    from app.services.verification_service import check_verification_required
    if check_verification_required(matching_employee):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "EMAIL_VERIFICATION_REQUIRED",
                "message": "Your email must be verified to punch in/out. Please verify your email first.",
            }
        )
    
    # Now punch with the employee's company_id
    # Skip PIN check since we already verified it above
    # Note: punch_by_pin doesn't support cash drawer - use /punch endpoint instead
    entry = await punch(
        db,
        matching_employee.company_id,
        matching_employee.id,
        None,  # No email needed
        data.pin,
        TimeEntrySource.KIOSK,
        skip_pin_verification=True,  # PIN already verified
        ip_address=client_ip,
        user_agent=user_agent,
    )
    
    # Calculate rounded hours
    rounded_hours, rounded_minutes = await get_rounded_hours_for_entry(
        db, entry, matching_employee.company_id
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
        rounded_hours=rounded_hours,
        rounded_minutes=rounded_minutes,
        ip_address=entry.ip_address,
        user_agent=entry.user_agent,
        clock_out_ip_address=entry.clock_out_ip_address,
        clock_out_user_agent=entry.clock_out_user_agent,
        clock_in_latitude=entry.clock_in_latitude,
        clock_in_longitude=entry.clock_in_longitude,
        clock_out_latitude=entry.clock_out_latitude,
        clock_out_longitude=entry.clock_out_longitude,
    )


@router.post("/punch-me", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="punch_me")
async def punch_me_endpoint(
    request: Request,
    data: TimeEntryPunchMe,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_db),
):
    """Punch in/out for authenticated user (web mode). Requires authentication."""
    from app.models.time_entry import TimeEntrySource
    
    # Capture IP and User-Agent
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else None)
    if client_ip and "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()
    user_agent = request.headers.get("User-Agent")
    
    # Check if user is an employee (any role except ADMIN/DEVELOPER)
    if current_user.role not in [UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]:
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
        skip_pin_verification=False,
        cash_start_cents=data.cash_start_cents,
        cash_end_cents=data.cash_end_cents,
        collected_cash_cents=data.collected_cash_cents,
        beverages_cash_cents=data.beverages_cash_cents,
        ip_address=client_ip,
        user_agent=user_agent,
        latitude=data.latitude,
        longitude=data.longitude,
    )
    
    # Calculate rounded hours
    rounded_hours, rounded_minutes = await get_rounded_hours_for_entry(
        db, entry, current_user.company_id
    )
    
    # Get timezone-formatted times
    clock_in_local, clock_out_local, timezone_str = await get_timezone_formatted_times(
        db, entry, current_user.company_id
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
        rounded_hours=rounded_hours,
        rounded_minutes=rounded_minutes,
        clock_in_at_local=clock_in_local,
        clock_out_at_local=clock_out_local,
        company_timezone=timezone_str,
        ip_address=entry.ip_address,
        user_agent=entry.user_agent,
        clock_out_ip_address=entry.clock_out_ip_address,
        clock_out_user_agent=entry.clock_out_user_agent,
        clock_in_latitude=entry.clock_in_latitude,
        clock_in_longitude=entry.clock_in_longitude,
        clock_out_latitude=entry.clock_out_latitude,
        clock_out_longitude=entry.clock_out_longitude,
    )


@router.get("/my", response_model=TimeEntryListResponse)
@handle_endpoint_errors(operation_name="get_my_time_entries")
async def get_my_time_entries_endpoint(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_verified_user),
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
    
    from app.services.time_entry_service import calculate_rounded_hours
    
    response_entries = []
    for entry in entries:
        rounded_hours, rounded_minutes = await calculate_rounded_hours(
            db, entry, current_user.company_id
        )
        clock_in_local, clock_out_local, timezone_str = await get_timezone_formatted_times(
            db, entry, current_user.company_id
        )
        response_entries.append(
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
                rounded_hours=rounded_hours,
                rounded_minutes=rounded_minutes,
                clock_in_at_local=clock_in_local,
                clock_out_at_local=clock_out_local,
                company_timezone=timezone_str,
                ip_address=entry.ip_address,
                user_agent=entry.user_agent,
                clock_out_ip_address=entry.clock_out_ip_address,
                clock_out_user_agent=entry.clock_out_user_agent,
                clock_in_latitude=entry.clock_in_latitude,
                clock_in_longitude=entry.clock_in_longitude,
                clock_out_latitude=entry.clock_out_latitude,
                clock_out_longitude=entry.clock_out_longitude,
            )
        )
    
    return TimeEntryListResponse(
        entries=response_entries,
        total=total,
    )


@router.get("/admin/time", response_model=TimeEntryListResponse)
@handle_endpoint_errors(operation_name="get_admin_time_entries")
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
    emp_id = None
    if employee_id:
        emp_id = parse_uuid(employee_id, "Employee ID")
    
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
    
    from app.services.time_entry_service import calculate_rounded_hours
    
    # Get editor names for any edited entries
    editor_ids = {entry.edited_by for entry in entries if entry.edited_by}
    editor_result = await db.execute(select(User).where(User.id.in_(editor_ids))) if editor_ids else None
    editors = {emp.id: emp.name for emp in editor_result.scalars().all()} if editor_result else {}
    
    response_entries = []
    for entry in entries:
        rounded_hours, rounded_minutes = await calculate_rounded_hours(
            db, entry, current_user.company_id
        )
        clock_in_local, clock_out_local, timezone_str = await get_timezone_formatted_times(
            db, entry, current_user.company_id
        )
        response_entries.append(
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
                rounded_hours=rounded_hours,
                rounded_minutes=rounded_minutes,
                clock_in_at_local=clock_in_local,
                clock_out_at_local=clock_out_local,
                company_timezone=timezone_str,
                ip_address=entry.ip_address,
                user_agent=entry.user_agent,
                clock_out_ip_address=entry.clock_out_ip_address,
                clock_out_user_agent=entry.clock_out_user_agent,
                clock_in_latitude=entry.clock_in_latitude,
                clock_in_longitude=entry.clock_in_longitude,
                clock_out_latitude=entry.clock_out_latitude,
                clock_out_longitude=entry.clock_out_longitude,
                edited_by_name=editors.get(entry.edited_by) if entry.edited_by else None,
            )
        )
    
    return TimeEntryListResponse(
        entries=response_entries,
        total=total,
    )


@router.post("/admin/time/manual", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_manual_time_entry_endpoint(
    data: TimeEntryManualCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a manual time entry (admin only)."""
    from app.models.time_entry import TimeEntry, TimeEntrySource, TimeEntryStatus
    
    # Verify employee exists and belongs to company (any role except ADMIN/DEVELOPER)
    result = await db.execute(
        select(User).where(
            and_(
                User.id == data.employee_id,
                User.company_id == current_user.company_id,
                User.role.in_([UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]),
            )
        )
    )
    employee = result.scalar_one_or_none()
    
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )
    
    # Create manual time entry
    entry = TimeEntry(
        id=uuid.uuid4(),
        company_id=current_user.company_id,
        employee_id=data.employee_id,
        clock_in_at=data.clock_in_at,
        clock_out_at=data.clock_out_at,
        break_minutes=data.break_minutes,
        note=data.note,
        source=TimeEntrySource.WEB,
        status=TimeEntryStatus.CLOSED if data.clock_out_at else TimeEntryStatus.OPEN,
    )
    
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    
    # Calculate rounded hours
    rounded_hours, rounded_minutes = await get_rounded_hours_for_entry(
        db, entry, current_user.company_id
    )
    
    # Get timezone-formatted times
    clock_in_local, clock_out_local, timezone_str = await get_timezone_formatted_times(
        db, entry, current_user.company_id
    )
    
    return TimeEntryResponse(
        id=entry.id,
        employee_id=entry.employee_id,
        employee_name=employee.name,
        clock_in_at=entry.clock_in_at,
        clock_out_at=entry.clock_out_at,
        break_minutes=entry.break_minutes,
        source=entry.source,
        status=entry.status,
        note=entry.note,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        rounded_hours=rounded_hours,
        rounded_minutes=rounded_minutes,
        clock_in_at_local=clock_in_local,
        clock_out_at_local=clock_out_local,
        company_timezone=timezone_str,
        ip_address=entry.ip_address,
        user_agent=entry.user_agent,
        clock_out_ip_address=entry.clock_out_ip_address,
        clock_out_user_agent=entry.clock_out_user_agent,
        clock_in_latitude=entry.clock_in_latitude,
        clock_in_longitude=entry.clock_in_longitude,
        clock_out_latitude=entry.clock_out_latitude,
        clock_out_longitude=entry.clock_out_longitude,
    )


@router.put("/admin/time/{entry_id}", response_model=TimeEntryResponse)
@handle_endpoint_errors(operation_name="edit_time_entry")
async def edit_time_entry_endpoint(
    entry_id: str,
    data: TimeEntryEdit,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit a time entry (admin only)."""
    e_id = parse_uuid(entry_id, "Time entry ID")
    
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
        ip_address=entry.ip_address,
        user_agent=entry.user_agent,
        clock_out_ip_address=entry.clock_out_ip_address,
        clock_out_user_agent=entry.clock_out_user_agent,
        clock_in_latitude=entry.clock_in_latitude,
        clock_in_longitude=entry.clock_in_longitude,
        clock_out_latitude=entry.clock_out_latitude,
        clock_out_longitude=entry.clock_out_longitude,
        edited_by_name=current_user.name,
    )


@router.delete("/admin/time/{entry_id}")
@handle_endpoint_errors(operation_name="delete_time_entry")
async def delete_time_entry_endpoint(
    entry_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a time entry (admin only)."""
    from app.models.audit_log import AuditLog
    
    e_id = parse_uuid(entry_id, "Time entry ID")
    
    # Find entry and verify it belongs to the company
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.id == e_id,
                TimeEntry.company_id == current_user.company_id
            )
        )
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Time entry not found",
        )
    
    # Get employee name for audit log
    employee_result = await db.execute(select(User).where(User.id == entry.employee_id))
    employee = employee_result.scalar_one_or_none()
    employee_name = employee.name if employee else "Unknown"
    
    # Create audit log before deleting
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=current_user.company_id,
        actor_user_id=current_user.id,
        action="time_entry_deleted",
        entity_type="time_entry",
        entity_id=entry.id,
        metadata_json={
            "employee_id": str(entry.employee_id),
            "employee_name": employee_name,
            "clock_in_at": entry.clock_in_at.isoformat() if entry.clock_in_at else None,
            "clock_out_at": entry.clock_out_at.isoformat() if entry.clock_out_at else None,
        },
    )
    db.add(audit_log)
    
    # Delete the entry
    from sqlalchemy import delete
    await db.execute(delete(TimeEntry).where(TimeEntry.id == e_id))
    await db.commit()
    
    return {"message": "Time entry deleted successfully"}

