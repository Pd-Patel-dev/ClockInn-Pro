"""
Kiosk endpoint for company-specific clock-in/out using slug.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.error_handling import handle_endpoint_errors
from app.models.company import Company
from app.models.user import User, UserRole, UserStatus
from app.models.time_entry import TimeEntry, TimeEntrySource, TimeEntryStatus
from app.services.time_entry_service import punch
from app.schemas.time_entry import TimeEntryResponse
from app.core.security import verify_pin
from datetime import datetime
from uuid import UUID

router = APIRouter()


class KioskCompanyInfoResponse(BaseModel):
    """Public company info for kiosk page."""
    name: str
    slug: str
    kiosk_enabled: bool


@router.get("/{slug}/info", response_model=KioskCompanyInfoResponse)
@handle_endpoint_errors(operation_name="get_kiosk_company_info")
async def get_kiosk_company_info(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get company info by slug for kiosk page.
    Public endpoint - no auth required.
    """
    result = await db.execute(
        select(Company).where(Company.slug == slug)
    )
    company = result.scalar_one_or_none()
    
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    
    return KioskCompanyInfoResponse(
        name=company.name,
        slug=company.slug,
        kiosk_enabled=company.kiosk_enabled,
    )


class KioskClockRequest(BaseModel):
    company_slug: str = Field(..., min_length=1, max_length=50)
    pin: str = Field(..., min_length=4, max_length=4, pattern="^[0-9]{4}$")


@router.post("/clock", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="kiosk_clock")
async def kiosk_clock(
    data: KioskClockRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Clock in/out using company slug and PIN.
    Public endpoint - no auth required.
    """
    # Find company by slug
    result = await db.execute(
        select(Company).where(Company.slug == data.company_slug)
    )
    company = result.scalar_one_or_none()
    
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    
    # Check if kiosk is enabled
    if not company.kiosk_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Kiosk is disabled for this company",
        )
    
    # Find active employees with PINs in this company
    result = await db.execute(
        select(User).where(
            and_(
                User.company_id == company.id,
                User.role == UserRole.EMPLOYEE,
                User.status == UserStatus.ACTIVE,
                User.pin_hash.isnot(None),
            )
        )
    )
    employees = result.scalars().all()
    
    # Find employee by verifying PIN (only within this company)
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
    
    # Clock in/out (PIN already verified)
    entry = await punch(
        db,
        company.id,
        matching_employee.id,
        None,  # No email needed
        data.pin,
        TimeEntrySource.KIOSK,
        skip_pin_verification=True,  # PIN already verified
    )
    
    # Calculate rounded hours
    from app.services.time_entry_service import calculate_rounded_hours
    rounded_hours, rounded_minutes = await calculate_rounded_hours(
        db, entry, company.id
    )
    
    # Get timezone-formatted times
    from app.services.timezone_service import (
        get_company_timezone,
        format_datetime_for_company,
    )
    timezone_str = await get_company_timezone(db, company.id)
    
    clock_in_local = format_datetime_for_company(entry.clock_in_at, timezone_str) if entry.clock_in_at else None
    clock_out_local = format_datetime_for_company(entry.clock_out_at, timezone_str) if entry.clock_out_at else None
    
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
        clock_in_at_local=clock_in_local,
        clock_out_at_local=clock_out_local,
        company_timezone=timezone_str,
    )

