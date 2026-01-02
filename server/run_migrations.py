#!/usr/bin/env python3
"""
Script to run database migrations with proper error handling and logging.
This can be called directly or as part of the startup process.
"""
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

import logging
from alembic.config import Config
from alembic import command
from app.core.config import settings

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def run_migrations():
    """Run Alembic migrations to head revision."""
    try:
        logger.info("Starting database migrations...")
        logger.info(f"Database URL: {settings.DATABASE_URL[:20]}...")  # Log partial URL for security
        
        # Create Alembic config
        alembic_cfg = Config(str(Path(__file__).parent / "alembic.ini"))
        
        # Run migrations
        command.upgrade(alembic_cfg, "head")
        
        logger.info("✅ Migrations completed successfully!")
        return 0
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}", exc_info=True)
        return 1

if __name__ == "__main__":
    exit_code = run_migrations()
    sys.exit(exit_code)

