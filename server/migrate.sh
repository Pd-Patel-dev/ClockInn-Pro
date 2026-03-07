#!/usr/bin/env bash
# Run Alembic migrations (use from project root or server directory).
# Requires DATABASE_URL in .env (project root or server folder).

set -e
cd "$(dirname "$0")"
if [ ! -f "alembic.ini" ]; then
  echo "ERROR: Run from server directory. alembic.ini not found."
  exit 1
fi
echo "Running migrations..."
python -m alembic upgrade head
echo "Migrations complete."
