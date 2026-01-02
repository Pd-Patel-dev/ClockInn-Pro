#!/bin/bash
# Script to run migrations locally
# Usage: ./run_migrations_local.sh [DATABASE_URL]
# Or set DATABASE_URL environment variable before running

if [ -z "$DATABASE_URL" ]; then
    if [ -n "$1" ]; then
        export DATABASE_URL="$1"
    else
        echo "❌ Error: DATABASE_URL not set!"
        echo ""
        echo "Usage:"
        echo "  export DATABASE_URL='postgresql://user:pass@host:5432/dbname'"
        echo "  python run_migrations.py"
        echo ""
        echo "Or:"
        echo "  ./run_migrations_local.sh 'postgresql://user:pass@host:5432/dbname'"
        echo ""
        echo "Get your DATABASE_URL from:"
        echo "  1. Render Dashboard -> Your Service -> Environment -> DATABASE_URL"
        echo "  2. Supabase Dashboard -> Settings -> Database -> Connection string"
        exit 1
    fi
fi

echo "Running migrations with database: ${DATABASE_URL:0:30}..."
python run_migrations.py

