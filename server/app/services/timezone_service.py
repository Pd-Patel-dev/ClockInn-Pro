"""
Service for timezone conversions and date formatting using company settings.
"""
from typing import Optional
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
    utc_datetime: datetime,
    timezone_str: str,
) -> datetime:
    """Convert UTC datetime to company timezone."""
    try:
        tz = pytz.timezone(timezone_str)
        # If datetime is naive, assume it's UTC
        if utc_datetime.tzinfo is None:
            utc_datetime = pytz.utc.localize(utc_datetime)
        # Convert to company timezone
        return utc_datetime.astimezone(tz)
    except Exception:
        # Fallback to UTC if timezone is invalid
        return utc_datetime


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

