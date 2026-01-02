#!/bin/bash
# Render startup script for running migrations and starting the server

set -e  # Exit on error

# Change to server directory
cd /app/server || cd server

# Run database migrations using Python script (better error handling)
echo "Running database migrations..."
if python run_migrations.py; then
    echo "✅ Migrations completed successfully"
else
    echo "⚠️  Migration had issues, check logs above"
    # Continue anyway - might already be migrated
fi

# Start the server
echo "Starting FastAPI server..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}



