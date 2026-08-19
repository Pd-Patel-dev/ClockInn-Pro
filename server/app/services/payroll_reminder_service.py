"""Payroll reminder emails and scheduled checks."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import UUID

import pytz
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.models.company import Company
from app.models.payroll import PayrollRun, PayrollStatus, PayrollType
from app.services.company_service import get_company_admin_emails, get_company_settings
from app.services.email_service import email_service
from app.services.payroll_schedule_service import (
    GENERATE_WINDOW_DAYS,
    build_pay_schedule_status,
    parse_payroll_type,
)

logger = logging.getLogger(__name__)

# How often the background loop wakes (seconds). Logic is still date-based.
PAYROLL_REMINDER_INTERVAL_SECONDS = 60 * 60  # hourly


def _parse_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _company_today(timezone_str: str) -> date:
    try:
        tz = pytz.timezone(timezone_str or "America/Chicago")
    except Exception:
        tz = pytz.timezone("America/Chicago")
    return datetime.now(tz).date()


async def get_schedule_for_company(db: AsyncSession, company: Company) -> Dict[str, Any]:
    """Build schedule status + existing run for the upcoming period."""
    cfg = get_company_settings(company)
    today = _company_today(cfg.get("timezone", "America/Chicago"))
    last_pay = _parse_date(cfg.get("last_pay_date"))
    payroll_type = parse_payroll_type(cfg.get("payroll_pay_type"))
    reminder_enabled = bool(cfg.get("payroll_reminder_enabled", True))

    status = build_pay_schedule_status(
        last_pay_date=last_pay,
        payroll_type=payroll_type,
        today=today,
        reminder_enabled=reminder_enabled,
        week_start_day=int(cfg.get("payroll_week_start_day") or 0),
    )

    existing_run_id = None
    existing_run_status = None
    if status.configured and status.period_start and status.period_end and status.payroll_type:
        result = await db.execute(
            select(PayrollRun).where(
                and_(
                    PayrollRun.company_id == company.id,
                    PayrollRun.payroll_type == PayrollType(status.payroll_type),
                    PayrollRun.period_start_date == status.period_start,
                    PayrollRun.period_end_date == status.period_end,
                    PayrollRun.status.in_([PayrollStatus.DRAFT, PayrollStatus.FINALIZED]),
                )
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing_run_id = str(existing.id)
            existing_run_status = existing.status.value

    return {
        "configured": status.configured,
        "last_pay_date": status.last_pay_date.isoformat() if status.last_pay_date else None,
        "payroll_type": status.payroll_type,
        "next_pay_date": status.next_pay_date.isoformat() if status.next_pay_date else None,
        "period_start": status.period_start.isoformat() if status.period_start else None,
        "period_end": status.period_end.isoformat() if status.period_end else None,
        "days_until_pay_date": status.days_until_pay_date,
        "generate_window_days": status.generate_window_days,
        "in_generate_window": status.can_generate,
        "can_generate": status.can_generate and not existing_run_id,
        "window_opens_on": status.window_opens_on.isoformat() if status.window_opens_on else None,
        "reminder_enabled": status.reminder_enabled,
        "message": status.message,
        "existing_run_id": existing_run_id,
        "existing_run_status": existing_run_status,
        "today": today.isoformat(),
    }


async def advance_last_pay_date_after_finalize(
    db: AsyncSession,
    company: Company,
    payroll_run: PayrollRun,
) -> None:
    """
    After finalize, set last_pay_date to the issue/pay date for this run
    (in the week after the work period, same weekday as the prior payday).
    """
    from app.services.payroll_schedule_service import pay_date_for_period

    cfg = get_company_settings(company)
    current_settings = dict(company.settings_json or {})
    week_start_day = int(cfg.get("payroll_week_start_day") or 0)
    reference = _parse_date(cfg.get("last_pay_date"))
    payday = pay_date_for_period(
        payroll_run.period_end_date,
        week_start_day=week_start_day,
        reference_pay_date=reference,
    )
    current_settings["last_pay_date"] = payday.isoformat()
    if payroll_run.payroll_type:
        current_settings["payroll_pay_type"] = payroll_run.payroll_type.value
    # Clear reminder sent flag so next cycle can email again
    current_settings.pop("payroll_reminder_sent_for", None)
    company.settings_json = current_settings
    flag_modified(company, "settings_json")
    await db.flush()


async def process_payroll_reminders(db: AsyncSession) -> Dict[str, int]:
    """Scan companies and email admins when inside the generate window."""
    summary = {"checked": 0, "sent": 0, "skipped": 0, "errors": 0}

    result = await db.execute(select(Company))
    companies = list(result.scalars().all())

    for company in companies:
        summary["checked"] += 1
        try:
            cfg = get_company_settings(company)
            if not cfg.get("payroll_reminder_enabled", True):
                summary["skipped"] += 1
                continue

            schedule = await get_schedule_for_company(db, company)
            if not schedule.get("configured"):
                summary["skipped"] += 1
                continue
            if not schedule.get("in_generate_window"):
                summary["skipped"] += 1
                continue

            # If a run already exists for the period, don't nag
            if schedule.get("existing_run_id"):
                summary["skipped"] += 1
                continue

            days_until = schedule.get("days_until_pay_date")
            if days_until is None or days_until < 0 or days_until > GENERATE_WINDOW_DAYS:
                summary["skipped"] += 1
                continue

            next_pay = schedule.get("next_pay_date")
            sent_for = (company.settings_json or {}).get("payroll_reminder_sent_for")
            if sent_for == next_pay:
                summary["skipped"] += 1
                continue

            emails = await get_company_admin_emails(db, company.id)
            if not emails:
                summary["skipped"] += 1
                continue

            frontend = (settings.FRONTEND_URL or "http://localhost:3000").rstrip("/")
            deep_link = f"{frontend}/login?next=/payroll"

            days_left = int(days_until)
            ok_any = False
            for email in emails:
                ok = await email_service.send_payroll_generate_reminder(
                    to_email=email,
                    company_name=company.name,
                    next_pay_date=next_pay,
                    period_start=schedule.get("period_start"),
                    period_end=schedule.get("period_end"),
                    days_until=days_left,
                    deep_link=deep_link,
                    payroll_type=schedule.get("payroll_type") or "WEEKLY",
                )
                ok_any = ok_any or ok

            if ok_any:
                current = dict(company.settings_json or {})
                current["payroll_reminder_sent_for"] = next_pay
                company.settings_json = current
                flag_modified(company, "settings_json")
                summary["sent"] += 1
            else:
                summary["errors"] += 1
        except Exception as e:
            logger.error("Payroll reminder failed for company %s: %s", company.id, e, exc_info=True)
            summary["errors"] += 1

    await db.commit()
    return summary
