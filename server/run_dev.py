#!/usr/bin/env python
"""
Development server runner with auto-reload enabled.
Run this for local development to enable hot-reload on file changes.
"""
import uvicorn
import os
import sys
from pathlib import Path

if __name__ == "__main__":
    # Get the directory where this script is located
    script_dir = Path(__file__).parent.absolute()
    
    # Watch both app directory and root for changes to main.py, etc.
    reload_dirs = [
        str(script_dir / "app"),
        str(script_dir),  # Also watch root for main.py changes
    ]
    
    print("🚀 Starting FastAPI development server with hot reload...")
    print("📁 Watching directories:")
    for dir_path in reload_dirs:
        print(f"   - {dir_path}")
    print("🔄 Server will automatically reload when you save .py files")
    print("💡 Make a change to any Python file to test!")
    print()
    
    # Force reload to always be enabled and use WatchFiles (better for Windows)
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # Enable auto-reload
        reload_dirs=reload_dirs,  # Watch these directories for changes
        reload_includes=["*.py"],  # Watch these file patterns
        reload_excludes=["*.pyc", "__pycache__", "*.log", ".git", "venv", ".venv"],  # Exclude these
        reload_delay=0.25,  # Small delay to avoid multiple reloads
        log_level="info",
    )

