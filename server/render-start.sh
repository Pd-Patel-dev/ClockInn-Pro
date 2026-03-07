#!/usr/bin/env bash
# Start script for Render (and similar). Runs migrations if RUN_MIGRATIONS=true, then starts the API.
set -e
cd "$(dirname "$0")"

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  echo "Running database migrations..."
  alembic upgrade head
  echo "Migrations complete."
fi

echo "Starting API..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
