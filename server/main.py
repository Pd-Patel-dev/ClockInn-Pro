from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
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

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

