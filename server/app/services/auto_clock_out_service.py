"""Auto clock-out when employees forget to punch out after scheduled end time."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

import pytz
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cash_drawer import CashDrawerSession, CashDrawerStatus
from app.models.company import Company
from app.models.shift import Shift, ShiftStatus
from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User, UserStatus
from app.services.cash_drawer_service import (
    FORGOT_PUNCH_OUT_REVIEW_NOTE,
    force_deactivate_cash_drawer_for_auto_clock_out,
)
from app.services.company_service import get_company_settings
from app.services.timezone_service import format_datetime_for_company

logger = logging.getLogger(__name__)

# How often the background loop runs
AUTO_CLOCK_OUT_INTERVAL_SECONDS = 60


def _ensure_aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _company_tz(timezone_str: str):
    try:
        return pytz.timezone(timezone_str)
    except Exception:
        return pytz.timezone("America/Chicago")


def shift_window_utc(shift: Shift, tz) -> Tuple[datetime, datetime]:
    """Return (start_utc, end_utc) for a shift in company wall-clock timezone."""
    start_local = tz.localize(datetime.combine(shift.shift_date, shift.start_time))
    end_date = shift.shift_date
    if shift.end_time <= shift.start_time:
        end_date = shift.shift_date + timedelta(days=1)
    end_local = tz.localize(datetime.combine(end_date, shift.end_time))
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def find_matching_shift(
    shifts: List[Shift],
    clock_in_utc: datetime,
    tz,
) -> Optional[Tuple[Shift, datetime, datetime]]:
    """
    Find the published/approved shift this open punch belongs to.
    Clock-in may be up to 2 hours before scheduled start.
    Prefers the shift whose start is closest to clock-in.
    """
    clock_in_utc = _ensure_aware_utc(clock_in_utc)
    candidates: List[Tuple[Shift, datetime, datetime, float]] = []
    for shift in shifts:
        start_utc, end_utc = shift_window_utc(shift, tz)
        early = start_utc - timedelta(hours=2)
        if early <= clock_in_utc < end_utc:
            distance = abs((clock_in_utc - start_utc).total_seconds())
            candidates.append((shift, start_utc, end_utc, distance))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[3])
    shift, start_utc, end_utc, _ = candidates[0]
    return shift, start_utc, end_utc


async def _load_candidate_shifts(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
    clock_in_utc: datetime,
    tz,
) -> List[Shift]:
    """Load nearby PUBLISHED/APPROVED shifts for matching."""
    local_in = _ensure_aware_utc(clock_in_utc).astimezone(tz)
    day = local_in.date()
    dates = [day - timedelta(days=1), day, day + timedelta(days=1)]
    result = await db.execute(
        select(Shift).where(
            and_(
                Shift.company_id == company_id,
                Shift.employee_id == employee_id,
                Shift.shift_date.in_(dates),
                Shift.status.in_([ShiftStatus.PUBLISHED, ShiftStatus.APPROVED]),
            )
        )
    )
    return list(result.scalars().all())


async def run_auto_clock_outs(db: AsyncSession) -> Dict[str, Any]:
    """
    Close open time entries whose matching scheduled shift has ended.
    If a cash drawer is still open, deactivate it and flag REVIEW_NEEDED for admin.
    Returns summary counts.
    """
    from app.services.email_service import email_service

    now_utc = datetime.now(timezone.utc)
    summary = {
        "checked": 0,
        "clocked_out": 0,
        "drawer_forced_reviews": 0,
        "skipped_no_schedule": 0,
        "skipped_disabled": 0,
        "skipped_not_due": 0,
        "emails_sent": 0,
        "errors": 0,
    }

    open_entries = (
        await db.execute(
            select(TimeEntry, User, Company)
            .join(User, User.id == TimeEntry.employee_id)
            .join(Company, Company.id == TimeEntry.company_id)
            .where(
                and_(
                    TimeEntry.clock_out_at.is_(None),
                    TimeEntry.status == TimeEntryStatus.OPEN,
                    User.status == UserStatus.ACTIVE,
                )
            )
        )
    ).all()

    for entry, employee, company in open_entries:
        summary["checked"] += 1
        try:
            settings = get_company_settings(company)
            if not settings.get("auto_clock_out_enabled", True):
                summary["skipped_disabled"] += 1
                continue

            grace_minutes = int(settings.get("auto_clock_out_grace_minutes") or 0)
            tz = _company_tz(settings.get("timezone") or "America/Chicago")
            clock_in_utc = _ensure_aware_utc(entry.clock_in_at)

            shifts = await _load_candidate_shifts(
                db, company.id, employee.id, clock_in_utc, tz
            )
            matched = find_matching_shift(shifts, clock_in_utc, tz)
            if not matched:
                summary["skipped_no_schedule"] += 1
                continue

            shift, _start_utc, end_utc = matched
            due_at = end_utc + timedelta(minutes=max(0, grace_minutes))
            if now_utc < due_at:
                summary["skipped_not_due"] += 1
                continue

            cash_session = (
                await db.execute(
                    select(CashDrawerSession).where(
                        and_(
                            CashDrawerSession.time_entry_id == entry.id,
                            CashDrawerSession.status == CashDrawerStatus.OPEN,
                        )
                    )
                )
            ).scalar_one_or_none()

            if cash_session:
                await force_deactivate_cash_drawer_for_auto_clock_out(db, cash_session)
                summary["drawer_forced_reviews"] += 1

            # Force clock-out at scheduled end (not "now") so hours match schedule
            clock_out_at = end_utc
            if clock_out_at <= clock_in_utc:
                clock_out_at = now_utc

            entry.clock_out_at = clock_out_at
            entry.status = TimeEntryStatus.CLOSED
            note = "Auto clock-out: scheduled shift end (forgot to clock out)."
            if cash_session:
                note = f"{note} Cash drawer deactivated — {FORGOT_PUNCH_OUT_REVIEW_NOTE}"
            entry.note = (note[:500]) if not entry.note else f"{entry.note} | {note}"[:500]
            if entry.shift_id is None:
                entry.shift_id = shift.id

            await db.commit()
            await db.refresh(entry)
            if cash_session:
                await db.refresh(cash_session)
            summary["clocked_out"] += 1

            end_label = format_datetime_for_company(
                end_utc, settings.get("timezone") or "America/Chicago", "%b %d, %Y · %I:%M %p"
            )
            in_label = format_datetime_for_company(
                clock_in_utc, settings.get("timezone") or "America/Chicago", "%b %d, %Y · %I:%M %p"
            )
            try:
                ok = await email_service.send_auto_clock_out_notification(
                    to_email=employee.email,
                    employee_name=employee.name or "Employee",
                    clock_in_at=in_label,
                    clock_out_at=end_label,
                    scheduled_end_at=end_label,
                    company_name=company.name or "your company",
                )
                if ok:
                    summary["emails_sent"] += 1
            except Exception as email_err:
                logger.warning(
                    "Auto clock-out email failed for %s: %s",
                    employee.email,
                    email_err,
                )

            # Best-effort admin shift summary (same as manual clock-out)
            try:
                from app.services.time_entry_service import _send_clock_out_shift_summary_email

                await _send_clock_out_shift_summary_email(
                    db,
                    company=company,
                    employee=employee,
                    entry=entry,
                    cash_session=cash_session,
                )
            except Exception as admin_email_err:
                logger.warning(
                    "Admin shift summary after auto clock-out failed: %s",
                    admin_email_err,
                )

            logger.info(
                "Auto clocked out entry=%s employee=%s scheduled_end=%s drawer_review=%s",
                entry.id,
                employee.id,
                end_utc.isoformat(),
                bool(cash_session),
            )
        except Exception as e:
            summary["errors"] += 1
            logger.error("Auto clock-out failed for entry %s: %s", entry.id, e, exc_info=True)
            try:
                await db.rollback()
            except Exception:
                pass

    return summary
