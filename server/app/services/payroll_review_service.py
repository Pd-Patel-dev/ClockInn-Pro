"""
Pay-period review preview: employees + time entries before payroll generate.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

import pytz
from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company
from app.models.payroll import PayrollType
from app.models.time_entry import TimeEntryStatus
from app.models.user import User, UserRole, UserStatus, PayMethod
from app.services.company_service import get_company_settings
from app.services.payroll_schedule_service import (
    build_pay_schedule_status,
    parse_payroll_type,
)
from app.services.payroll_service import (
    compute_minutes_with_rounding_and_breaks,
    compute_pay_period,
    compute_per_room_pay_cents,
    compute_weekly_overtime_blocks,
    rooms_cleaned_in_period,
    fetch_time_entries_scoped,
    resolve_pay_rate_cents,
)


async def build_payroll_review_preview(
    db: AsyncSession,
    company: Company,
    payroll_type: PayrollType,
    start_date: date,
    include_inactive: bool = False,
    bypass_schedule: bool = False,
) -> Dict[str, Any]:
    """
    List employees for a pay period with time entries and computed hours.
    Used by the generate dialog review step (before creating a run).
    """
    company_settings = get_company_settings(company)
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
        today=date.today(),
        reminder_enabled=bool(company_settings.get("payroll_reminder_enabled", True)),
        week_start_day=int(company_settings.get("payroll_week_start_day") or 0),
    )

    from app.core.environment import allows_dev_overrides

    skip_schedule = bool(bypass_schedule) and allows_dev_overrides()

    if schedule.configured and last_pay_date and configured_type and not skip_schedule:
        if not schedule.can_generate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=schedule.message,
            )
        if schedule.period_start and start_date != schedule.period_start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Period must start on {schedule.period_start.isoformat()} for the current pay schedule.",
            )
        if schedule.payroll_type and payroll_type.value != schedule.payroll_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll type must be {schedule.payroll_type} for the current pay schedule.",
            )

    period_start, period_end, _warning = compute_pay_period(
        payroll_type,
        start_date,
        company_settings,
        strict_mode=False,
    )
    tz_name = company_settings["timezone"]
    tz = pytz.timezone(tz_name)

    query = select(User).where(
        and_(
            User.company_id == company.id,
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

    result = await db.execute(query.order_by(User.name.asc()))
    employees = list(result.scalars().all())

    employee_rows: List[Dict[str, Any]] = []
    for employee in employees:
        pay_rate_cents = resolve_pay_rate_cents(employee)
        if pay_rate_cents == 0:
            continue

        overtime_multiplier = employee.overtime_multiplier
        if overtime_multiplier is None:
            overtime_multiplier = company_settings["overtime_multiplier_default"]
        else:
            overtime_multiplier = Decimal(str(overtime_multiplier))

        pay_method = employee.pay_method or PayMethod.HOURLY
        if pay_method == PayMethod.PER_ROOM or str(pay_method) == PayMethod.PER_ROOM.value:
            rooms_cleaned, room_numbers, _rooms_by_date = await rooms_cleaned_in_period(
                db,
                company.id,
                employee.id,
                period_start,
                period_end,
                tz_name,
            )
            estimated_pay_cents = compute_per_room_pay_cents(rooms_cleaned, pay_rate_cents)
            employee_rows.append(
                {
                    "employee_id": str(employee.id),
                    "employee_name": employee.name,
                    "pay_method": PayMethod.PER_ROOM.value,
                    "pay_rate_cents": pay_rate_cents,
                    "overtime_multiplier": float(overtime_multiplier),
                    "rooms_cleaned": rooms_cleaned,
                    "estimated_pay_cents": estimated_pay_cents,
                    "room_numbers": room_numbers,
                    "regular_minutes": 0,
                    "overtime_minutes": 0,
                    "total_minutes": 0,
                    "total_hours": 0,
                    "exceptions_count": 0,
                    "entry_count": 0,
                    "open_entry_count": 0,
                    "entries": [],
                }
            )
            continue

        time_entries = await fetch_time_entries_scoped(
            db,
            company.id,
            employee.id,
            period_start,
            period_end,
            tz_name,
        )

        regular_minutes, overtime_minutes, _details, exceptions_count = compute_weekly_overtime_blocks(
            time_entries,
            period_start,
            period_end,
            company_settings,
        )
        total_minutes = regular_minutes + overtime_minutes

        entry_rows: List[Dict[str, Any]] = []
        for entry in sorted(
            time_entries,
            key=lambda e: e.clock_in_at.timestamp() if e.clock_in_at else 0,
        ):
            clock_in_local = entry.clock_in_at.astimezone(tz) if entry.clock_in_at else None
            clock_out_local = entry.clock_out_at.astimezone(tz) if entry.clock_out_at else None
            minutes = 0
            if entry.clock_in_at and entry.clock_out_at:
                minutes = compute_minutes_with_rounding_and_breaks(
                    entry.clock_in_at,
                    entry.clock_out_at,
                    entry.break_minutes or 0,
                    company_settings["rounding_policy"],
                    company_settings["breaks_paid"],
                )
            entry_rows.append(
                {
                    "id": str(entry.id),
                    "clock_in_at": entry.clock_in_at.isoformat() if entry.clock_in_at else None,
                    "clock_out_at": entry.clock_out_at.isoformat() if entry.clock_out_at else None,
                    "clock_in_local": clock_in_local.strftime("%Y-%m-%d %H:%M") if clock_in_local else None,
                    "clock_out_local": clock_out_local.strftime("%Y-%m-%d %H:%M") if clock_out_local else None,
                    "break_minutes": entry.break_minutes or 0,
                    "status": entry.status.value if entry.status else None,
                    "minutes": minutes,
                    "hours": round(minutes / 60.0, 2),
                    "is_open": entry.clock_out_at is None,
                    "note": entry.note,
                }
            )

        employee_rows.append(
            {
                "employee_id": str(employee.id),
                "employee_name": employee.name,
                "pay_method": PayMethod.HOURLY.value,
                "pay_rate_cents": pay_rate_cents,
                "overtime_multiplier": float(overtime_multiplier),
                "rooms_cleaned": None,
                "estimated_pay_cents": None,
                "room_numbers": [],
                "regular_minutes": regular_minutes,
                "overtime_minutes": overtime_minutes,
                "total_minutes": total_minutes,
                "total_hours": round(total_minutes / 60.0, 2),
                "exceptions_count": exceptions_count,
                "entry_count": len(entry_rows),
                "open_entry_count": sum(1 for e in entry_rows if e["is_open"]),
                "entries": entry_rows,
            }
        )

    return {
        "payroll_type": payroll_type.value,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "timezone": tz_name,
        "breaks_paid": bool(company_settings.get("breaks_paid")),
        "employee_count": len(employee_rows),
        "employees": employee_rows,
    }


def clock_out_for_paid_hours(
    clock_in: datetime,
    paid_hours: float,
    break_minutes: int,
    breaks_paid: bool,
) -> datetime:
    """
    Derive clock_out so paid hours match the value typed in the review UI.
    paid_hours is worked hours after unpaid-break deduction (same as payroll math).
    """
    if paid_hours < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hours cannot be negative")
    paid_minutes = int(round(paid_hours * 60))
    if breaks_paid:
        span_minutes = paid_minutes
    else:
        span_minutes = paid_minutes + max(0, int(break_minutes or 0))
    return clock_in + timedelta(minutes=span_minutes)
