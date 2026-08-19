"""
Payroll pay-date schedule helpers.

Companies set a last pay date + cadence (weekly / biweekly). We derive the next
pay date, the matching pay period, and whether generation is allowed (within
4 days before the pay date).

Convention:
- Pay date = payroll issue / payday (when employees are paid)
- Pay period = the prior completed week (weekly) or two weeks (biweekly),
  aligned to the company week-start day — not ending the day before payday.

Example (week starts Monday, weekly):
  Pay date 2026-08-14 → period 2026-08-03 – 2026-08-09
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional, Tuple

GENERATE_WINDOW_DAYS = 4  # generate allowed on pay_date-4 … pay_date inclusive


def payroll_interval_days(payroll_type: str) -> int:
    value = str(payroll_type or "").upper()
    if value == "BIWEEKLY":
        return 14
    return 7


def parse_payroll_type(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    upper = str(value).strip().upper()
    if upper in ("WEEKLY", "BIWEEKLY"):
        return upper
    return None


def compute_next_pay_date(last_pay_date: date, payroll_type: str, today: date) -> date:
    """
    Roll forward from last_pay_date by weekly/biweekly intervals until the next
    pay date on or after today. If last_pay_date is today, the next cycle is used.
    """
    interval = payroll_interval_days(payroll_type)
    if last_pay_date > today:
        return last_pay_date

    next_pay = last_pay_date + timedelta(days=interval)
    while next_pay < today:
        next_pay += timedelta(days=interval)
    return next_pay


def week_start_on_or_before(day: date, week_start_day: int) -> date:
    """Return the start of the week that contains `day` (week_start_day: 0=Mon … 6=Sun)."""
    ws = int(week_start_day) % 7
    days_since = (day.weekday() - ws) % 7
    return day - timedelta(days=days_since)


def period_for_pay_date(
    next_pay_date: date,
    payroll_type: str,
    week_start_day: int = 0,
) -> Tuple[date, date]:
    """
    Work period paid on `next_pay_date`.

    Period is the last completed week (or two weeks for biweekly) before the
    calendar week that contains the pay date.
    """
    pay_week_start = week_start_on_or_before(next_pay_date, week_start_day)
    period_end = pay_week_start - timedelta(days=1)
    span = payroll_interval_days(payroll_type) - 1  # 6 or 13
    period_start = period_end - timedelta(days=span)
    return period_start, period_end


def pay_date_for_period(
    period_end: date,
    week_start_day: int = 0,
    reference_pay_date: Optional[date] = None,
) -> date:
    """
    Infer the issue/pay date for a completed work period.

    Pay date falls in the week after period_end, on the same weekday as
    `reference_pay_date` when provided (else Friday-relative to week start).
    """
    pay_week_start = period_end + timedelta(days=1)
    if reference_pay_date is not None:
        target_weekday = reference_pay_date.weekday()
    else:
        # Friday if week starts Monday; otherwise week_start + 4
        target_weekday = (int(week_start_day) + 4) % 7
    delta = (target_weekday - pay_week_start.weekday()) % 7
    return pay_week_start + timedelta(days=delta)


def pay_date_for_run(period_end: date, company_settings: Optional[dict] = None) -> date:
    """Pay / issue date for a payroll run's completed work period."""
    settings = company_settings or {}
    week_start_day = int(settings.get("payroll_week_start_day") or 0)
    raw = settings.get("last_pay_date")
    reference: Optional[date] = None
    if isinstance(raw, date):
        reference = raw
    elif raw:
        try:
            reference = date.fromisoformat(str(raw)[:10])
        except (TypeError, ValueError):
            reference = None
    return pay_date_for_period(
        period_end,
        week_start_day=week_start_day,
        reference_pay_date=reference,
    )


@dataclass
class PayScheduleStatus:
    configured: bool
    last_pay_date: Optional[date]
    payroll_type: Optional[str]
    next_pay_date: Optional[date]
    period_start: Optional[date]
    period_end: Optional[date]
    days_until_pay_date: Optional[int]
    generate_window_days: int
    can_generate: bool
    window_opens_on: Optional[date]
    reminder_enabled: bool
    message: str


def build_pay_schedule_status(
    *,
    last_pay_date: Optional[date],
    payroll_type: Optional[str],
    today: date,
    reminder_enabled: bool = True,
    week_start_day: int = 0,
) -> PayScheduleStatus:
    ptype = parse_payroll_type(payroll_type)
    if not last_pay_date or not ptype:
        return PayScheduleStatus(
            configured=False,
            last_pay_date=last_pay_date,
            payroll_type=ptype,
            next_pay_date=None,
            period_start=None,
            period_end=None,
            days_until_pay_date=None,
            generate_window_days=GENERATE_WINDOW_DAYS,
            can_generate=False,
            window_opens_on=None,
            reminder_enabled=reminder_enabled,
            message="Set pay schedule in Settings.",
        )

    next_pay = compute_next_pay_date(last_pay_date, ptype, today)
    period_start, period_end = period_for_pay_date(next_pay, ptype, week_start_day)
    days_until = (next_pay - today).days
    window_opens = next_pay - timedelta(days=GENERATE_WINDOW_DAYS)
    can_generate = 0 <= days_until <= GENERATE_WINDOW_DAYS

    if can_generate:
        if days_until == 0:
            msg = "Payday today — generate payroll now."
        elif days_until == 1:
            msg = "1 day until payday — generate payroll now."
        else:
            msg = f"{days_until} days until payday — generate payroll now."
    elif days_until > GENERATE_WINDOW_DAYS:
        msg = f"Next payday {next_pay.isoformat()} · {days_until} days left"
    else:
        # days_until < 0 shouldn't happen with compute_next_pay_date
        msg = f"Next payday {next_pay.isoformat()}"

    return PayScheduleStatus(
        configured=True,
        last_pay_date=last_pay_date,
        payroll_type=ptype,
        next_pay_date=next_pay,
        period_start=period_start,
        period_end=period_end,
        days_until_pay_date=days_until,
        generate_window_days=GENERATE_WINDOW_DAYS,
        can_generate=can_generate,
        window_opens_on=window_opens,
        reminder_enabled=reminder_enabled,
        message=msg,
    )
