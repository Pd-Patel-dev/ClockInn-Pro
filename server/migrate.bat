@echo off
REM Run Alembic migrations (use from project root or server directory).
REM Requires DATABASE_URL in .env (project root or server folder).

cd /d "%~dp0"
if not exist "alembic.ini" (
  echo ERROR: Run from server directory. alembic.ini not found.
  exit /b 1
)
echo Running migrations...
python -m alembic upgrade head
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
echo Migrations complete.
