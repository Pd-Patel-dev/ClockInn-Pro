@echo off
REM Development server startup script with hot reload
REM For local development on Windows

cd /d "%~dp0"

echo Starting FastAPI development server with hot reload...
echo Watching for changes in: app/
echo Server will automatically reload on file changes
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo Python not found. Please install Python 3.11 or later.
    exit /b 1
)

REM Run with reload enabled
python run_dev.py

