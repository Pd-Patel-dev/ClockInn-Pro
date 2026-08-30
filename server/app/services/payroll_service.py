from typing import Optional, List, Dict, Tuple
from uuid import UUID
from datetime import datetime, date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, delete
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status
import pytz

from app.models.payroll import PayrollRun, PayrollLineItem, PayrollType, PayrollStatus
from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User, UserRole, UserStatus, PayRateType, PayMethod
from app.models.company import Company
from app.models.audit_log import AuditLog
from app.models.room import HousekeepingSheet, HousekeepingSheetItem, HousekeepingSheetKind
from app.core.query_builder import get_paginated_results, build_company_filtered_query, filter_by_status
import uuid


# Default company settings
DEFAULT_TIMEZONE = "America/Chicago"
DEFAULT_WEEK_START_DAY = 0  # Monday
DEFAULT_OVERTIME_THRESHOLD_HOURS = 40
DEFAULT_OVERTIME_MULTIPLIER = Decimal("1.5")
DEFAULT_ROUNDING_POLICY = "none"  # none, 5, 10, 15


def get_company_settings(company: Company) -> Dict:
    """Get company settings with defaults."""
    settings = company.settings_json or {}
    return {
        "timezone": settings.get("timezone", DEFAULT_TIMEZONE),
        "payroll_week_start_day": settings.get("payroll_week_start_day", DEFAULT_WEEK_START_DAY),
        "biweekly_anchor_date": settings.get("biweekly_anchor_date"),
        "overtime_enabled": settings.get("overtime_enabled", True),
        "overtime_threshold_hours_per_week": settings.get("overtime_threshold_hours_per_week", DEFAULT_OVERTIME_THRESHOLD_HOURS),
        "overtime_multiplier_default": Decimal(str(settings.get("overtime_multiplier_default", DEFAULT_OVERTIME_MULTIPLIER))),
        "rounding_policy": settings.get("rounding_policy", DEFAULT_ROUNDING_POLICY),
        "breaks_paid": settings.get("breaks_paid", False),
        "last_pay_date": settings.get("last_pay_date"),
        "payroll_pay_type": settings.get("payroll_pay_type"),
        "payroll_reminder_enabled": settings.get("payroll_reminder_enabled", True),
    }


def compute_pay_period(
    payroll_type: PayrollType,
    start_date: date,
    company_settings: Dict,
    strict_mode: bool = False,
) -> Tuple[date, date, Optional[str]]:
    """
    Compute pay period end date from start date and type.
    Returns (period_start_date, period_end_date, warning_message)
    """
    if payroll_type == PayrollType.WEEKLY:
        period_end = start_date + timedelta(days=6)
        
        # Optional validation: check if start_date aligns with week_start_day
        week_start_day = company_settings["payroll_week_start_day"]
        if start_date.weekday() != week_start_day:
            warning = f"Start date {start_date} does not align with configured week start day ({week_start_day})."
            if strict_mode:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=warning,
                )
            return start_date, period_end, warning
        
        return start_date, period_end, None
    
    elif payroll_type == PayrollType.BIWEEKLY:
        period_end = start_date + timedelta(days=13)
        
        # Optional validation: check alignment with anchor date
        anchor_date_str = company_settings.get("biweekly_anchor_date")
        if anchor_date_str and strict_mode:
            try:
                anchor_date = datetime.strptime(anchor_date_str, "%Y-%m-%d").date()
                days_diff = (start_date - anchor_date).days
                if days_diff % 14 != 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Start date {start_date} does not align with biweekly anchor date {anchor_date}.",
                    )
            except ValueError:
                pass  # Invalid anchor date format, skip validation
        
        return start_date, period_end, None
    
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid payroll type: {payroll_type}",
    )


def apply_rounding(minutes: int, rounding_policy: str) -> int:
    """Apply rounding policy to minutes."""
    if rounding_policy == "none":
        return minutes
    elif rounding_policy == "5":
        return round(minutes / 5) * 5
    elif rounding_policy == "6":
        # Round to nearest 6 minutes (1/10th of an hour)
        return round(minutes / 6) * 6
    elif rounding_policy == "10":
        return round(minutes / 10) * 10
    elif rounding_policy == "15":
        # 15 minutes with 7-minute rule:
        # - 0-7 minutes: round DOWN to previous 15-minute mark
        # - 8-14 minutes: round UP to next 15-minute mark
        remainder = minutes % 15
        if remainder <= 7:
            return (minutes // 15) * 15
        else:
            return ((minutes // 15) + 1) * 15
    elif rounding_policy == "30":
        return round(minutes / 30) * 30
    return minutes


def compute_minutes_with_rounding_and_breaks(
    clock_in: datetime,
    clock_out: datetime,
    break_minutes: int,
    rounding_policy: str,
    breaks_paid: bool = False,
) -> int:
    """Calculate worked minutes with breaks and rounding."""
    if clock_out is None:
        return 0  # Open shift, excluded from payroll
    
    total_seconds = (clock_out - clock_in).total_seconds()
    total_minutes = int(total_seconds / 60)
    
    # Subtract break time only if breaks are NOT paid
    if breaks_paid:
        paid_minutes = total_minutes  # Breaks are paid, don't deduct
    else:
        paid_minutes = max(0, total_minutes - break_minutes)  # Deduct breaks
    
    # Apply rounding
    return apply_rounding(paid_minutes, rounding_policy)


def split_into_weeks(
    start_date: date,
    end_date: date,
    week_start_day: int,
    timezone_str: str,
) -> List[Tuple[date, date]]:
    """Split a date range into weeks based on week_start_day."""
    weeks = []
    tz = pytz.timezone(timezone_str)
    
    current = start_date
    while current <= end_date:
        # Find the start of the week containing current date
        days_since_week_start = (current.weekday() - week_start_day) % 7
        week_start = current - timedelta(days=days_since_week_start)
        week_end = week_start + timedelta(days=6)
        
        # Clamp to period bounds
        week_start = max(week_start, start_date)
        week_end = min(week_end, end_date)
        
        weeks.append((week_start, week_end))
        
        # Move to next week
        current = week_end + timedelta(days=1)
        if current > end_date:
            break
    
    return weeks


def compute_weekly_overtime_blocks(
    time_entries: List[TimeEntry],
    period_start: date,
    period_end: date,
    company_settings: Dict,
    entry_minutes_overrides: Optional[Dict[str, int]] = None,
) -> Tuple[int, int, Dict, int]:
    """
    Compute regular and overtime minutes for a period using weekly overtime calculation.
    Returns (regular_minutes, overtime_minutes, details_dict, exceptions_count)

    entry_minutes_overrides: optional map of time_entry_id -> paid minutes from payroll review.
    """
    timezone_str = company_settings["timezone"]
    week_start_day = company_settings["payroll_week_start_day"]
    overtime_threshold_minutes = company_settings["overtime_threshold_hours_per_week"] * 60
    rounding_policy = company_settings["rounding_policy"]
    overrides = entry_minutes_overrides or {}
    
    tz = pytz.timezone(timezone_str)
    
    # Split period into weeks
    weeks = split_into_weeks(period_start, period_end, week_start_day, timezone_str)
    
    total_regular = 0
    total_overtime = 0
    week_blocks = []
    daily_breakdown = {}
    time_entry_ids = []
    exceptions_count = 0
    exceptions: List[Dict] = []
    
    for week_start, week_end in weeks:
        week_minutes = 0
        week_entries = []
        
        for entry in time_entries:
            # Convert UTC to company timezone
            clock_in_local = entry.clock_in_at.astimezone(tz)
            clock_in_date = clock_in_local.date()

            # Punches can overlap the period (clock-in before start / after end).
            # Attribute them to a day inside the pay period so hours are not dropped.
            if clock_in_date < period_start:
                clock_in_date = period_start
            elif clock_in_date > period_end:
                clock_in_date = period_end
            
            # Check if entry overlaps with this week
            if clock_in_date < week_start or clock_in_date > week_end:
                continue
            
            entry_key = str(entry.id)
            has_override = entry_key in overrides
            clock_out_local = (
                entry.clock_out_at.astimezone(tz) if entry.clock_out_at is not None else None
            )

            # Only count closed entries (unless review provided an hours override)
            if entry.clock_out_at is None and not has_override:
                exceptions_count += 1
                exceptions.append(
                    {
                        "type": "open_punch",
                        "entry_id": entry_key,
                        "date": clock_in_date.isoformat(),
                        "clock_in_local": clock_in_local.strftime("%Y-%m-%d %H:%M"),
                        "clock_out_local": None,
                        "message": "Open punch — missing clock-out; hours not included",
                    }
                )
                continue
            
            if entry.status == TimeEntryStatus.EDITED:
                exceptions_count += 1
                exceptions.append(
                    {
                        "type": "edited",
                        "entry_id": entry_key,
                        "date": clock_in_date.isoformat(),
                        "clock_in_local": clock_in_local.strftime("%Y-%m-%d %H:%M"),
                        "clock_out_local": (
                            clock_out_local.strftime("%Y-%m-%d %H:%M") if clock_out_local else None
                        ),
                        "hours_overridden": has_override,
                        "message": (
                            "Hours adjusted during payroll review"
                            if has_override
                            else "Time entry was edited"
                        ),
                    }
                )
            
            # Calculate minutes for this entry
            if has_override:
                minutes = max(0, int(overrides[entry_key]))
            else:
                minutes = compute_minutes_with_rounding_and_breaks(
                    entry.clock_in_at,
                    entry.clock_out_at,
                    entry.break_minutes,
                    rounding_policy,
                    company_settings["breaks_paid"],
                )
            
            week_minutes += minutes
            week_entries.append({
                "entry_id": str(entry.id),
                "date": clock_in_date.isoformat(),
                "minutes": minutes,
                "hours_overridden": has_override,
            })
            
            # Daily breakdown
            date_key = clock_in_date.isoformat()
            if date_key not in daily_breakdown:
                daily_breakdown[date_key] = 0
            daily_breakdown[date_key] += minutes
            
            time_entry_ids.append(str(entry.id))
        
        # Calculate overtime for this week
        if company_settings["overtime_enabled"]:
            overtime_minutes = max(0, week_minutes - overtime_threshold_minutes)
            regular_minutes = week_minutes - overtime_minutes
        else:
            overtime_minutes = 0
            regular_minutes = week_minutes
        
        total_regular += regular_minutes
        total_overtime += overtime_minutes
        
        week_blocks.append({
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "regular_minutes": regular_minutes,
            "overtime_minutes": overtime_minutes,
            "total_minutes": week_minutes,
            "entries": week_entries,
        })
    
    details = {
        "days": daily_breakdown,
        "week_blocks": week_blocks,
        "time_entry_ids": time_entry_ids,
        "exceptions": exceptions,
    }
    
    return total_regular, total_overtime, details, exceptions_count


def compute_pay_cents_decimal_safe(
    regular_minutes: int,
    overtime_minutes: int,
    pay_rate_cents: int,
    overtime_multiplier: Decimal,
) -> Tuple[int, int, int]:
    """
    Compute pay in cents using decimal-safe math.
    Returns (regular_pay_cents, overtime_pay_cents, total_pay_cents)
    """
    # Convert minutes to hours (decimal)
    regular_hours = Decimal(regular_minutes) / Decimal(60)
    overtime_hours = Decimal(overtime_minutes) / Decimal(60)
    
    # Calculate pay
    regular_pay = regular_hours * Decimal(pay_rate_cents)
    overtime_pay = overtime_hours * Decimal(pay_rate_cents) * overtime_multiplier
    
    # Round to nearest cent (banker's rounding)
    regular_pay_cents = int(regular_pay.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    overtime_pay_cents = int(overtime_pay.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    total_pay_cents = regular_pay_cents + overtime_pay_cents
    
    return regular_pay_cents, overtime_pay_cents, total_pay_cents


def period_bounds_utc(period_start: date, period_end: date, timezone_str: str) -> Tuple[datetime, datetime]:
    """Company-local pay period → UTC datetime range."""
    tz = pytz.timezone(timezone_str)
    start_utc = tz.localize(datetime.combine(period_start, datetime.min.time())).astimezone(pytz.UTC)
    end_utc = tz.localize(datetime.combine(period_end, datetime.max.time())).astimezone(pytz.UTC)
    return start_utc, end_utc


def compute_per_room_pay_cents(rooms_cleaned: int, rate_cents_per_room: int) -> int:
    """rooms × per-room rate → cents."""
    total = Decimal(max(0, int(rooms_cleaned))) * Decimal(max(0, int(rate_cents_per_room)))
    return int(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


async def rooms_cleaned_in_period(
    db: AsyncSession,
    company_id: UUID,
    housekeeper_id: UUID,
    period_start: date,
    period_end: date,
    timezone_str: str,
) -> Tuple[int, List[str], Dict[str, int]]:
    """
    Rooms marked cleaned (finalize sheets) for this housekeeper in the pay period.

    Each room on a "Cleaning done" sheet counts once per sheet, so the same room
    cleaned on two different days in the period counts twice.
    """
    period_start_utc, period_end_utc = period_bounds_utc(period_start, period_end, timezone_str)
    try:
        tz = pytz.timezone(timezone_str)
    except Exception:
        tz = pytz.timezone(DEFAULT_TIMEZONE)

    result = await db.execute(
        select(HousekeepingSheetItem.room_number, HousekeepingSheet.created_at)
        .select_from(HousekeepingSheetItem)
        .join(HousekeepingSheet, HousekeepingSheetItem.sheet_id == HousekeepingSheet.id)
        .where(
            and_(
                HousekeepingSheet.company_id == company_id,
                HousekeepingSheet.housekeeper_id == housekeeper_id,
                HousekeepingSheet.kind == HousekeepingSheetKind.FINALIZE.value,
                HousekeepingSheet.created_at >= period_start_utc,
                HousekeepingSheet.created_at <= period_end_utc,
            )
        )
        .order_by(HousekeepingSheet.created_at.asc(), HousekeepingSheetItem.room_number.asc())
    )
    rows = list(result.all())
    room_numbers = [str(number) for number, _created in rows if number]
    by_date: Dict[str, int] = {}
    for _number, created_at in rows:
        if created_at is None:
            continue
        local_dt = created_at.astimezone(tz) if created_at.tzinfo else tz.localize(created_at)
        key = local_dt.date().isoformat()
        by_date[key] = by_date.get(key, 0) + 1
    return len(room_numbers), room_numbers, by_date


async def count_rooms_cleaned_in_period(
    db: AsyncSession,
    company_id: UUID,
    housekeeper_id: UUID,
    period_start: date,
    period_end: date,
    timezone_str: str,
) -> int:
    """Count rooms cleaned on finalized housekeeping sheets in the pay period."""
    count, _numbers, _by_date = await rooms_cleaned_in_period(
        db,
        company_id,
        housekeeper_id,
        period_start,
        period_end,
        timezone_str,
    )
    return count


def resolve_pay_rate_cents(employee: User) -> int:
    """Prefer pay_rate_cents; fall back to dollar pay_rate."""
    pay_rate_cents = employee.pay_rate_cents or 0
    if pay_rate_cents == 0 and employee.pay_rate:
        pay_rate_cents = int(Decimal(str(employee.pay_rate)) * 100)
    return int(pay_rate_cents)


def sum_rooms_cleaned_from_line_items(line_items) -> int:
    """Total rooms cleaned across per-room line items in a payroll run."""
    total = 0
    for item in line_items or []:
        details = item.details_json or {}
        if details.get("pay_method") == PayMethod.PER_ROOM.value:
            try:
                total += int(details.get("rooms_cleaned") or 0)
            except (TypeError, ValueError):
                continue
    return total


async def fetch_time_entries_scoped(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
    period_start: date,
    period_end: date,
    timezone_str: str,
) -> List[TimeEntry]:
    """Fetch time entries that overlap with the pay period."""
    tz = pytz.timezone(timezone_str)
    
    # Convert period dates to UTC datetime range
    period_start_utc = tz.localize(datetime.combine(period_start, datetime.min.time())).astimezone(pytz.UTC)
    period_end_utc = tz.localize(datetime.combine(period_end, datetime.max.time())).astimezone(pytz.UTC)
    
    # Fetch entries that overlap with period
    result = await db.execute(
        select(TimeEntry).where(
            and_(
                TimeEntry.company_id == company_id,
                TimeEntry.employee_id == employee_id,
                TimeEntry.clock_in_at <= period_end_utc,
                or_(
                    TimeEntry.clock_out_at.is_(None),
                    TimeEntry.clock_out_at >= period_start_utc,
                ),
            )
        ).order_by(TimeEntry.clock_in_at)
    )
    
    return list(result.scalars().all())


async def generate_payroll_run(
    db: AsyncSession,
    company_id: UUID,
    payroll_type: PayrollType,
    start_date: date,
    generated_by: UUID,
    include_inactive: bool = False,
    employee_ids: Optional[List[UUID]] = None,
    allow_duplicate: bool = False,
    entry_hour_overrides: Optional[Dict[str, float]] = None,
    bypass_schedule: bool = False,
    room_count_overrides: Optional[Dict[str, int]] = None,
) -> PayrollRun:
    """Generate a payroll run for a company."""
    # Get company
    result = await db.execute(
        select(Company).where(Company.id == company_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    
    company_settings = get_company_settings(company)

    # Pay-date schedule (last pay date + weekly/biweekly) — preferred constraint
    from app.services.payroll_schedule_service import (
        build_pay_schedule_status,
        parse_payroll_type,
    )
    timezone_str = company_settings.get("timezone", DEFAULT_TIMEZONE)
    try:
        tz = pytz.timezone(timezone_str)
    except Exception:
        tz = pytz.timezone(DEFAULT_TIMEZONE)
    today_local = datetime.now(tz).date()

    last_pay_raw = company_settings.get("last_pay_date")
    last_pay_date = None
    if last_pay_raw:
        try:
            last_pay_date = date.fromisoformat(str(last_pay_raw)[:10])
        except (TypeError, ValueError):
            last_pay_date = None
    configured_type = parse_payroll_type(company_settings.get("payroll_pay_type"))
    schedule = build_pay_schedule_status(
        last_pay_date=last_pay_date,
        payroll_type=configured_type or payroll_type.value,
        today=today_local,
        reminder_enabled=bool(company_settings.get("payroll_reminder_enabled", True)),
        week_start_day=int(company_settings.get("payroll_week_start_day") or 0),
    )

    from app.core.environment import allows_dev_overrides

    skip_schedule = bool(bypass_schedule) and allows_dev_overrides()

    if not skip_schedule:
        if schedule.configured and last_pay_date and configured_type:
            if configured_type != payroll_type.value:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payroll type must be {configured_type} (configured in Settings).",
                )
            if not schedule.can_generate:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=schedule.message,
                )
            if schedule.period_start and start_date != schedule.period_start:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Period start must be {schedule.period_start.isoformat()} "
                        f"for the upcoming pay date {schedule.next_pay_date.isoformat()}."
                    ),
                )
        else:
            # Fallback when pay schedule is not configured: last 14 days only
            earliest_start = today_local - timedelta(days=14)
            if start_date > today_local:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Period start date cannot be in the future",
                )
            if start_date < earliest_start:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Set last pay date and payroll type in Settings, or choose a period "
                        f"start within the last two weeks (on or after {earliest_start.isoformat()})."
                    ),
                )
    
    # Compute pay period
    period_start, period_end, warning = compute_pay_period(
        payroll_type,
        start_date,
        company_settings,
        strict_mode=False,
    )
    
    # Check for duplicate payroll run
    if not allow_duplicate:
        result = await db.execute(
            select(PayrollRun).where(
                and_(
                    PayrollRun.company_id == company_id,
                    PayrollRun.payroll_type == payroll_type,
                    PayrollRun.period_start_date == period_start,
                    PayrollRun.period_end_date == period_end,
                )
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll run already exists for period {period_start} to {period_end}",
            )
    
    # Get employees (any role except ADMIN/DEVELOPER)
    query = select(User).where(
        and_(
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
        )
    )
    
    if not include_inactive:
        query = query.where(User.status == UserStatus.ACTIVE)
    
    if employee_ids:
        query = query.where(User.id.in_(employee_ids))
    
    result = await db.execute(query)
    employees = list(result.scalars().all())
    
    if not employees:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No employees found for payroll generation",
        )
    
    # Create payroll run
    payroll_run = PayrollRun(
        id=uuid.uuid4(),
        company_id=company_id,
        payroll_type=payroll_type,
        period_start_date=period_start,
        period_end_date=period_end,
        timezone=company_settings["timezone"],
        status=PayrollStatus.DRAFT,
        generated_by=generated_by,
        generated_at=datetime.utcnow(),
    )
    db.add(payroll_run)
    await db.flush()
    
    total_regular_hours = Decimal("0")
    total_overtime_hours = Decimal("0")
    total_gross_pay_cents = 0
    
    # Process each employee
    for employee in employees:
        pay_rate_cents = resolve_pay_rate_cents(employee)
        if pay_rate_cents == 0:
            continue  # Skip employees without pay rate

        overtime_multiplier = employee.overtime_multiplier
        if overtime_multiplier is None:
            overtime_multiplier = company_settings["overtime_multiplier_default"]
        else:
            overtime_multiplier = Decimal(str(overtime_multiplier))

        pay_method = employee.pay_method or PayMethod.HOURLY
        if pay_method == PayMethod.PER_ROOM or str(pay_method) == PayMethod.PER_ROOM.value:
            rooms_cleaned, room_numbers, rooms_by_date = await rooms_cleaned_in_period(
                db,
                company_id,
                employee.id,
                period_start,
                period_end,
                company_settings["timezone"],
            )
            rooms_overridden = False
            if room_count_overrides:
                normalized_rooms = {
                    str(k).strip().lower(): v for k, v in room_count_overrides.items()
                }
                emp_key = str(employee.id).strip().lower()
                if emp_key in normalized_rooms:
                    try:
                        rooms_cleaned = max(0, int(normalized_rooms[emp_key]))
                        rooms_overridden = True
                    except (TypeError, ValueError):
                        pass
            total_pay_cents = compute_per_room_pay_cents(rooms_cleaned, pay_rate_cents)
            details_json = {
                "pay_method": PayMethod.PER_ROOM.value,
                "rooms_cleaned": rooms_cleaned,
                "rate_cents_per_room": pay_rate_cents,
                "rooms_by_date": {} if rooms_overridden else rooms_by_date,
            }
            if rooms_overridden:
                details_json["rooms_overridden"] = True
            else:
                details_json["room_numbers"] = room_numbers
            line_item = PayrollLineItem(
                id=uuid.uuid4(),
                payroll_run_id=payroll_run.id,
                company_id=company_id,
                employee_id=employee.id,
                regular_minutes=0,
                overtime_minutes=0,
                total_minutes=0,
                pay_rate_cents=pay_rate_cents,
                overtime_multiplier=overtime_multiplier,
                regular_pay_cents=total_pay_cents,
                overtime_pay_cents=0,
                total_pay_cents=total_pay_cents,
                exceptions_count=0,
                details_json=details_json,
            )
            db.add(line_item)
            total_gross_pay_cents += total_pay_cents
            continue

        # Hourly: Fetch time entries
        time_entries = await fetch_time_entries_scoped(
            db,
            company_id,
            employee.id,
            period_start,
            period_end,
            company_settings["timezone"],
        )

        entry_minutes_overrides: Dict[str, int] = {}
        if entry_hour_overrides:
            # Accept both dashed and plain UUID string keys from the review UI
            normalized_overrides = {
                str(k).strip().lower(): v for k, v in entry_hour_overrides.items()
            }
            for entry in time_entries:
                key = str(entry.id).strip().lower()
                if key in normalized_overrides:
                    try:
                        hours_val = float(normalized_overrides[key])
                    except (TypeError, ValueError):
                        continue
                    entry_minutes_overrides[str(entry.id)] = max(0, int(round(hours_val * 60)))
        
        # Calculate minutes and pay
        regular_minutes, overtime_minutes, details, exceptions_count = compute_weekly_overtime_blocks(
            time_entries,
            period_start,
            period_end,
            company_settings,
            entry_minutes_overrides=entry_minutes_overrides if entry_minutes_overrides else None,
        )
        if entry_minutes_overrides:
            details = {
                **(details or {}),
                "hour_overrides_applied": entry_minutes_overrides,
            }
        details = {**(details or {}), "pay_method": PayMethod.HOURLY.value}
        
        total_minutes = regular_minutes + overtime_minutes
        
        # Calculate pay
        regular_pay_cents, overtime_pay_cents, total_pay_cents = compute_pay_cents_decimal_safe(
            regular_minutes,
            overtime_minutes,
            pay_rate_cents,
            overtime_multiplier,
        )
        
        # Create line item
        line_item = PayrollLineItem(
            id=uuid.uuid4(),
            payroll_run_id=payroll_run.id,
            company_id=company_id,
            employee_id=employee.id,
            regular_minutes=regular_minutes,
            overtime_minutes=overtime_minutes,
            total_minutes=total_minutes,
            pay_rate_cents=pay_rate_cents,
            overtime_multiplier=overtime_multiplier,
            regular_pay_cents=regular_pay_cents,
            overtime_pay_cents=overtime_pay_cents,
            total_pay_cents=total_pay_cents,
            exceptions_count=exceptions_count,
            details_json=details,
        )
        db.add(line_item)
        
        # Update totals
        total_regular_hours += Decimal(regular_minutes) / Decimal(60)
        total_overtime_hours += Decimal(overtime_minutes) / Decimal(60)
        total_gross_pay_cents += total_pay_cents
    
    # Update payroll run totals
    payroll_run.total_regular_hours = total_regular_hours
    payroll_run.total_overtime_hours = total_overtime_hours
    payroll_run.total_gross_pay_cents = total_gross_pay_cents
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=generated_by,
        action="PAYROLL_GENERATE",
        entity_type="payroll_run",
        entity_id=payroll_run.id,
        metadata_json={
            "payroll_type": payroll_type.value,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "employee_count": len(employees),
        },
    )
    db.add(audit_log)
    
    await db.commit()
    await db.refresh(payroll_run)
    
    return payroll_run


async def get_payroll_run(
    db: AsyncSession,
    payroll_run_id: UUID,
    company_id: UUID,
) -> Optional[PayrollRun]:
    """Get a payroll run with line items."""
    result = await db.execute(
        select(PayrollRun)
        .options(selectinload(PayrollRun.line_items).selectinload(PayrollLineItem.employee))
        .where(
            and_(
                PayrollRun.id == payroll_run_id,
                PayrollRun.company_id == company_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def list_payroll_runs(
    db: AsyncSession,
    company_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    status: Optional[PayrollStatus] = None,
    payroll_type: Optional[PayrollType] = None,
    skip: int = 0,
    limit: int = 100,
) -> Tuple[List[PayrollRun], int]:
    """List payroll runs for a company."""
    additional_filters = {}
    if payroll_type:
        additional_filters["payroll_type"] = payroll_type
    
    query = build_company_filtered_query(PayrollRun, company_id, additional_filters)
    
    # Apply date range filters
    if from_date:
        query = query.where(PayrollRun.period_start_date >= from_date)
    if to_date:
        query = query.where(PayrollRun.period_end_date <= to_date)
    
    # Apply status filter
    if status:
        query = filter_by_status(query, PayrollRun, status)
    
    return await get_paginated_results(
        db,
        query,
        skip=skip,
        limit=limit,
        order_by=PayrollRun.period_start_date.desc()
    )


async def finalize_payroll_run(
    db: AsyncSession,
    payroll_run_id: UUID,
    company_id: UUID,
    finalized_by: UUID,
    note: Optional[str] = None,
) -> PayrollRun:
    """Finalize a payroll run."""
    payroll_run = await get_payroll_run(db, payroll_run_id, company_id)
    if not payroll_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Payroll run with ID {payroll_run_id} not found in your company",
        )
    
    if payroll_run.status == PayrollStatus.FINALIZED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This payroll run for period {payroll_run.period_start_date} to {payroll_run.period_end_date} has already been finalized and cannot be modified.",
        )
    
    if payroll_run.status == PayrollStatus.VOID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This payroll run has been voided and cannot be finalized. Please create a new payroll run if needed.",
        )
    
    payroll_run.status = PayrollStatus.FINALIZED
    payroll_run.updated_at = datetime.utcnow()

    # Advance last pay date reference for the next cycle
    try:
        from app.models.company import Company
        from app.services.payroll_reminder_service import advance_last_pay_date_after_finalize

        company_result = await db.execute(select(Company).where(Company.id == company_id))
        company = company_result.scalar_one_or_none()
        if company:
            await advance_last_pay_date_after_finalize(db, company, payroll_run)
    except Exception:
        # Non-fatal: finalize should still succeed
        pass
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=finalized_by,
        action="PAYROLL_FINALIZE",
        entity_type="payroll_run",
        entity_id=payroll_run_id,
        metadata_json={"note": note} if note else {},
    )
    db.add(audit_log)
    
    await db.commit()
    await db.refresh(payroll_run)
    
    return payroll_run


async def void_payroll_run(
    db: AsyncSession,
    payroll_run_id: UUID,
    company_id: UUID,
    voided_by: UUID,
    reason: str,
) -> PayrollRun:
    """Void a payroll run."""
    payroll_run = await get_payroll_run(db, payroll_run_id, company_id)
    if not payroll_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payroll run not found",
        )
    
    if payroll_run.status == PayrollStatus.VOID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payroll run is already voided",
        )
    
    payroll_run.status = PayrollStatus.VOID
    payroll_run.updated_at = datetime.utcnow()
    
    # Create audit log
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=voided_by,
        action="PAYROLL_VOID",
        entity_type="payroll_run",
        entity_id=payroll_run_id,
        metadata_json={"reason": reason},
    )
    db.add(audit_log)
    
    await db.commit()
    await db.refresh(payroll_run)
    
    return payroll_run


async def delete_payroll_run(
    db: AsyncSession,
    payroll_run_id: UUID,
    company_id: UUID,
    deleted_by: UUID,
) -> None:
    """Delete a payroll run (only DRAFT status allowed)."""
    payroll_run = await get_payroll_run(db, payroll_run_id, company_id)
    if not payroll_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payroll run not found",
        )
    
    if payroll_run.status != PayrollStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only DRAFT payroll runs can be deleted",
        )
    
    # Create audit log before deletion
    audit_log = AuditLog(
        id=uuid.uuid4(),
        company_id=company_id,
        actor_user_id=deleted_by,
        action="PAYROLL_DELETE",
        entity_type="payroll_run",
        entity_id=payroll_run_id,
        metadata_json={
            "payroll_type": payroll_run.payroll_type.value,
            "period_start": payroll_run.period_start_date.isoformat(),
            "period_end": payroll_run.period_end_date.isoformat(),
        },
    )
    db.add(audit_log)
    await db.flush()  # Flush audit log first
    
    # Delete related records first to ensure proper cascade
    from app.models.payroll import PayrollLineItem, PayrollAdjustment
    await db.execute(delete(PayrollLineItem).where(PayrollLineItem.payroll_run_id == payroll_run_id))
    await db.execute(delete(PayrollAdjustment).where(PayrollAdjustment.payroll_run_id == payroll_run_id))
    
    # Delete the payroll run
    await db.execute(delete(PayrollRun).where(PayrollRun.id == payroll_run_id))
    await db.commit()

