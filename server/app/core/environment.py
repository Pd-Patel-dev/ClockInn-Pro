"""
Production vs development detection.

Use `settings.ENVIRONMENT` (env var `ENVIRONMENT`) consistently instead of scattered `os.getenv` calls.
"""
from app.core.config import settings


def is_production_environment() -> bool:
    """True when ENVIRONMENT is set to prod/production (stricter API error responses, HTTPS helpers, etc.)."""
    v = (settings.ENVIRONMENT or "").strip().lower()
    return v in ("prod", "production")
