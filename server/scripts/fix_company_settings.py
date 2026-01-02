"""
Script to fix company settings by removing deprecated keys and ensuring proper structure.
Run this once to clean up the database.
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.models.company import Company
from app.core.config import settings

async def fix_company_settings():
    """Fix company settings by removing deprecated keys."""
    # Ensure we use asyncpg driver
    db_url = settings.DATABASE_URL
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif not db_url.startswith("postgresql+asyncpg://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    engine = create_async_engine(
        db_url,
        echo=False,
    )
    
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as db:
        # Get all companies
        result = await db.execute(select(Company))
        companies = result.scalars().all()
        
        print(f"Found {len(companies)} companies to process...")
        
        for company in companies:
            if not company.settings_json:
                company.settings_json = {}
                print(f"Company {company.id}: Initialized empty settings")
                continue
            
            settings_dict = company.settings_json.copy()
            updated = False
            
            # Remove deprecated keys
            deprecated_keys = ['week_start_day', 'rounding_rule', 'overtime_threshold']
            for key in deprecated_keys:
                if key in settings_dict:
                    del settings_dict[key]
                    updated = True
                    print(f"Company {company.id}: Removed deprecated key '{key}'")
            
            # Ensure required keys exist with defaults
            if 'timezone' not in settings_dict:
                settings_dict['timezone'] = 'America/Chicago'
                updated = True
                print(f"Company {company.id}: Added default timezone")
            
            if 'payroll_week_start_day' not in settings_dict:
                settings_dict['payroll_week_start_day'] = 0
                updated = True
                print(f"Company {company.id}: Added default payroll_week_start_day")
            
            if 'overtime_enabled' not in settings_dict:
                settings_dict['overtime_enabled'] = True
                updated = True
                print(f"Company {company.id}: Added default overtime_enabled")
            
            if 'overtime_threshold_hours_per_week' not in settings_dict:
                settings_dict['overtime_threshold_hours_per_week'] = 40
                updated = True
                print(f"Company {company.id}: Added default overtime_threshold_hours_per_week")
            
            if 'overtime_multiplier_default' not in settings_dict:
                settings_dict['overtime_multiplier_default'] = 1.5
                updated = True
                print(f"Company {company.id}: Added default overtime_multiplier_default")
            
            if 'rounding_policy' not in settings_dict:
                settings_dict['rounding_policy'] = 'none'
                updated = True
                print(f"Company {company.id}: Added default rounding_policy")
            
            if updated:
                company.settings_json = settings_dict
                print(f"Company {company.id}: Updated settings: {settings_dict}")
        
        await db.commit()
        print("\nAll companies processed successfully!")
    
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(fix_company_settings())

