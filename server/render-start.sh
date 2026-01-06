#!/bin/bash
# Render startup script for running migrations and starting the server

set -e  # Exit on error

# Change to server directory (handle both Render and local paths)
cd server 2>/dev/null || cd /app/server 2>/dev/null || pwd

# Run database migrations using Python script (better error handling)
echo "🚀 Running database migrations..."
if python run_migrations.py; then
    echo "✅ Migrations completed successfully"
else
    echo "⚠️  Migration had issues, check logs above"
    # Continue anyway - might already be migrated
fi

# Start the server
echo "🌐 Starting FastAPI server on port ${PORT:-8000}..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}



