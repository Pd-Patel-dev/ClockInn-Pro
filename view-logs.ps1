# PowerShell script to view ClockInn logs

param(
    [Parameter(Position=0)]
    [ValidateSet("app", "error", "access", "all", "docker")]
    [string]$Type = "all"
)

$logDir = "logs\server"

if ($Type -eq "docker") {
    Write-Host "Viewing Docker container logs..." -ForegroundColor Cyan
    docker-compose logs -f api
    exit
}

if (-not (Test-Path $logDir)) {
    Write-Host "Log directory not found. Logs may be in the container." -ForegroundColor Yellow
    Write-Host "Use: docker-compose exec api cat /app/logs/app.log" -ForegroundColor Yellow
    exit
}

switch ($Type) {
    "app" {
        if (Test-Path "$logDir\app.log") {
            Get-Content "$logDir\app.log" -Tail 50 -Wait
        } else {
            Write-Host "app.log not found. Viewing from container..." -ForegroundColor Yellow
            docker-compose exec api tail -f /app/logs/app.log
        }
    }
    "error" {
        if (Test-Path "$logDir\error.log") {
            Get-Content "$logDir\error.log" -Tail 50 -Wait
        } else {
            Write-Host "error.log not found. Viewing from container..." -ForegroundColor Yellow
            docker-compose exec api tail -f /app/logs/error.log
        }
    }
    "access" {
        if (Test-Path "$logDir\access.log") {
            Get-Content "$logDir\access.log" -Tail 50 -Wait
        } else {
            Write-Host "access.log not found. Viewing from container..." -ForegroundColor Yellow
            docker-compose exec api tail -f /app/logs/access.log
        }
    }
    "all" {
        Write-Host "=== Application Logs ===" -ForegroundColor Cyan
        if (Test-Path "$logDir\app.log") {
            Get-Content "$logDir\app.log" -Tail 20
        } else {
            Write-Host "app.log not found" -ForegroundColor Yellow
        }
        Write-Host "`n=== Access Logs ===" -ForegroundColor Cyan
        if (Test-Path "$logDir\access.log") {
            Get-Content "$logDir\access.log" -Tail 20
        } else {
            Write-Host "access.log not found" -ForegroundColor Yellow
        }
        Write-Host "`n=== Error Logs ===" -ForegroundColor Cyan
        if (Test-Path "$logDir\error.log") {
            Get-Content "$logDir\error.log" -Tail 20
        } else {
            Write-Host "error.log not found (no errors)" -ForegroundColor Green
        }
    }
}

