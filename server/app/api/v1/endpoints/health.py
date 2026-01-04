from fastapi import APIRouter, Depends, HTTPException, status as http_status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db, engine
from app.core.config import settings
from sqlalchemy import text
from typing import Optional, Dict, Any
import logging
import sys
import platform
import time
from datetime import datetime, timezone
import os

router = APIRouter()
logger = logging.getLogger(__name__)

# Track server startup time for uptime calculation
SERVER_START_TIME = time.time()


async def get_database_info(db: AsyncSession) -> Dict[str, Any]:
    """Get database connection information and version."""
    db_info = {
        "status": "unknown",
        "version": None,
        "connection_pool": {},
        "migration_status": None
    }
    
    try:
        # Check database connection
        await db.execute(text("SELECT 1"))
        db_info["status"] = "connected"
        
        # Get PostgreSQL version
        try:
            version_result = await db.execute(text("SELECT version()"))
            version_row = version_result.scalar_one_or_none()
            if version_row:
                # Extract version number from full version string
                version_str = str(version_row)
                # Parse PostgreSQL version (e.g., "PostgreSQL 15.2 ...")
                if "PostgreSQL" in version_str:
                    version_parts = version_str.split(" ")[1].split(".")
                    db_info["version"] = {
                        "full": version_str,
                        "major": version_parts[0] if len(version_parts) > 0 else None,
                        "minor": version_parts[1] if len(version_parts) > 1 else None
                    }
        except Exception as e:
            logger.debug(f"Could not fetch database version: {e}")
        
        # Get connection pool stats from SQLAlchemy engine
        try:
            pool = engine.pool
            db_info["connection_pool"] = {
                "size": pool.size() if hasattr(pool, 'size') else None,
                "checked_in": pool.checkedin() if hasattr(pool, 'checkedin') else None,
                "checked_out": pool.checkedout() if hasattr(pool, 'checkedout') else None,
                "overflow": pool.overflow() if hasattr(pool, 'overflow') else None,
                "invalid": pool.invalid() if hasattr(pool, 'invalid') else None,
            }
        except Exception as e:
            logger.debug(f"Could not fetch pool stats: {e}")
        
        # Check migration status (check if alembic_version table exists)
        try:
            result = await db.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'alembic_version'
                )
            """))
            has_alembic_table = result.scalar_one_or_none()
            
            if has_alembic_table:
                # Get current migration version
                result = await db.execute(text("SELECT version_num FROM alembic_version ORDER BY version_num DESC LIMIT 1"))
                current_version = result.scalar_one_or_none()
                db_info["migration_status"] = {
                    "initialized": True,
                    "current_version": current_version if current_version else "unknown"
                }
            else:
                db_info["migration_status"] = {
                    "initialized": False,
                    "current_version": None
                }
        except Exception as e:
            logger.debug(f"Could not check migration status: {e}")
            db_info["migration_status"] = {"error": str(e)}
            
    except Exception as e:
        db_info["status"] = "disconnected"
        db_info["error"] = str(e)
        logger.error(f"Database connection error in health check: {str(e)}", exc_info=True)
    
    return db_info


@router.get("/health")
async def health_check(db: Optional[AsyncSession] = Depends(get_db)):
    """
    Comprehensive health check endpoint with vital system information.
    
    Returns detailed health status including:
    - Service status and version
    - Database connectivity and version
    - System information
    - Configuration status
    - Connection pool statistics
    - Migration status
    - Timestamp and uptime
    
    Returns:
        - 200 OK: Service is healthy
        - 503 Service Unavailable: Service is unhealthy (database disconnected)
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    uptime_seconds = time.time() - SERVER_START_TIME
    uptime_hours = uptime_seconds / 3600
    uptime_days = uptime_hours / 24
    
    # Initialize health status
    health_status: Dict[str, Any] = {
        "status": "healthy",
        "timestamp": timestamp,
        "service": {
            "name": "ClockInn API",
            "version": "1.0.0",
            "uptime": {
                "seconds": round(uptime_seconds, 2),
                "hours": round(uptime_hours, 2),
                "days": round(uptime_days, 2),
                "formatted": f"{int(uptime_days)}d {int(uptime_hours % 24)}h {int((uptime_seconds % 3600) / 60)}m"
            }
        },
        "system": {
            "python_version": sys.version.split()[0],
            "platform": platform.platform(),
            "architecture": platform.architecture()[0],
            "processor": platform.processor() or "unknown"
        },
        "database": {},
        "configuration": {
            "environment": os.getenv("ENVIRONMENT", "development"),
            "cors_origins_configured": bool(settings.CORS_ORIGINS),
            "frontend_url": settings.FRONTEND_URL,
            "rate_limiting_enabled": settings.RATE_LIMIT_ENABLED,
            "database_ssl": "supabase" in settings.DATABASE_URL.lower() or "pooler.supabase.com" in settings.DATABASE_URL,
        },
        "dependencies": {
            "fastapi": "0.104.1",
            "sqlalchemy": "2.0.23",
            "asyncpg": "0.29.0",
            "pydantic": "2.5.0",
            "uvicorn": "0.24.0"
        }
    }
    
    http_code = http_status.HTTP_200_OK
    
    # Get database information
    if db:
        db_info = await get_database_info(db)
        health_status["database"] = db_info
        
        # Update overall status based on database connection
        if db_info.get("status") != "connected":
            health_status["status"] = "unhealthy"
            health_status["error"] = db_info.get("error", "Database connection failed")
            http_code = http_status.HTTP_503_SERVICE_UNAVAILABLE
    else:
        health_status["database"] = {
            "status": "unknown",
            "error": "Database session not available"
        }
        health_status["status"] = "degraded"
    
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

