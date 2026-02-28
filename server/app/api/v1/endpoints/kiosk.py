"""
Kiosk endpoint for company-specific clock-in/out using slug.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, Field
from typing import Optional

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
    cash_drawer_enabled: bool = False
    cash_drawer_required_for_all: bool = False
    cash_drawer_required_roles: list[str] = []
    cash_drawer_starting_amount_cents: int = 0


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
    
    # Get company settings for cash drawer
    from app.services.company_service import get_company_settings
    settings = get_company_settings(company)
    
    return KioskCompanyInfoResponse(
        name=company.name,
        slug=company.slug,
        kiosk_enabled=company.kiosk_enabled,
        cash_drawer_enabled=settings.get("cash_drawer_enabled", False),
        cash_drawer_required_for_all=settings.get("cash_drawer_required_for_all", False),
        cash_drawer_required_roles=settings.get("cash_drawer_required_roles", []),
        cash_drawer_starting_amount_cents=settings.get("cash_drawer_starting_amount_cents", 0),
    )


class KioskPinCheckRequest(BaseModel):
    company_slug: str = Field(..., min_length=1, max_length=50)
    pin: str = Field(..., min_length=4, max_length=4, pattern="^[0-9]{4}$")


class KioskPinCheckResponse(BaseModel):
    """Response for PIN check with employee status."""
    valid: bool
    employee_name: Optional[str] = None
    is_clocked_in: bool = False
    clock_in_at: Optional[str] = None
    requires_verification: bool = False
    verification_message: Optional[str] = None
    cash_drawer_enabled: bool = False
    cash_drawer_required: bool = False


@router.post("/check-pin", response_model=KioskPinCheckResponse)
@handle_endpoint_errors(operation_name="check_kiosk_pin")
async def check_kiosk_pin(
    data: KioskPinCheckRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Check PIN validity and get employee status.
    Returns employee info and whether they're clocked in.
    Public endpoint - no auth required.
    """
    # Find company by slug
    result = await db.execute(
        select(Company).where(Company.slug == data.company_slug)
    )
    company = result.scalar_one_or_none()
    
    if not company:
        return KioskPinCheckResponse(valid=False)
    
    # Check if kiosk is enabled
    if not company.kiosk_enabled:
        return KioskPinCheckResponse(valid=False)
    
    # Find active employees with PINs in this company (any role except ADMIN/DEVELOPER)
    result = await db.execute(
        select(User).where(
            and_(
                User.company_id == company.id,
                User.role.in_([UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]),
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
        return KioskPinCheckResponse(valid=False)
    
    # Check if employee's email is verified
    from app.services.verification_service import check_verification_required
    if check_verification_required(matching_employee):
        return KioskPinCheckResponse(
            valid=True,
            employee_name=matching_employee.name,
            requires_verification=True,
            verification_message="Your email must be verified to use the kiosk. Please verify your email first.",
        )
    
    # Check if employee is clocked in
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.employee_id == matching_employee.id,
                TimeEntry.company_id == company.id,
                TimeEntry.clock_out_at.is_(None),
            )
        ).order_by(TimeEntry.clock_in_at.desc())
    )
    open_entry = result.scalar_one_or_none()
    
    is_clocked_in = open_entry is not None
    clock_in_at = None
    if open_entry and open_entry.clock_in_at:
        from app.services.timezone_service import (
            get_company_timezone,
            format_datetime_for_company,
        )
        timezone_str = await get_company_timezone(db, company.id)
        clock_in_at = format_datetime_for_company(open_entry.clock_in_at, timezone_str)
    
    # Check cash drawer requirements
    from app.services.company_service import get_company_settings
    from app.services.cash_drawer_service import requires_cash_drawer
    
    company_settings = get_company_settings(company)
    employee_role_str = matching_employee.role.value if hasattr(matching_employee.role, 'value') else str(matching_employee.role)
    cash_drawer_required = requires_cash_drawer(company_settings, employee_role_str)
    
    return KioskPinCheckResponse(
        valid=True,
        employee_name=matching_employee.name,
        is_clocked_in=is_clocked_in,
        clock_in_at=clock_in_at,
        requires_verification=False,
        cash_drawer_enabled=company_settings.get("cash_drawer_enabled", False),
        cash_drawer_required=cash_drawer_required,
    )


class KioskClockRequest(BaseModel):
    company_slug: str = Field(..., min_length=1, max_length=50)
    pin: str = Field(..., min_length=4, max_length=4, pattern="^[0-9]{4}$")
    cash_start_cents: Optional[int] = Field(None, ge=0, description="Starting cash in cents (required on clock-in if cash drawer enabled)")
    cash_end_cents: Optional[int] = Field(None, ge=0, description="Ending cash in cents (required on clock-out if cash drawer session exists)")
    collected_cash_cents: Optional[int] = Field(None, ge=0, description="Total cash collected from customers (for punch-out)")
    drop_amount_cents: Optional[int] = Field(None, ge=0, description="Cash dropped from drawer during shift (for punch-out)")
    beverages_cash_cents: Optional[int] = Field(None, ge=0, description="Cash from beverage sales (for punch-out)")
    latitude: Optional[str] = Field(None, description="GPS latitude coordinate")
    longitude: Optional[str] = Field(None, description="GPS longitude coordinate")


@router.post("/clock", response_model=TimeEntryResponse, status_code=status.HTTP_201_CREATED)
@handle_endpoint_errors(operation_name="kiosk_clock")
async def kiosk_clock(
    data: KioskClockRequest,
    request: Request,
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
    
    # Find active employees with PINs in this company (any role except ADMIN/DEVELOPER)
    result = await db.execute(
        select(User).where(
            and_(
                User.company_id == company.id,
                User.role.in_([UserRole.MAINTENANCE, UserRole.FRONTDESK, UserRole.HOUSEKEEPING]),
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
    
    # Check if employee's email is verified
    from app.services.verification_service import check_verification_required
    if check_verification_required(matching_employee):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "EMAIL_VERIFICATION_REQUIRED",
                "message": "Your email must be verified to use the kiosk. Please verify your email first.",
            }
        )
    
    # Get client IP address and user agent
    client_ip = request.client.host if request.client else None
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    user_agent = request.headers.get("User-Agent")
    
    # Clock in/out (PIN already verified)
    entry = await punch(
        db,
        company.id,
        matching_employee.id,
        None,  # No email needed
        data.pin,
        TimeEntrySource.KIOSK,
        skip_pin_verification=True,  # PIN already verified
        cash_start_cents=data.cash_start_cents,
        cash_end_cents=data.cash_end_cents,
        collected_cash_cents=data.collected_cash_cents,
        drop_amount_cents=data.drop_amount_cents,
        beverages_cash_cents=data.beverages_cash_cents,
        ip_address=client_ip,
        user_agent=user_agent,
        latitude=data.latitude,
        longitude=data.longitude,
    )
    
    # Use helper function from time endpoint
    from app.api.v1.endpoints.time import build_time_entry_response
    return await build_time_entry_response(db, entry, matching_employee.name, company.id)

