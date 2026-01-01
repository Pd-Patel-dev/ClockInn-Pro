#!/bin/bash
# Bash script to view ClockInn logs

TYPE=${1:-all}
LOG_DIR="logs/server"

if [ "$TYPE" = "docker" ]; then
    echo "Viewing Docker container logs..."
    docker-compose logs -f api
    exit 0
fi

if [ ! -d "$LOG_DIR" ]; then
    echo "Log directory not found. Logs may be in the container."
    echo "Use: docker-compose exec api cat /app/logs/app.log"
    exit 1
fi

case $TYPE in
    app)
        if [ -f "$LOG_DIR/app.log" ]; then
            tail -f "$LOG_DIR/app.log"
        else
            echo "app.log not found. Viewing from container..."
            docker-compose exec api tail -f /app/logs/app.log
        fi
        ;;
    error)
        if [ -f "$LOG_DIR/error.log" ]; then
            tail -f "$LOG_DIR/error.log"
        else
            echo "error.log not found. Viewing from container..."
            docker-compose exec api tail -f /app/logs/error.log
        fi
        ;;
    access)
        if [ -f "$LOG_DIR/access.log" ]; then
            tail -f "$LOG_DIR/access.log"
        else
            echo "access.log not found. Viewing from container..."
            docker-compose exec api tail -f /app/logs/access.log
        fi
        ;;
    all)
        echo "=== Application Logs ==="
        if [ -f "$LOG_DIR/app.log" ]; then
            tail -20 "$LOG_DIR/app.log"
        else
            echo "app.log not found"
        fi
        echo ""
        echo "=== Access Logs ==="
        if [ -f "$LOG_DIR/access.log" ]; then
            tail -20 "$LOG_DIR/access.log"
        else
            echo "access.log not found"
        fi
        echo ""
        echo "=== Error Logs ==="
        if [ -f "$LOG_DIR/error.log" ]; then
            tail -20 "$LOG_DIR/error.log"
        else
            echo "error.log not found (no errors)"
        fi
        ;;
    *)
        echo "Usage: $0 [app|error|access|all|docker]"
        exit 1
        ;;
esac

