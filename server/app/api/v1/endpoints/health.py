from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from sqlalchemy import text
from typing import Optional
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check(db: Optional[AsyncSession] = Depends(get_db)):
    """
    Health check endpoint.
    Returns API status and database connectivity.
    """
    status = {
        "status": "healthy",
        "service": "ClockInn API",
        "version": "1.0.0"
    }
    
    # Check database connectivity
    try:
        await db.execute(text("SELECT 1"))
        status["database"] = "connected"
    except Exception as e:
        status["database"] = "disconnected"
        status["status"] = "degraded"
        status["error"] = str(e)
        # Log database connection errors
        logger.error(f"Database connection error: {str(e)}", exc_info=True)
    
    return status


@router.get("/health/test-error")
async def test_error_logging():
    """
    Test endpoint to verify error logging is working.
    This will intentionally raise an error to test error.log.
    """
    try:
        # Intentionally raise an error for testing
        raise ValueError("This is a test error to verify error logging functionality")
    except Exception as e:
        logger.error("Test error logged successfully", exc_info=True)
        raise HTTPException(status_code=500, detail="Test error - check error.log to verify logging")

