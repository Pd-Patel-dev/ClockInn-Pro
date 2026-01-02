"""
Script to add time entries (punches) for all employees for a specified date range.
Run with: python -m scripts.add_time_entries
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select
from app.core.config import settings
from app.models.company import Company
from app.models.user import User, UserRole, UserStatus
from app.models.time_entry import TimeEntry, TimeEntrySource, TimeEntryStatus
import uuid
from datetime import datetime, date, timedelta
import pytz

# Date range: December 15, 2025 to December 28, 2025
START_DATE = date(2025, 12, 15)
END_DATE = date(2025, 12, 28)

# Work schedule: 8 hours per day, Monday-Friday
WORK_START_HOUR = 9  # 9:00 AM
WORK_DURATION_HOURS = 8
BREAK_MINUTES = 30  # 30 minute lunch break


async def add_time_entries():
    """Add time entries for all employees for the specified date range."""
    # Create async engine
    database_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
    engine = create_async_engine(database_url, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with AsyncSessionLocal() as db:
        # Get the first company
        result = await db.execute(select(Company).order_by(Company.created_at))
        company = result.scalar_one_or_none()
        
        if not company:
            print("No company found. Please run seed_data.py first to create a company.")
            return
        
        # Get company timezone from settings
        company_settings = company.settings_json or {}
        timezone_str = company_settings.get("timezone", "America/New_York")
        tz = pytz.timezone(timezone_str)
        
        # Get all active employees
        result = await db.execute(
            select(User).where(
                User.company_id == company.id,
                User.role == UserRole.EMPLOYEE,
                User.status == UserStatus.ACTIVE,
            )
        )
        employees = result.scalars().all()
        
        if not employees:
            print("No active employees found.")
            return
        
        print(f"Adding time entries for {len(employees)} employees")
        print(f"Date range: {START_DATE} to {END_DATE}")
        print(f"Company timezone: {timezone_str}\n")
        
        total_entries = 0
        
        # Iterate through each day in the range
        current_date = START_DATE
        while current_date <= END_DATE:
            # Skip weekends (Saturday = 5, Sunday = 6)
            if current_date.weekday() < 5:  # Monday = 0, Friday = 4
                # For each employee, create a time entry for this day
                for employee in employees:
                    # Create clock in time (9:00 AM in company timezone)
                    clock_in_local = tz.localize(
                        datetime.combine(current_date, datetime.min.time().replace(hour=WORK_START_HOUR))
                    )
                    clock_in_utc = clock_in_local.astimezone(pytz.UTC)
                    
                    # Create clock out time (5:00 PM in company timezone, accounting for 30 min break)
                    clock_out_local = tz.localize(
                        datetime.combine(
                            current_date,
                            datetime.min.time().replace(
                                hour=WORK_START_HOUR + WORK_DURATION_HOURS,
                                minute=BREAK_MINUTES
                            )
                        )
                    )
                    clock_out_utc = clock_out_local.astimezone(pytz.UTC)
                    
                    # Create time entry
                    time_entry = TimeEntry(
                        id=uuid.uuid4(),
                        company_id=company.id,
                        employee_id=employee.id,
                        clock_in_at=clock_in_utc,
                        clock_out_at=clock_out_utc,
                        break_minutes=BREAK_MINUTES,
                        source=TimeEntrySource.KIOSK,
                        status=TimeEntryStatus.CLOSED,
                        note=None,
                    )
                    db.add(time_entry)
                    total_entries += 1
                
                print(f"Added entries for {current_date.strftime('%A, %B %d, %Y')} ({len(employees)} employees)")
            
            # Move to next day
            current_date += timedelta(days=1)
        
        await db.commit()
        
        # Calculate total hours
        working_days = sum(1 for d in [START_DATE + timedelta(days=x) for x in range((END_DATE - START_DATE).days + 1)] if d.weekday() < 5)
        total_hours_per_employee = working_days * WORK_DURATION_HOURS
        
        print(f"\n✓ Successfully added {total_entries} time entries!")
        print(f"  - {len(employees)} employees")
        print(f"  - {working_days} working days (Monday-Friday)")
        print(f"  - {WORK_DURATION_HOURS} hours per day")
        print(f"  - {total_hours_per_employee} total hours per employee")
        print(f"  - {BREAK_MINUTES} minute break per day")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(add_time_entries())

