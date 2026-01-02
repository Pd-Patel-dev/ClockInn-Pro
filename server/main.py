from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import time
import logging

from app.core.config import settings
from app.core.database import engine, Base
from app.api.v1.router import api_router
from app.core.logging_config import setup_logging

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)
access_logger = logging.getLogger("access")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting ClockInn API server...")
    async with engine.begin() as conn:
        # Tables are created via Alembic migrations
        pass
    logger.info("ClockInn API server started successfully")
    yield
    # Shutdown
    logger.info("Shutting down ClockInn API server...")


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

# CORS
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
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Validation error",
            "errors": errors,
            "message": "Please check your input and try again."
        }
    )

# Include routers
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    logger.debug("Health check requested")
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

