#!/usr/bin/env python3
"""
Data migration script to migrate data from local PostgreSQL to Supabase.

This script exports data from local database and imports it to Supabase.
Run this after schema migrations are complete in Supabase.

Usage:
    python scripts/migrate_to_supabase.py --source DATABASE_URL --target SUPABASE_URL
"""
import asyncio
import sys
import os
from pathlib import Path
from typing import List, Dict, Any
import logging
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text
from app.core.config import settings
from app.models import (
    Company, User, Session, TimeEntry, LeaveRequest,
    PayrollRun, PayrollLineItem, PayrollAdjustment,
    Shift, ShiftTemplate, ScheduleSwap
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def get_engine(db_url: str):
    """Create async engine from database URL."""
    # Convert to async URL if needed
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    # Configure SSL for Supabase
    connect_args = {}
    if "supabase.co" in db_url or "supabase" in db_url.lower() or "pooler.supabase.com" in db_url:
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        connect_args = {"ssl": ssl_context}
    
    return create_async_engine(db_url, connect_args=connect_args, echo=False)


async def export_table_data(
    session: AsyncSession,
    model_class,
    table_name: str,
    order_by: str = "created_at"
) -> List[Dict[str, Any]]:
    """Export all data from a table."""
    try:
        result = await session.execute(
            select(model_class).order_by(order_by)
        )
        rows = result.scalars().all()
        
        data = []
        for row in rows:
            # Convert SQLAlchemy model to dict
            row_dict = {}
            for column in model_class.__table__.columns:
                value = getattr(row, column.name)
                # Convert datetime to ISO format for JSON serialization
                if hasattr(value, 'isoformat'):
                    value = value.isoformat()
                # Handle UUID
                if hasattr(value, '__str__'):
                    value = str(value)
                row_dict[column.name] = value
            data.append(row_dict)
        
        logger.info(f"Exported {len(data)} rows from {table_name}")
        return data
    except Exception as e:
        logger.error(f"Error exporting {table_name}: {e}")
        return []


async def import_table_data(
    session: AsyncSession,
    model_class,
    table_name: str,
    data: List[Dict[str, Any]],
    skip_duplicates: bool = True
) -> int:
    """Import data into a table."""
    if not data:
        logger.info(f"No data to import for {table_name}")
        return 0
    
    imported = 0
    skipped = 0
    errors = 0
    
    try:
        for row_data in data:
            try:
                # Check if row already exists (by ID)
                if skip_duplicates and 'id' in row_data:
                    existing = await session.get(model_class, row_data['id'])
                    if existing:
                        skipped += 1
                        continue
                
                # Create model instance
                # Handle datetime strings
                for key, value in row_data.items():
                    if isinstance(value, str):
                        # Try to parse datetime
                        try:
                            if 'T' in value or (' ' in value and ':' in value):
                                try:
                                    from dateutil.parser import parse
                                    row_data[key] = parse(value)
                                except ImportError:
                                    # Fallback to datetime if dateutil not available
                                    from datetime import datetime
                                    # Try ISO format first
                                    try:
                                        row_data[key] = datetime.fromisoformat(value.replace('Z', '+00:00'))
                                    except:
                                        pass
                        except:
                            pass
                
                instance = model_class(**row_data)
                session.add(instance)
                imported += 1
                
            except Exception as e:
                logger.error(f"Error importing row into {table_name}: {e}")
                errors += 1
                continue
        
        await session.commit()
        logger.info(f"Imported {imported} rows into {table_name} (skipped: {skipped}, errors: {errors})")
        return imported
    
    except Exception as e:
        logger.error(f"Error importing {table_name}: {e}")
        await session.rollback()
        return 0


async def migrate_data(source_url: str, target_url: str, skip_existing: bool = True):
    """Main migration function."""
    logger.info("=" * 60)
    logger.info("Starting data migration to Supabase")
    logger.info("=" * 60)
    
    # Create engines
    logger.info("Connecting to source database...")
    source_engine = await get_engine(source_url)
    source_session_maker = async_sessionmaker(source_engine, expire_on_commit=False)
    
    logger.info("Connecting to target database (Supabase)...")
    target_engine = await get_engine(target_url)
    target_session_maker = async_sessionmaker(target_engine, expire_on_commit=False)
    
    # Define migration order (respect foreign key constraints)
    migration_order = [
        (Company, "companies"),
        (User, "users"),
        (Session, "sessions"),
        (ShiftTemplate, "shift_templates"),
        (Shift, "shifts"),
        (TimeEntry, "time_entries"),
        (LeaveRequest, "leave_requests"),
        (PayrollRun, "payroll_runs"),
        (PayrollLineItem, "payroll_line_items"),
        (PayrollAdjustment, "payroll_adjustments"),
        (ScheduleSwap, "schedule_swaps"),
    ]
    
    async with source_session_maker() as source_session, target_session_maker() as target_session:
        total_exported = 0
        total_imported = 0
        
        for model_class, table_name in migration_order:
            logger.info(f"\n--- Migrating {table_name} ---")
            
            # Export from source
            data = await export_table_data(source_session, model_class, table_name)
            total_exported += len(data)
            
            if not data:
                logger.info(f"No data found in {table_name}, skipping...")
                continue
            
            # Import to target
            imported = await import_table_data(
                target_session,
                model_class,
                table_name,
                data,
                skip_duplicates=skip_existing
            )
            total_imported += imported
        
        logger.info("\n" + "=" * 60)
        logger.info("Migration Summary")
        logger.info("=" * 60)
        logger.info(f"Total rows exported: {total_exported}")
        logger.info(f"Total rows imported: {total_imported}")
        logger.info("=" * 60)
    
    await source_engine.dispose()
    await target_engine.dispose()


async def verify_migration(target_url: str):
    """Verify migration by counting rows in both databases."""
    logger.info("\nVerifying migration...")
    
    target_engine = await get_engine(target_url)
    target_session_maker = async_sessionmaker(target_engine, expire_on_commit=False)
    
    tables = [
        ("companies", Company),
        ("users", User),
        ("sessions", Session),
        ("time_entries", TimeEntry),
        ("shifts", Shift),
        ("leave_requests", LeaveRequest),
    ]
    
    async with target_session_maker() as session:
        for table_name, model_class in tables:
            try:
                result = await session.execute(select(model_class))
                count = len(result.scalars().all())
                logger.info(f"{table_name}: {count} rows")
            except Exception as e:
                logger.error(f"Error counting {table_name}: {e}")
    
    await target_engine.dispose()


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Migrate data to Supabase')
    parser.add_argument(
        '--source',
        type=str,
        help='Source database URL (local PostgreSQL)',
        default=None
    )
    parser.add_argument(
        '--target',
        type=str,
        help='Target database URL (Supabase)',
        default=None
    )
    parser.add_argument(
        '--verify-only',
        action='store_true',
        help='Only verify migration, do not migrate'
    )
    parser.add_argument(
        '--no-skip-existing',
        action='store_true',
        help='Do not skip existing rows (will cause errors on duplicates)'
    )
    
    args = parser.parse_args()
    
    # Get URLs from args or environment
    source_url = args.source or os.getenv('SOURCE_DATABASE_URL')
    target_url = args.target or os.getenv('TARGET_DATABASE_URL') or settings.DATABASE_URL
    
    if not source_url:
        logger.error("Source database URL required. Use --source or SOURCE_DATABASE_URL env var")
        sys.exit(1)
    
    if not target_url:
        logger.error("Target database URL required. Use --target or TARGET_DATABASE_URL env var")
        sys.exit(1)
    
    if args.verify_only:
        asyncio.run(verify_migration(target_url))
    else:
        skip_existing = not args.no_skip_existing
        asyncio.run(migrate_data(source_url, target_url, skip_existing))
        asyncio.run(verify_migration(target_url))


if __name__ == "__main__":
    main()

