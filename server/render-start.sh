#!/bin/bash
# Render startup script for running migrations and starting the server

set -e  # Exit on error

# Run database migrations
echo "Running database migrations..."
if alembic upgrade head; then
    echo "✅ Migrations completed successfully"
else
    echo "❌ Migration failed, but continuing..."
    # Don't exit - let the server start anyway for debugging
fi

# Start the server
echo "Starting FastAPI server..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}



