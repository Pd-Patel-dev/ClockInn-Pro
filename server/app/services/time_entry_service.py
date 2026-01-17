from typing import Optional, List, Tuple
from uuid import UUID
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from fastapi import HTTPException, status

from app.models.time_entry import TimeEntry, TimeEntryStatus, TimeEntrySource
from app.models.user import User, UserRole, UserStatus
from app.core.query_builder import get_paginated_results, build_employee_company_filtered_query, build_company_filtered_query, filter_by_date_range, filter_by_status
from app.core.security import verify_pin, normalize_email
from app.schemas.time_entry import TimeEntryEdit
from app.services.rounding_service import (
    compute_minutes_with_rounding_and_breaks,
    get_company_rounding_policy,
)
import uuid


async def punch(
    db: AsyncSession,
    company_id: UUID,
    employee_id: Optional[UUID],
    employee_email: Optional[str],
    pin: str,
    source: TimeEntrySource = TimeEntrySource.KIOSK,
    skip_pin_verification: bool = False,
    cash_start_cents: Optional[int] = None,
    cash_end_cents: Optional[int] = None,
    collected_cash_cents: Optional[int] = None,
    beverages_cash_cents: Optional[int] = None,
) -> TimeEntry:
    """Handle clock in/out punch."""
    # Find employee
    if employee_id:
        result = await db.execute(
            select(User).where(
                and_(
                    User.id == employee_id,
                    User.company_id == company_id,
                    User.role == UserRole.EMPLOYEE,
                    User.status == UserStatus.ACTIVE,
                )
            )
        )
    elif employee_email:
        normalized_email = normalize_email(employee_email)
        result = await db.execute(
            select(User).where(
                and_(
                    User.email == normalized_email,
                    User.company_id == company_id,
                    User.role == UserRole.EMPLOYEE,
                    User.status == UserStatus.ACTIVE,
                )
            )
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either employee_id or employee_email required",
        )
    
    employee = result.scalar_one_or_none()
    if not employee:
        if employee_email:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No active employee found with email {employee_email}",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee with ID {employee_id} not found or is not active",
            )
    
    # Only verify PIN if not skipped (for cases where PIN was already verified)
    if not skip_pin_verification:
        if not employee.pin_hash:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"PIN is not configured for employee {employee.email}. Please contact your administrator to set up a PIN.",
            )
        
        if not verify_pin(pin, employee.pin_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The PIN you entered is incorrect. Please try again.",
            )
    
    # Get company settings to check cash drawer requirements
    from app.models.company import Company
    from app.services.company_service import get_company_settings
    from app.services.cash_drawer_service import (
        requires_cash_drawer,
        create_cash_drawer_session,
        close_cash_drawer_session,
    )
    from app.models.cash_drawer import CashCountSource
    
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    
    company_settings = get_company_settings(company)
    # Convert role to string (handles both enum and string)
    employee_role_str = employee.role.value if hasattr(employee.role, 'value') else str(employee.role)
    cash_required = requires_cash_drawer(company_settings, employee_role_str)
    
    # Check for open entry
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.employee_id == employee.id,
                TimeEntry.company_id == company_id,
                TimeEntry.clock_out_at.is_(None),
            )
        ).order_by(TimeEntry.clock_in_at.desc())
    )
    open_entry = result.scalar_one_or_none()
    
    now = datetime.utcnow()
    
    try:
        if open_entry:
            # Clock out
            # Check if cash drawer session exists and requires end cash
            from app.models.cash_drawer import CashDrawerSession
            result = await db.execute(
                select(CashDrawerSession).where(
                    CashDrawerSession.time_entry_id == open_entry.id
                )
            )
            cash_session = result.scalar_one_or_none()
            
            if cash_session:
                if cash_end_cents is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Ending cash count is required to clock out",
                    )
                # Close cash drawer session
                await close_cash_drawer_session(
                    db,
                    company_id,
                    open_entry.id,
                    cash_end_cents,
                    CashCountSource.KIOSK if source == TimeEntrySource.KIOSK else CashCountSource.WEB,
                    collected_cash_cents=collected_cash_cents,
                    beverages_cash_cents=beverages_cash_cents,
                )
            
            open_entry.clock_out_at = now
            open_entry.status = TimeEntryStatus.CLOSED
            await db.commit()
            await db.refresh(open_entry)
            return open_entry
        else:
            # Clock in
            # Check if cash drawer is required
            if cash_required:
                if cash_start_cents is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Starting cash count is required to clock in",
                    )
            
            new_entry = TimeEntry(
                id=uuid.uuid4(),
                company_id=company_id,
                employee_id=employee.id,
                clock_in_at=now,
                source=source,
                status=TimeEntryStatus.OPEN,
            )
            db.add(new_entry)
            await db.flush()  # Flush to get the ID
            
            # Create cash drawer session if required
            if cash_required and cash_start_cents is not None:
                await create_cash_drawer_session(
                    db,
                    company_id,
                    new_entry.id,
                    employee.id,
                    cash_start_cents,
                    CashCountSource.KIOSK if source == TimeEntrySource.KIOSK else CashCountSource.WEB,
                )
            
            await db.commit()
            await db.refresh(new_entry)
            return new_entry
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process punch: {str(e)}",
        )


async def get_my_time_entries(
    db: AsyncSession,
    employee_id: UUID,
    company_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[TimeEntry], int]:
    """Get employee's own time entries."""
    query = build_employee_company_filtered_query(TimeEntry, employee_id, company_id)
    
    # Apply date range filter
    if from_date or to_date:
        query = filter_by_date_range(query, TimeEntry, "clock_in_at", from_date, to_date)
    
    return await get_paginated_results(
        db,
        query,
        skip=skip,
        limit=limit,
        order_by=TimeEntry.clock_in_at.desc()
    )


async def get_admin_time_entries(
    db: AsyncSession,
    company_id: UUID,
    employee_id: Optional[UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    status_filter: Optional[TimeEntryStatus] = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[TimeEntry], int]:
    """Get time entries for admin view."""
    additional_filters = {}
    if employee_id:
        additional_filters["employee_id"] = employee_id
    
    query = build_company_filtered_query(TimeEntry, company_id, additional_filters)
    
    # Apply date range filter
    if from_date or to_date:
        query = filter_by_date_range(query, TimeEntry, "clock_in_at", from_date, to_date)
    
    # Apply status filter
    if status_filter:
        query = filter_by_status(query, TimeEntry, status_filter)
    
    return await get_paginated_results(
        db,
        query,
        skip=skip,
        limit=limit,
        order_by=TimeEntry.clock_in_at.desc()
    )


async def calculate_rounded_hours(
    db: AsyncSession,
    entry: TimeEntry,
    company_id: UUID,
) -> Tuple[Optional[float], Optional[int]]:
    """Calculate rounded hours and minutes for a time entry."""
    if not entry.clock_out_at:
        return None, None
    
    # Get company settings
    from app.models.company import Company
    from app.services.company_service import get_company_settings
    
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
    rounded_hours = rounded_minutes / 60.0
    
    return rounded_hours, rounded_minutes


async def edit_time_entry(
    db: AsyncSession,
    entry_id: UUID,
    company_id: UUID,
    editor_id: UUID,
    data: TimeEntryEdit,
) -> TimeEntry:
    """Edit a time entry (admin only)."""
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.id == entry_id,
                TimeEntry.company_id == company_id,
            )
        )
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Time entry with ID {entry_id} not found in your company",
        )
    
    if data.clock_in_at is not None:
        entry.clock_in_at = data.clock_in_at
    if data.clock_out_at is not None:
        entry.clock_out_at = data.clock_out_at
    if data.break_minutes is not None:
        entry.break_minutes = data.break_minutes
    
    entry.edited_by = editor_id
    entry.edit_reason = data.edit_reason
    entry.status = TimeEntryStatus.EDITED
    
    # Create audit log
    from app.models.audit_log import AuditLog
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=editor_id,
        action="time_entry_edited",
        entity_type="time_entry",
        entity_id=entry_id,
        metadata_json={
            "clock_in_at": str(data.clock_in_at) if data.clock_in_at else None,
            "clock_out_at": str(data.clock_out_at) if data.clock_out_at else None,
            "break_minutes": data.break_minutes,
            "reason": data.edit_reason,
        },
    )
    try:
        db.add(audit_log)
        await db.commit()
        await db.refresh(entry)
        return entry
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to edit time entry: {str(e)}",
        )

