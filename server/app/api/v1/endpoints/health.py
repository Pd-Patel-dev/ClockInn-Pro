from fastapi import APIRouter, Depends, HTTPException, status as http_status
from fastapi.responses import JSONResponse
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
    Health check endpoint for Docker and monitoring.
    Returns API status and database connectivity.
    
    Returns:
        - 200 OK: Service is healthy
        - 503 Service Unavailable: Service is unhealthy (database disconnected)
    """
    health_status = {
        "status": "healthy",
        "service": "ClockInn API",
        "version": "1.0.0",
        "database": "connected"
    }
    
    http_code = http_status.HTTP_200_OK
    
    # Check database connectivity
    try:
        await db.execute(text("SELECT 1"))
        health_status["database"] = "connected"
    except Exception as e:
        health_status["database"] = "disconnected"
        health_status["status"] = "unhealthy"
        health_status["error"] = str(e)
        http_code = http_status.HTTP_503_SERVICE_UNAVAILABLE
        # Log database connection errors
        logger.error(f"Database connection error in health check: {str(e)}", exc_info=True)
    
    return JSONResponse(
        status_code=http_code,
        content=health_status
    )


@router.get("/health/ready")
async def readiness_check(db: Optional[AsyncSession] = Depends(get_db)):
    """
    Readiness check endpoint.
    Verifies that the service is ready to accept traffic.
    More strict than /health - requires database connection.
    
    Returns:
        - 200 OK: Service is ready
        - 503 Service Unavailable: Service is not ready
    """
    try:
        # Verify database connection
        await db.execute(text("SELECT 1"))
        return JSONResponse(
            status_code=http_status.HTTP_200_OK,
            content={
                "status": "ready",
                "service": "ClockInn API"
            }
        )
    except Exception as e:
        logger.error(f"Readiness check failed: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "not_ready",
                "service": "ClockInn API",
                "error": "Database connection failed"
            }
        )


@router.get("/health/live")
async def liveness_check():
    """
    Liveness check endpoint.
    Verifies that the service is alive (not crashed).
    Does not check database - just confirms the process is running.
    
    Returns:
        - 200 OK: Service is alive
    """
    return JSONResponse(
        status_code=http_status.HTTP_200_OK,
        content={
            "status": "alive",
            "service": "ClockInn API"
        }
    )


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

