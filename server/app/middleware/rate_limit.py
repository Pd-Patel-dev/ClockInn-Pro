"""
Global API rate limiting by client IP (sliding 60s window).

- In-memory only; not shared across workers/instances (see SECURITY_REVIEW).
- Trust X-Forwarded-For / X-Real-IP only when placed behind a trusted reverse proxy
  that sets them (use first X-Forwarded-For hop = client).
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import Request, Response, status
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60.0

# Per-IP sliding windows: timestamps (monotonic) of allowed requests
_global_window: Dict[str, Deque[float]] = defaultdict(deque)
_strict_window: Dict[str, Deque[float]] = defaultdict(deque)


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
        # Liveness/readiness for orchestration — do not throttle
        if path.startswith("/api/v1/health/test-error"):
            return False
        return True
    if path in ("/docs", "/openapi.json", "/redoc"):
        return True
    return False


def _is_strict_path(path: str) -> bool:
    return path.startswith("/api/v1/auth") or path.startswith("/api/v1/kiosk")


def check_rate_limit(client_ip: str, path: str) -> tuple[bool, str]:
    """
    Returns (allowed, reason_if_blocked).
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


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # CORS preflight must not count against API quotas
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        client_ip = get_client_ip(request)

        allowed, _ = check_rate_limit(client_ip, path)
        if not allowed:
            return Response(
                content='{"detail":"Too many requests. Please try again later."}',
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                media_type="application/json",
                headers={"Retry-After": str(int(WINDOW_SECONDS))},
            )

        return await call_next(request)
