import logging
import sys
import traceback
from pathlib import Path
from logging.handlers import RotatingFileHandler

from app.core.log_buffer import RingBufferHandler, log_buffer

# Create logs directory if it doesn't exist
LOG_DIR = Path(__file__).parent.parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)


class StructuredFormatter(logging.Formatter):
    """Single-line: `{timestamp} {level:<8} {logger} {message}` (+ flattened traceback)."""

    def formatException(self, ei) -> str:
        parts = traceback.format_exception(*ei)
        return " ↳ ".join(p.strip().replace("\n", " ↳ ") for p in parts if p.strip())

    def format(self, record: logging.LogRecord) -> str:
        # ISO-ish timestamp with milliseconds
        from datetime import datetime, timezone

        dt = datetime.fromtimestamp(record.created, tz=timezone.utc)
        ts = dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(dt.microsecond / 1000):03d}Z"
        level = f"{record.levelname:<8}"
        msg = record.getMessage()
        if record.exc_info:
            try:
                msg = f"{msg} ↳ {self.formatException(record.exc_info)}"
            except Exception:
                pass
        return f"{ts} {level} {record.name} {msg}"


def setup_logging():
    """Configure application logging (stdout + files + in-memory ring buffer)."""
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.handlers.clear()

    structured = StructuredFormatter()

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(structured)
    root_logger.addHandler(console_handler)

    app_log_file = LOG_DIR / "app.log"
    file_handler = RotatingFileHandler(
        app_log_file,
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(structured)
    root_logger.addHandler(file_handler)

    error_log_file = LOG_DIR / "error.log"
    error_handler = RotatingFileHandler(
        error_log_file,
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(structured)
    root_logger.addHandler(error_handler)

    # Live developer console buffer (also receives access logger below)
    buffer_handler = RingBufferHandler(log_buffer)
    buffer_handler.setLevel(logging.DEBUG)
    root_logger.addHandler(buffer_handler)

    access_log_file = LOG_DIR / "access.log"
    access_handler = RotatingFileHandler(
        access_log_file,
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
    )
    access_handler.setLevel(logging.INFO)
    access_handler.setFormatter(structured)

    access_logger = logging.getLogger("access")
    access_logger.setLevel(logging.INFO)
    access_logger.handlers.clear()
    access_logger.addHandler(access_handler)
    access_logger.addHandler(buffer_handler)
    access_logger.propagate = False

    sqlalchemy_logger = logging.getLogger("sqlalchemy.engine")
    sqlalchemy_logger.setLevel(logging.WARNING)

    return root_logger
