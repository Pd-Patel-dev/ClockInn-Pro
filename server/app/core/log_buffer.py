"""
In-memory ring buffer for live developer log viewing.

Note: each uvicorn worker process has its own buffer (fine for single-process /
small deployments). Multi-worker setups will not share live lines across workers.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import traceback
from collections import deque
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Deque, Dict, List, Optional, Set

CAPACITY = 2000

LEVEL_ORDER = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "ERROR": 40,
    "CRITICAL": 50,
}


def _utc_iso_ms(created: float | None = None) -> str:
    if created is not None:
        dt = datetime.fromtimestamp(created, tz=timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(dt.microsecond / 1000):03d}Z"


def record_to_entry(record: logging.LogRecord) -> Dict[str, Any]:
    """Convert a LogRecord into the API/SSE payload shape."""
    level = record.levelname
    logger_name = record.name
    message = record.getMessage()

    if record.exc_info:
        try:
            parts = traceback.format_exception(*record.exc_info)
            flat = " ↳ ".join(p.strip().replace("\n", " ↳ ") for p in parts if p.strip())
            if flat:
                message = f"{message} ↳ {flat}"
        except Exception:
            pass

    skip = {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "message",
        "asctime",
        "taskName",
    }
    extras: List[str] = []
    for key, value in record.__dict__.items():
        if key in skip or key.startswith("_"):
            continue
        if value is None:
            continue
        extras.append(f"{key}={value}")
    if extras:
        message = f"{message} {' '.join(extras)}"

    ts = _utc_iso_ms(getattr(record, "created", None))
    raw = f"{ts} {level:<8} {logger_name} {message}"
    return {
        "timestamp": ts,
        "level": level,
        "logger": logger_name,
        "message": message,
        "raw": raw,
    }


def _matches(
    entry: Dict[str, Any],
    levels: Optional[Set[str]] = None,
    q: Optional[str] = None,
) -> bool:
    if levels:
        if entry.get("level", "").upper() not in levels:
            return False
    if q and q.strip():
        needle = q.strip().lower()
        hay = f"{entry.get('raw', '')} {entry.get('message', '')} {entry.get('logger', '')}".lower()
        if needle not in hay:
            return False
    return True


def parse_levels_param(level: Optional[str]) -> Optional[Set[str]]:
    """Parse `level` query: single name, comma list, or `INFO+` style min level."""
    if not level or not level.strip():
        return None
    raw = level.strip().upper()
    if raw.endswith("+"):
        base = raw[:-1]
        min_no = LEVEL_ORDER.get(base)
        if min_no is None:
            return {base} if base else None
        return {name for name, no in LEVEL_ORDER.items() if no >= min_no}
    parts = {p.strip().upper() for p in raw.split(",") if p.strip()}
    return parts or None


class LogRingBuffer:
    """Thread-safe ring buffer of recent log entries."""

    def __init__(self, capacity: int = CAPACITY) -> None:
        self._capacity = capacity
        self._buf: Deque[Dict[str, Any]] = deque(maxlen=capacity)
        self._lock = threading.Lock()
        self._seq = 0
        self._condition = threading.Condition(self._lock)

    def append(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        with self._condition:
            self._seq += 1
            stored = {**entry, "seq": self._seq}
            self._buf.append(stored)
            self._condition.notify_all()
            return stored

    def get_recent(
        self,
        limit: int = 500,
        levels: Optional[Set[str]] = None,
        q: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit), 2000))
        with self._lock:
            items = list(self._buf)
        matched = [e for e in items if _matches(e, levels, q)]
        return matched[-limit:]

    def get_since(
        self,
        after_seq: int,
        levels: Optional[Set[str]] = None,
        q: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        with self._lock:
            items = [e for e in self._buf if e.get("seq", 0) > after_seq]
        return [e for e in items if _matches(e, levels, q)]

    def wait_for_new(self, after_seq: int, timeout: float = 1.0) -> int:
        with self._condition:
            if self._seq > after_seq:
                return self._seq
            self._condition.wait(timeout=timeout)
            return self._seq

    @property
    def seq(self) -> int:
        with self._lock:
            return self._seq

    async def subscribe(
        self,
        levels: Optional[Set[str]] = None,
        q: Optional[str] = None,
        after_seq: Optional[int] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        last = after_seq if after_seq is not None else self.seq
        loop = asyncio.get_running_loop()
        while True:
            new_items = self.get_since(last, levels, q)
            if new_items:
                for item in new_items:
                    last = max(last, int(item.get("seq", last)))
                    yield item
                continue
            await loop.run_in_executor(None, self.wait_for_new, last, 1.0)


class RingBufferHandler(logging.Handler):
    def __init__(self, buffer: LogRingBuffer) -> None:
        super().__init__()
        self.buffer = buffer

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = record_to_entry(record)
            self.buffer.append(entry)
        except Exception:
            self.handleError(record)


log_buffer = LogRingBuffer(CAPACITY)
