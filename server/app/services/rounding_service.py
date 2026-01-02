"""
Service for applying rounding policies to time calculations.
"""
from typing import Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.company import Company
from app.models.time_entry import TimeEntry

# Default rounding policy
DEFAULT_ROUNDING_POLICY = "none"


def apply_rounding(minutes: int, rounding_policy: str) -> int:
    """
    Apply rounding policy to minutes.
    
    Args:
        minutes: Total minutes to round
        rounding_policy: "none", "5", "10", or "15"
    
    Returns:
        Rounded minutes
    """
    if rounding_policy == "none":
        return minutes
    elif rounding_policy == "5":
        return round(minutes / 5) * 5
    elif rounding_policy == "10":
        return round(minutes / 10) * 10
    elif rounding_policy == "15":
        return round(minutes / 15) * 15
    return minutes


def compute_minutes_with_rounding_and_breaks(
    clock_in: datetime,
    clock_out: Optional[datetime],
    break_minutes: int,
    rounding_policy: str,
    breaks_paid: bool = False,
) -> int:
    """
    Calculate worked minutes with breaks and rounding.
    
    Args:
        clock_in: Clock in time
        clock_out: Clock out time (None if open)
        break_minutes: Break minutes to subtract (if breaks_paid is False)
        rounding_policy: Rounding policy to apply
        breaks_paid: If True, breaks are paid and not deducted. If False, breaks are deducted.
    
    Returns:
        Rounded paid minutes
    """
    if clock_out is None:
        return 0  # Open shift
    
    total_seconds = (clock_out - clock_in).total_seconds()
    total_minutes = int(total_seconds / 60)
    
    # Subtract break time only if breaks are NOT paid
    if breaks_paid:
        paid_minutes = total_minutes  # Breaks are paid, don't deduct
    else:
        paid_minutes = max(0, total_minutes - break_minutes)  # Deduct breaks
    
    # Apply rounding
    return apply_rounding(paid_minutes, rounding_policy)


async def get_company_rounding_policy(
    db: AsyncSession,
    company_id: UUID,
) -> str:
    """Get company rounding policy."""
    result = await db.execute(
        select(Company).where(Company.id == company_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        return DEFAULT_ROUNDING_POLICY
    
    settings = company.settings_json or {}
    return settings.get("rounding_policy", DEFAULT_ROUNDING_POLICY)

