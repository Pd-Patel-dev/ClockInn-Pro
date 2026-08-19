from typing import Optional, List, Tuple
from uuid import UUID
from datetime import datetime, date
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from fastapi import HTTPException, status

from app.core.error_handling import client_error_detail
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

logger = logging.getLogger(__name__)


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
    drop_amount_cents: Optional[int] = None,
    beverages_cash_cents: Optional[int] = None,
    current_cash_cents: Optional[int] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    latitude: Optional[str] = None,
    longitude: Optional[str] = None,
) -> TimeEntry:
    """Handle clock in/out punch."""
    # Find employee (any role except ADMIN/DEVELOPER)
    if employee_id:
        result = await db.execute(
            select(User).where(
                and_(
                    User.id == employee_id,
                    User.company_id == company_id,
                    User.role.in_(
                        [
                            UserRole.MAINTENANCE,
                            UserRole.FRONTDESK,
                            UserRole.HOUSEKEEPING,
                            UserRole.RESTAURANT,
                            UserRole.SECURITY,
                            UserRole.MANAGER,
                        ]
                    ),
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
                    User.role.in_(
                        [
                            UserRole.MAINTENANCE,
                            UserRole.FRONTDESK,
                            UserRole.HOUSEKEEPING,
                            UserRole.RESTAURANT,
                            UserRole.SECURITY,
                            UserRole.MANAGER,
                        ]
                    ),
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or PIN",
        )
    
    # Only verify PIN if not skipped (for cases where PIN was already verified)
    if not skip_pin_verification:
        if not employee.pin_hash:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or PIN",
            )
        
        if not verify_pin(pin, employee.pin_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or PIN",
            )
    
    # Get company settings to check cash drawer requirements
    from app.models.company import Company
    from app.services.company_service import get_company_settings
    from app.services.cash_drawer_service import (
        requires_cash_drawer,
        create_cash_drawer_session,
        close_cash_drawer_session,
        get_open_company_cash_drawer,
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
    from app.services.company_service import (
        is_punch_allowed_for_role,
        assert_kiosk_role_allowed,
    )
    if not is_punch_allowed_for_role(company_settings, employee.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your employee type is not allowed to punch in/out. Contact your administrator.",
        )
    if source == TimeEntrySource.KIOSK:
        assert_kiosk_role_allowed(company_settings, employee.role)
    # Convert role to string (handles both enum and string)
    employee_role_str = employee.role.value if hasattr(employee.role, 'value') else str(employee.role)
    cash_required = requires_cash_drawer(company_settings, employee_role_str)
    
    # Geofence: require employee to be within office radius to punch
    geofence_enabled = company_settings.get("geofence_enabled", False)
    office_lat = company_settings.get("office_latitude")
    office_lon = company_settings.get("office_longitude")
    radius_m = company_settings.get("geofence_radius_meters", 100)
    if geofence_enabled and office_lat is not None and office_lon is not None and radius_m is not None:
        if not latitude or not longitude:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Location is required to punch in/out. Please enable location access and try again.",
            )
        try:
            lat_f = float(latitude)
            lon_f = float(longitude)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid location. Please enable location and try again.",
            )
        from app.core.geo import haversine_distance_meters
        distance_m = haversine_distance_meters(office_lat, office_lon, lat_f, lon_f)
        if distance_m > radius_m:
            import logging
            _log = logging.getLogger(__name__)
            from app.services.company_service import get_company_admin_emails
            from app.services.email_service import email_service
            admin_emails = await get_company_admin_emails(db, company_id)
            if not admin_emails:
                _log.warning("Punch blocked (geofence): no admin emails found for company_id=%s to send warning", company_id)
            else:
                _log.info("Punch blocked (geofence): sending warning to %d admin(s) for company %s", len(admin_emails), company.name)
                await email_service.send_punch_violation_warning(
                    to_emails=admin_emails,
                    company_name=company.name,
                    violation_type="geofence",
                    employee_name=employee.name,
                    employee_email=employee.email,
                    ip_address=ip_address,
                    user_agent=user_agent,
                    latitude=latitude,
                    longitude=longitude,
                    distance_meters=distance_m,
                    allowed_radius_meters=radius_m,
                    attempted_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You must be at the office to punch in/out. You are currently outside the allowed area.",
            )
    
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
                    drop_amount_cents=drop_amount_cents,
                    beverages_cash_cents=beverages_cash_cents,
                    current_cash_cents=current_cash_cents,
                )
            
            open_entry.clock_out_at = now
            open_entry.status = TimeEntryStatus.CLOSED
            # Store clock-out IP, user agent, and location
            open_entry.clock_out_ip_address = ip_address
            open_entry.clock_out_user_agent = user_agent
            open_entry.clock_out_latitude = latitude
            open_entry.clock_out_longitude = longitude
            await db.commit()
            await db.refresh(open_entry)

            # Notify admins with shift summary (non-blocking for punch success)
            try:
                # Re-load cash session after close so amounts/status are current
                closed_cash = None
                if cash_session:
                    closed_cash = (
                        await db.execute(
                            select(CashDrawerSession).where(
                                CashDrawerSession.time_entry_id == open_entry.id
                            )
                        )
                    ).scalar_one_or_none()
                await _send_clock_out_shift_summary_email(
                    db,
                    company=company,
                    employee=employee,
                    entry=open_entry,
                    cash_session=closed_cash,
                )
            except Exception as email_err:
                logger.warning(
                    "Clock-out succeeded but shift summary email failed: %s",
                    email_err,
                    exc_info=True,
                )

            return open_entry
        else:
            # Clock in
            # Cash drawer: only one open session per company. If another FD already
            # activated it, allow clock-in without starting cash / without a new session.
            active_drawer = (
                await get_open_company_cash_drawer(db, company_id) if cash_required else None
            )
            if cash_required and not active_drawer and cash_start_cents is None:
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
                ip_address=ip_address,
                user_agent=user_agent,
                clock_in_latitude=latitude,
                clock_in_longitude=longitude,
            )
            db.add(new_entry)
            await db.flush()  # Flush to get the ID
            
            # Create cash drawer session only when this punch activates the drawer
            if cash_required and not active_drawer and cash_start_cents is not None:
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
        logger.error("Failed to process punch: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to process punch: {str(e)}",
                prod_detail="Failed to process punch. Please try again.",
            ),
        )


def _format_cents(cents: Optional[int]) -> str:
    if cents is None:
        return "N/A"
    return f"${cents / 100:.2f}"


async def _send_clock_out_shift_summary_email(
    db: AsyncSession,
    *,
    company,
    employee: User,
    entry: TimeEntry,
    cash_session=None,
) -> None:
    """Email company admins a clock-out shift summary. Never raises to callers."""
    from app.services.company_service import get_company_admin_emails
    from app.services.email_service import email_service
    from app.services.timezone_service import (
        get_company_timezone,
        format_datetime_for_company,
    )
    from app.services.marketplace_service import marketplace_total_cents, normalize_sales

    admin_emails = await get_company_admin_emails(db, company.id)
    if not admin_emails:
        logger.warning(
            "Clock-out shift summary: no admin emails for company_id=%s",
            company.id,
        )
        return

    timezone_str = await get_company_timezone(db, company.id)
    clock_in_label = (
        format_datetime_for_company(entry.clock_in_at, timezone_str, "%b %d, %Y · %I:%M %p")
        if entry.clock_in_at
        else "N/A"
    )
    clock_out_label = (
        format_datetime_for_company(entry.clock_out_at, timezone_str, "%b %d, %Y · %I:%M %p")
        if entry.clock_out_at
        else "N/A"
    )

    rounded_hours, rounded_minutes = await calculate_rounded_hours(db, entry, company.id)
    if rounded_hours is not None and rounded_minutes is not None:
        hrs = int(rounded_minutes) // 60
        mins = int(rounded_minutes) % 60
        duration_label = f"{hrs}h {mins:02d}m ({rounded_hours:.2f} hrs rounded)"
    elif entry.clock_in_at and entry.clock_out_at:
        raw_secs = (entry.clock_out_at - entry.clock_in_at).total_seconds()
        hrs = int(raw_secs // 3600)
        mins = int((raw_secs % 3600) // 60)
        duration_label = f"{hrs}h {mins:02d}m"
    else:
        duration_label = "N/A"

    role_str = (
        employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    )
    source_str = (
        entry.source.value if hasattr(entry.source, "value") else str(entry.source or "")
    )

    cash_drawer = None
    marketplace_rows = None
    marketplace_total_label = None

    # Cash drawer / marketplace only when this employee owned the drawer for the shift
    if cash_session is not None:
        cash_drawer = {
            "start_cash": _format_cents(cash_session.start_cash_cents),
            "current_cash": _format_cents(getattr(cash_session, "current_cash_cents", None)),
            "end_cash": _format_cents(cash_session.end_cash_cents),
            "drop_amount": _format_cents(cash_session.drop_amount_cents),
            "delta": _format_cents(cash_session.delta_cents),
            "status": (
                cash_session.status.value
                if hasattr(cash_session.status, "value")
                else str(cash_session.status)
            ),
        }
        from app.services.company_service import get_company_settings

        catalog = get_company_settings(company).get("marketplace_items") or []
        sales = normalize_sales(getattr(cash_session, "marketplace_sales_json", None))
        sold = [s for s in sales if int(s.get("qty") or 0) > 0]
        if catalog or sold or cash_session.beverages_cash_cents is not None:
            marketplace_rows = [
                {
                    "label": row.get("label") or "Item",
                    "qty": int(row.get("qty") or 0),
                    "payment": row.get("payment") or "cash",
                    "line_total": _format_cents(
                        int(row.get("qty") or 0) * int(row.get("price_cents") or 0)
                    ),
                }
                for row in sold
            ]
            total_cents = (
                int(cash_session.beverages_cash_cents)
                if cash_session.beverages_cash_cents is not None
                else marketplace_total_cents(sales)
            )
            marketplace_total_label = _format_cents(total_cents)

    await email_service.send_shift_summary_to_admins(
        admin_emails,
        company_name=company.name or "Company",
        employee_name=employee.name or "Employee",
        employee_email=employee.email,
        employee_role=role_str,
        clock_in_at=clock_in_label,
        clock_out_at=clock_out_label,
        duration_label=duration_label,
        source=source_str,
        cash_drawer=cash_drawer,
        marketplace_sales=marketplace_rows,
        marketplace_total_label=marketplace_total_label,
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
        logger.error("Failed to edit time entry: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=client_error_detail(
                dev_detail=f"Failed to edit time entry: {str(e)}",
                prod_detail="Failed to edit time entry. Please try again.",
            ),
        )

