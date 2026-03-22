"""
Expose the FastAPI application as `app.main:app` for tests (`pytest`) and optional `uvicorn app.main:app`.

The canonical app factory lives in the server root `main.py`.
"""
from __future__ import annotations

import sys
from pathlib import Path

_server_root = Path(__file__).resolve().parent.parent
_root = str(_server_root)
if _root not in sys.path:
    sys.path.insert(0, _root)

from main import app  # noqa: E402

__all__ = ["app"]
