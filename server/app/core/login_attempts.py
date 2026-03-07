"""
In-memory login attempt tracking and lockout.
Keyed by normalized email. For multi-instance deployments, replace with Redis.
"""
from datetime import datetime, timedelta
from typing import Optional
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

# In-memory: key = normalized email, value = { "attempts": int, "lockout_until": datetime | None }
_attempts: dict[str, dict] = {}


def _now_utc() -> datetime:
    return datetime.utcnow()


def is_locked_out(normalized_email: str) -> tuple[bool, Optional[datetime]]:
    """
    Returns (is_locked, lockout_until).
    If lockout_until is in the past, clear it and return (False, None).
    """
    if not settings.RATE_LIMIT_ENABLED:
        return False, None
    entry = _attempts.get(normalized_email)
    if not entry:
        return False, None
    lockout_until = entry.get("lockout_until")
    if not lockout_until:
        return False, None
    if _now_utc() >= lockout_until:
        _attempts.pop(normalized_email, None)
        return False, None
    return True, lockout_until


def record_failed_attempt(normalized_email: str) -> None:
    if not settings.RATE_LIMIT_ENABLED:
        return
    now = _now_utc()
    if normalized_email not in _attempts:
        _attempts[normalized_email] = {"attempts": 0, "lockout_until": None}
    entry = _attempts[normalized_email]
    entry["attempts"] = entry["attempts"] + 1
    if entry["attempts"] >= settings.LOGIN_ATTEMPTS_LIMIT:
        entry["lockout_until"] = now + timedelta(minutes=settings.LOCKOUT_DURATION_MINUTES)
        logger.warning("Login lockout applied for email=%s", normalized_email[:3] + "***")
    return


def clear_attempts(normalized_email: str) -> None:
    _attempts.pop(normalized_email, None)
