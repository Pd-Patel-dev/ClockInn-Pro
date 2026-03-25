"""
Global API rate limiting by client IP (sliding ~60s window).

- **In-memory** (default): per-process deques; not shared across workers/instances.
- **Redis** (when ``REDIS_URL`` is set): shared sliding-window counts across replicas (same URL as login lockout).

Trust ``X-Forwarded-For`` / ``X-Real-IP`` only behind a trusted reverse proxy.
"""
from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Deque, Dict, Tuple

from fastapi import Request, Response, status
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60.0

# Per-IP sliding windows: timestamps (monotonic) of allowed requests — in-memory fallback
_global_window: Dict[str, Deque[float]] = defaultdict(deque)
_strict_window: Dict[str, Deque[float]] = defaultdict(deque)

# Lazy async Redis for shared rate limits (same client pattern as login_attempts)
_redis_rl_client: Any = None

# Atomic: prune window, reject if at limit, else zadd + expire (global + optional strict bucket)
_SLIDING_RL_LUA = """
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local glob_limit = tonumber(ARGV[3])
local strict_limit = tonumber(ARGV[4])
local is_strict = tonumber(ARGV[5])
local member = ARGV[6]

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local gc = redis.call('ZCARD', KEYS[1])
if gc >= glob_limit then
  return 2
end

if is_strict == 1 then
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - window)
  local sc = redis.call('ZCARD', KEYS[2])
  if sc >= strict_limit then
    return 3
  end
end

redis.call('ZADD', KEYS[1], now, member)
redis.call('EXPIRE', KEYS[1], math.floor(window) + 30)
if is_strict == 1 then
  redis.call('ZADD', KEYS[2], now, member)
  redis.call('EXPIRE', KEYS[2], math.floor(window) + 30)
end
return 1
"""


def _redis_key_ip(client_ip: str) -> str:
    safe = (client_ip or "unknown").replace(":", "_").replace("/", "_").replace(" ", "")[:200]
    return safe


def get_client_ip(request: Request) -> str:
    """Client IP for rate limiting. Prefer proxy headers when present."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _prune_old(q: Deque[float], now: float) -> None:
    cutoff = now - WINDOW_SECONDS
    while q and q[0] < cutoff:
        q.popleft()


def _is_exempt_path(path: str) -> bool:
    if path.startswith("/api/v1/health"):
        if path.startswith("/api/v1/health/test-error"):
            return False
        return True
    if path in ("/docs", "/openapi.json", "/redoc"):
        return True
    return False


def _is_strict_path(path: str) -> bool:
    return path.startswith("/api/v1/auth") or path.startswith("/api/v1/kiosk")


def check_rate_limit(client_ip: str, path: str) -> Tuple[bool, str]:
    """
    In-memory check. Returns (allowed, reason_if_blocked).
    Used when REDIS_URL is unset and by unit tests.
    """
    if not settings.RATE_LIMIT_ENABLED:
        return True, ""

    if _is_exempt_path(path):
        return True, ""

    now = time.monotonic()
    global_limit = max(1, settings.RATE_LIMIT_PER_MINUTE)
    strict_limit = max(1, settings.RATE_LIMIT_AUTH_KIOSK_PER_MINUTE)
    strict = _is_strict_path(path)

    gq = _global_window[client_ip]
    _prune_old(gq, now)
    if len(gq) >= global_limit:
        logger.warning("Rate limit exceeded (global) ip=%s path=%s", client_ip, path)
        return False, "global"

    if strict:
        sq = _strict_window[client_ip]
        _prune_old(sq, now)
        if len(sq) >= strict_limit:
            logger.warning("Rate limit exceeded (auth/kiosk) ip=%s path=%s", client_ip, path)
            return False, "strict"

    gq.append(now)
    if strict:
        _strict_window[client_ip].append(now)

    return True, ""


async def _get_rate_limit_redis():
    global _redis_rl_client
    if not settings.REDIS_URL:
        return None
    if _redis_rl_client is not None:
        return _redis_rl_client
    import redis.asyncio as redis

    _redis_rl_client = redis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )
    return _redis_rl_client


async def close_rate_limit_redis() -> None:
    global _redis_rl_client
    if _redis_rl_client is not None:
        try:
            await _redis_rl_client.aclose()
        except Exception as e:
            logger.warning("rate_limit Redis close: %s", e)
        _redis_rl_client = None


async def check_rate_limit_async(client_ip: str, path: str) -> Tuple[bool, str]:
    """
    Rate limit for middleware. Uses Redis sliding window when REDIS_URL is set; otherwise in-memory ``check_rate_limit``.
    """
    if not settings.RATE_LIMIT_ENABLED:
        return True, ""

    if _is_exempt_path(path):
        return True, ""

    redis_client = await _get_rate_limit_redis()
    if redis_client is None:
        return check_rate_limit(client_ip, path)

    global_limit = max(1, settings.RATE_LIMIT_PER_MINUTE)
    strict_limit = max(1, settings.RATE_LIMIT_AUTH_KIOSK_PER_MINUTE)
    strict = _is_strict_path(path)
    is_strict = 1 if strict else 0
    now = time.time()
    member = str(uuid.uuid4())
    ipk = _redis_key_ip(client_ip)
    gkey = f"clockinn:ratelimit:global:{ipk}"
    skey = f"clockinn:ratelimit:strict:{ipk}"
    key2 = skey if strict else gkey

    try:
        rc = await redis_client.eval(
            _SLIDING_RL_LUA,
            2,
            gkey,
            key2,
            str(now),
            str(int(WINDOW_SECONDS)),
            str(global_limit),
            str(strict_limit),
            str(is_strict),
            member,
        )
    except Exception as e:
        logger.warning("Redis rate limit failed, falling back to in-memory: %s", e)
        return check_rate_limit(client_ip, path)

    if rc == 1:
        return True, ""
    if rc == 2:
        logger.warning("Rate limit exceeded (global, Redis) ip=%s path=%s", client_ip, path)
        return False, "global"
    if rc == 3:
        logger.warning("Rate limit exceeded (auth/kiosk, Redis) ip=%s path=%s", client_ip, path)
        return False, "strict"
    return True, ""


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        client_ip = get_client_ip(request)

        allowed, _ = await check_rate_limit_async(client_ip, path)
        if not allowed:
            return Response(
                content='{"detail":"Too many requests. Please try again later."}',
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                media_type="application/json",
                headers={"Retry-After": str(int(WINDOW_SECONDS))},
            )

        return await call_next(request)
