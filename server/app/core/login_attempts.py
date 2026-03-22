"""
Login attempt tracking and lockout.

- **In-memory** (default): per-process dict. Lost on restart / not shared across workers.
- **Redis** (when `REDIS_URL` is set): shared across instances; set `REDIS_URL` in production with multiple API replicas.

Optional `LOGIN_LOCKOUT_USE_IP`: key by normalized email + client IP (reduces shared-account false lockouts;
  slightly weaker against distributed attacks on one email).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# --- In-memory fallback (key = storage_key(email, ip)) ---
_attempts: dict[str, dict[str, Any]] = {}

# --- Lazy Redis (async) ---
_redis_client: Any = None


def _storage_key(normalized_email: str, client_ip: Optional[str]) -> str:
    if settings.LOGIN_LOCKOUT_USE_IP and client_ip:
        safe_ip = client_ip.replace(":", "_").replace("/", "_")[:128]
        return f"{normalized_email}|{safe_ip}"
    return normalized_email


def _now_utc() -> datetime:
    return datetime.utcnow()


def _memory_is_locked_out(key: str) -> tuple[bool, Optional[datetime]]:
    entry = _attempts.get(key)
    if not entry:
        return False, None
    lockout_until = entry.get("lockout_until")
    if not lockout_until:
        return False, None
    if _now_utc() >= lockout_until:
        _attempts.pop(key, None)
        return False, None
    return True, lockout_until


def _memory_record_failed(key: str) -> None:
    now = _now_utc()
    if key not in _attempts:
        _attempts[key] = {"attempts": 0, "lockout_until": None}
    entry = _attempts[key]
    entry["attempts"] = entry["attempts"] + 1
    if entry["attempts"] >= settings.LOGIN_ATTEMPTS_LIMIT:
        entry["lockout_until"] = now + timedelta(minutes=settings.LOCKOUT_DURATION_MINUTES)
        logger.warning("Login lockout applied (memory) key=%s***", key[:8])


def _memory_clear(key: str) -> None:
    _attempts.pop(key, None)


def _state_to_json(attempts: int, lockout_until: Optional[datetime]) -> str:
    payload = {
        "attempts": attempts,
        "lockout_until": lockout_until.isoformat() if lockout_until else None,
    }
    return json.dumps(payload)


def _state_from_json(raw: Optional[str]) -> tuple[int, Optional[datetime]]:
    if not raw:
        return 0, None
    try:
        data = json.loads(raw)
        attempts = int(data.get("attempts", 0))
        lu = data.get("lockout_until")
        lockout_until = datetime.fromisoformat(lu) if lu else None
        return attempts, lockout_until
    except (json.JSONDecodeError, TypeError, ValueError):
        return 0, None


def _redis_key(key: str) -> str:
    return f"clockinn:login_attempts:{key}"


async def _get_redis():
    global _redis_client
    if not settings.REDIS_URL:
        return None
    if _redis_client is not None:
        return _redis_client
    import redis.asyncio as redis

    _redis_client = redis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
    )
    return _redis_client


async def close_login_attempts_redis() -> None:
    """Close Redis connection (call from app shutdown)."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.close()
        except Exception as e:
            logger.warning("Error closing Redis login_attempts client: %s", e)
        _redis_client = None


async def is_locked_out(
    normalized_email: str,
    client_ip: Optional[str] = None,
) -> tuple[bool, Optional[datetime]]:
    """
    Returns (is_locked, lockout_until).
    If lockout_until is in the past, state is cleared and returns (False, None).
    """
    if not settings.RATE_LIMIT_ENABLED:
        return False, None

    key = _storage_key(normalized_email, client_ip)
    r = await _get_redis()
    if r is None:
        return _memory_is_locked_out(key)

    rk = _redis_key(key)
    raw = await r.get(rk)
    attempts, lockout_until = _state_from_json(raw)

    if lockout_until is None:
        return False, None
    if _now_utc() >= lockout_until:
        await r.delete(rk)
        return False, None
    return True, lockout_until


async def record_failed_attempt(
    normalized_email: str,
    client_ip: Optional[str] = None,
) -> None:
    if not settings.RATE_LIMIT_ENABLED:
        return

    key = _storage_key(normalized_email, client_ip)
    r = await _get_redis()
    if r is None:
        _memory_record_failed(key)
        return

    rk = _redis_key(key)
    raw = await r.get(rk)
    attempts, lockout_until = _state_from_json(raw)

    # Expired lockout: reset counter
    if lockout_until is not None and _now_utc() >= lockout_until:
        attempts = 0
        lockout_until = None

    attempts += 1
    now = _now_utc()
    if attempts >= settings.LOGIN_ATTEMPTS_LIMIT:
        lockout_until = now + timedelta(minutes=settings.LOCKOUT_DURATION_MINUTES)
        logger.warning("Login lockout applied (redis) key=%s***", key[:8])
    else:
        lockout_until = None

    payload = _state_to_json(attempts, lockout_until)
    if lockout_until:
        ttl = max(60, int((lockout_until - now).total_seconds()) + 3600)
    else:
        # Pre-locked-out keys: expire idle brute-force counters (no lockout yet)
        ttl = max(60, settings.LOGIN_LOCKOUT_REDIS_ATTEMPT_TTL_SECONDS)
    await r.set(rk, payload, ex=ttl)


async def clear_attempts(
    normalized_email: str,
    client_ip: Optional[str] = None,
) -> None:
    key = _storage_key(normalized_email, client_ip)
    r = await _get_redis()
    if r is None:
        _memory_clear(key)
        return
    await r.delete(_redis_key(key))
