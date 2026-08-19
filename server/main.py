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
    import asyncio
    import os

    logger.info("Starting ClockInn API server...")
    # Run database migrations on startup (only if RUN_MIGRATIONS env var is set)
    if os.getenv("RUN_MIGRATIONS", "false").lower() == "true":
        try:
            from alembic.config import Config
            from alembic import command
            from pathlib import Path
            from app.core.config import settings
            
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
    
    from app.core.config import settings as _settings
    from app.core.environment import is_production_environment

    if (_settings.REDIS_URL or "").strip():
        try:
            from app.core.login_attempts import ping_login_attempts_redis

            await ping_login_attempts_redis()
            logger.info("Login lockout: Redis backend (REDIS_URL is set).")
            logger.info("API rate limits: Redis sliding window (shared across API replicas).")
        except Exception as e:
            if is_production_environment():
                logger.error("Redis required in production but unreachable: %s", e)
                raise
            logger.warning(
                "REDIS_URL is set but Redis is unreachable (%s); falling back to in-memory "
                "rate limits / lockout until Redis is available.",
                e,
            )
    else:
        logger.info("Login lockout: in-memory — set REDIS_URL for shared lockout across API replicas.")
        logger.info("API rate limits: in-memory per process — set REDIS_URL to share limits across replicas.")

    async def _auto_clock_out_loop():
        """Periodically close open punches past scheduled shift end."""
        from app.core.database import AsyncSessionLocal
        from app.services.auto_clock_out_service import (
            AUTO_CLOCK_OUT_INTERVAL_SECONDS,
            run_auto_clock_outs,
        )

        # Short delay so startup / migrations finish first
        await asyncio.sleep(15)
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    summary = await run_auto_clock_outs(db)
                    if summary.get("clocked_out") or summary.get("emails_sent") or summary.get("errors"):
                        logger.info("Auto clock-out run: %s", summary)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("Auto clock-out loop error: %s", e, exc_info=True)
            await asyncio.sleep(AUTO_CLOCK_OUT_INTERVAL_SECONDS)

    auto_clock_out_task = asyncio.create_task(_auto_clock_out_loop())
    logger.info("Auto clock-out background task started")

    async def _payroll_reminder_loop():
        """Hourly: email admins when payroll generation window is open."""
        from app.core.database import AsyncSessionLocal
        from app.services.payroll_reminder_service import (
            PAYROLL_REMINDER_INTERVAL_SECONDS,
            process_payroll_reminders,
        )

        await asyncio.sleep(45)
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    summary = await process_payroll_reminders(db)
                    if summary.get("sent") or summary.get("errors"):
                        logger.info("Payroll reminder run: %s", summary)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("Payroll reminder loop error: %s", e, exc_info=True)
            await asyncio.sleep(PAYROLL_REMINDER_INTERVAL_SECONDS)

    payroll_reminder_task = asyncio.create_task(_payroll_reminder_loop())
    logger.info("Payroll reminder background task started")

    logger.info("ClockInn API server started successfully")
    yield
    # Shutdown
    logger.info("Shutting down ClockInn API server...")
    auto_clock_out_task.cancel()
    payroll_reminder_task.cancel()
    try:
        await auto_clock_out_task
    except asyncio.CancelledError:
        pass
    try:
        await payroll_reminder_task
    except asyncio.CancelledError:
        pass
    try:
        from app.core.login_attempts import close_login_attempts_redis
        from app.middleware.rate_limit import close_rate_limit_redis

        await close_rate_limit_redis()
        await close_login_attempts_redis()
    except Exception as e:
        logger.warning("Redis shutdown (rate_limit / login_attempts): %s", e)


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
    path = request.url.path or "/"

    # Avoid flooding the live log viewer with its own poll/stream traffic
    skip_access = path.startswith("/api/v1/developer/logs")

    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        duration_ms = int(process_time * 1000)

        if not skip_access:
            actor = None
            auth = request.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                try:
                    from app.core.security import decode_token

                    payload = decode_token(auth.split(" ", 1)[1].strip())
                    if isinstance(payload, dict):
                        actor = payload.get("email") or payload.get("sub")
                except Exception:
                    actor = None

            parts = [
                f"{request.method} {path}",
                f"status={response.status_code}",
                f"duration_ms={duration_ms}",
            ]
            if actor:
                parts.append(f"actor={actor}")
            if request.client:
                parts.append(f"client={request.client.host}")
            access_logger.info(" ".join(parts))

        return response
    except Exception:
        process_time = time.time() - start_time
        duration_ms = int(process_time * 1000)
        logger.error(
            f"Unhandled exception in {request.method} {path} duration_ms={duration_ms}",
            exc_info=True,
        )
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

# Global rate limit by IP (must be *inside* CORS). If rate limit returns 429 without calling next,
# an outer CORS layer would still add Access-Control-Allow-Origin; inner CORS would not run.
# Stricter limits apply to /api/v1/auth/* and /api/v1/kiosk/* (see settings).
app.add_middleware(RateLimitMiddleware)

# CORS: explicit origins only (* rejected in config). Added last so it wraps rate limiting and
# applies CORS headers to every response (including 429 from rate limit).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

