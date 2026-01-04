#!/bin/bash
# Development server startup script with hot reload
# For local development on Linux/macOS

cd "$(dirname "$0")" || exit 1

# Check if Python is available
if ! command -v python &> /dev/null && ! command -v python3 &> /dev/null; then
    echo "❌ Python not found. Please install Python 3.11 or later."
    exit 1
fi

# Use python3 if available, otherwise python
PYTHON_CMD=$(command -v python3 || command -v python)

# Make sure we're in the right directory
if [ ! -f "main.py" ]; then
    echo "❌ Error: main.py not found. Make sure you're in the server directory."
    exit 1
fi

# Run with reload enabled
$PYTHON_CMD run_dev.py

