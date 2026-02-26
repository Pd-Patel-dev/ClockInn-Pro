"""
Service for timezone conversions and date formatting using company settings.
"""
from typing import Optional, Tuple
from uuid import UUID
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import pytz

from app.models.company import Company

# Default timezone
DEFAULT_TIMEZONE = "America/Chicago"


async def get_company_timezone(
    db: AsyncSession,
    company_id: UUID,
) -> str:
    """Get company timezone."""
    result = await db.execute(
        select(Company).where(Company.id == company_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        return DEFAULT_TIMEZONE
    
    settings = company.settings_json or {}
    return settings.get("timezone", DEFAULT_TIMEZONE)


def convert_to_company_timezone(
    utc_datetime: Optional[datetime],
    timezone_str: str,
) -> Optional[datetime]:
    """Convert UTC datetime to company timezone. Returns None if utc_datetime is None."""
    try:
        if utc_datetime is None:
            return None
        tz = pytz.timezone(timezone_str)
        # If datetime is naive, assume it's UTC
        if utc_datetime.tzinfo is None:
            utc_datetime = pytz.utc.localize(utc_datetime)
        # Convert to company timezone
        return utc_datetime.astimezone(tz)
    except Exception:
        # Fallback to UTC if timezone is invalid
        return utc_datetime


def get_utc_range_for_company_date_range(
    timezone_str: str,
    start_date: date,
    end_date: date,
) -> Tuple[datetime, datetime]:
    """
    Return (start_utc, end_utc) for the given date range in company timezone.
    Use these for filtering time_entries: clock_in_at >= start_utc AND clock_in_at <= end_utc.
    """
    try:
        tz = pytz.timezone(timezone_str)
        start_local = tz.localize(datetime.combine(start_date, datetime.min.time()))
        end_local = tz.localize(datetime.combine(end_date, datetime.max.time()))
        start_utc = start_local.astimezone(pytz.UTC)
        end_utc = end_local.astimezone(pytz.UTC)
        return start_utc, end_utc
    except Exception:
        # Fallback: treat dates as UTC (wrong but safe)
        start_utc = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=pytz.UTC)
        end_utc = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=pytz.UTC)
        return start_utc, end_utc


def format_datetime_for_company(
    utc_datetime: datetime,
    timezone_str: str,
    format_str: str = "%Y-%m-%d %H:%M:%S",
) -> str:
    """Format datetime in company timezone."""
    local_dt = convert_to_company_timezone(utc_datetime, timezone_str)
    return local_dt.strftime(format_str)


def format_date_for_company(
    utc_datetime: datetime,
    timezone_str: str,
) -> str:
    """Format date in company timezone."""
    return format_datetime_for_company(utc_datetime, timezone_str, "%Y-%m-%d")


def format_time_for_company(
    utc_datetime: datetime,
    timezone_str: str,
) -> str:
    """Format time in company timezone."""
    return format_datetime_for_company(utc_datetime, timezone_str, "%H:%M")

