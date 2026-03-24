from fastapi import FastAPI, Request, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time
import logging

from app.core.config import settings
from app.core.environment import is_production_environment
from app.core.security_headers import PERMISSIONS_POLICY, content_security_policy_for_path
from app.core.database import engine, Base
from app.api.v1.router import api_router
from app.core.logging_config import setup_logging
from app.middleware.rate_limit import RateLimitMiddleware

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)
access_logger = logging.getLogger("access")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting ClockInn API server...")
    # Run database migrations on startup (only if RUN_MIGRATIONS env var is set)
    import os
    if os.getenv("RUN_MIGRATIONS", "false").lower() == "true":
        try:
            from alembic.config import Config
            from alembic import command
            from pathlib import Path
            from app.core.config import settings
            import asyncio
            
            def run_migrations():
                alembic_cfg = Config(str(Path(__file__).parent / "alembic.ini"))
                # Convert async URL to sync for Alembic
                db_url = settings.DATABASE_URL
                if db_url.startswith("postgresql+asyncpg://"):
                    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://", 1)
                alembic_cfg.set_main_option("sqlalchemy.url", db_url)
                command.upgrade(alembic_cfg, "head")
            
            logger.info("Running database migrations...")
            # Run in thread to avoid blocking async loop
            await asyncio.get_event_loop().run_in_executor(None, run_migrations)
            logger.info("✅ Database migrations completed successfully")
        except Exception as e:
            logger.warning(f"⚠️  Migration check failed (this is OK if migrations are run separately): {e}")
            # Don't fail startup if migrations fail - they might be run manually
    else:
        logger.info("Skipping automatic migrations (set RUN_MIGRATIONS=true to enable)")
    
    # Log email (Gmail) status so admins know if schedule/verification emails will work
    try:
        from app.services.email_service import email_service
        if email_service.service is not None:
            logger.info("Email (Gmail API): enabled — schedule and verification emails will be sent.")
        else:
            logger.warning("Email (Gmail API): NOT configured — schedule and verification emails will NOT be sent. Set GMAIL_CREDENTIALS_JSON and GMAIL_TOKEN_JSON (or use Developer Portal /setup/gmail).")
    except Exception as e:
        logger.warning("Could not check email service: %s", e)
    
    try:
        from app.core.config import settings as _settings

        if _settings.REDIS_URL:
            logger.info("Login lockout: Redis backend (REDIS_URL is set).")
        else:
            logger.info("Login lockout: in-memory — set REDIS_URL for shared lockout across API replicas.")
    except Exception:
        pass

    logger.info("ClockInn API server started successfully")
    yield
    # Shutdown
    logger.info("Shutting down ClockInn API server...")
    try:
        from app.core.login_attempts import close_login_attempts_redis

        await close_login_attempts_redis()
    except Exception as e:
        logger.warning("login_attempts Redis shutdown: %s", e)


app = FastAPI(
    title="ClockInn API",
    description="Multi-tenant clock-in/clock-out system API",
    version="1.0.0",
    lifespan=lifespan,
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    
    try:
        # Process request
        response = await call_next(request)
        
        # Calculate duration
        process_time = time.time() - start_time
        
        # Log request
        access_logger.info(
            f"{request.method} {request.url.path} - "
            f"Status: {response.status_code} - "
            f"Duration: {process_time:.3f}s - "
            f"Client: {request.client.host if request.client else 'unknown'}"
        )
        
        return response
    except Exception as e:
        # Log unhandled exceptions to error log
        process_time = time.time() - start_time
        logger.error(
            f"Unhandled exception in {request.method} {request.url.path}",
            exc_info=True,
            extra={
                "method": request.method,
                "path": str(request.url.path),
                "client": request.client.host if request.client else 'unknown',
                "duration": f"{process_time:.3f}s"
            }
        )
        # Re-raise to let FastAPI handle it
        raise


# Security headers (add before CORS so they apply to all responses)
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    from fastapi.responses import RedirectResponse

    is_production = is_production_environment()
    forwarded_proto = request.headers.get("x-forwarded-proto", "").strip().lower()

    # HTTPS redirect in production when request came over HTTP (proxy should do this; app fallback)
    if is_production and forwarded_proto == "http":
        host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
        path = request.url.path or "/"
        if request.url.query:
            path = f"{path}?{request.url.query}"
        return RedirectResponse(url=f"https://{host}{path}", status_code=301)

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    response.headers["Content-Security-Policy"] = content_security_policy_for_path(request.url.path)

    # HSTS when request was forwarded over HTTPS
    if is_production and forwarded_proto == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"

    return response

# CORS: explicit origins only (* rejected in config). In production, https:// required except localhost/127.0.0.1.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global rate limit by IP (outermost after CORS = runs first on incoming request).
# Stricter limits apply to /api/v1/auth/* and /api/v1/kiosk/* (see settings).
app.add_middleware(RateLimitMiddleware)

# Custom exception handler for validation errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return detailed validation errors to help users fix their input."""
    errors = []
    for error in exc.errors():
        field = " -> ".join(str(loc) for loc in error["loc"])
        message = error["msg"]
        error_type = error["type"]
        
        # Provide more user-friendly messages
        if error_type == "value_error.missing":
            message = f"{field.replace('body.', '').replace('query.', '').replace('path.', '')} is required"
        elif error_type == "type_error":
            message = f"{field.replace('body.', '').replace('query.', '').replace('path.', '')} has an invalid type"
        elif error_type == "value_error":
            message = f"{field.replace('body.', '').replace('query.', '').replace('path.', '')}: {message}"
        
        errors.append({
            "field": field.replace("body.", "").replace("query.", "").replace("path.", ""),
            "message": message,
            "type": error_type
        })
    
    # Return 400 instead of 422 for better compatibility
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "detail": "Validation error",
            "errors": errors,
            "message": "Please check your input and try again."
        }
    )


@app.exception_handler(Exception)
async def global_unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catch any exception not converted to HTTPException (e.g. missing @handle_endpoint_errors).
    Never return stack traces or raw exception text in production.
    """
    if isinstance(exc, HTTPException):
        hdrs = getattr(exc, "headers", None) or {}
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=dict(hdrs),
        )
    logger.exception("Unhandled exception: %s %s", request.method, request.url.path)
    if is_production_environment():
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An unexpected error occurred. Please try again later."},
        )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": f"{type(exc).__name__}: {exc!s}"},
    )


# Include routers
app.include_router(api_router, prefix="/api/v1")


if __name__ == "__main__":
    import uvicorn
    import os
    from pathlib import Path
    
    # Enable reload in development mode (default to True if not in production)
    reload = not is_production_environment() or os.getenv("RELOAD", "").lower() == "true"
    
    if reload:
        script_dir = Path(__file__).parent.absolute()
        reload_dirs = [str(script_dir / "app"), str(script_dir)]
        print("🔄 Auto-reload enabled - server will restart on file changes")
    else:
        reload_dirs = None
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=reload,
        reload_dirs=reload_dirs,
        reload_includes=["*.py"] if reload else None,
        reload_delay=0.25 if reload else None,
    )

