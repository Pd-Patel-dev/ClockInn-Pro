@echo off
REM Script to run migrations locally on Windows
REM Usage: run_migrations_local.bat [DATABASE_URL]
REM Or set DATABASE_URL environment variable before running

if "%DATABASE_URL%"=="" (
    if not "%~1"=="" (
        set DATABASE_URL=%~1
    ) else (
        echo ❌ Error: DATABASE_URL not set!
        echo.
        echo Usage:
        echo   set DATABASE_URL=postgresql://user:pass@host:5432/dbname
        echo   python run_migrations.py
        echo.
        echo Or:
        echo   run_migrations_local.bat "postgresql://user:pass@host:5432/dbname"
        echo.
        echo Get your DATABASE_URL from:
        echo   1. Render Dashboard -^> Your Service -^> Environment -^> DATABASE_URL
        echo   2. Supabase Dashboard -^> Settings -^> Database -^> Connection string
        exit /b 1
    )
)

echo Running migrations with database: %DATABASE_URL:~0,30%...
python run_migrations.py

