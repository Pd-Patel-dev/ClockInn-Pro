#!/bin/bash
# Script to run migrations on deployed backend
# Usage: ./scripts/deploy_migrations.sh

set -e

echo "🚀 Starting database migrations..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set"
    exit 1
fi

# Run migrations
echo "📦 Running Alembic migrations..."
alembic upgrade head

echo "✅ Migrations completed successfully!"


