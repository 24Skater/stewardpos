# Deploy to QA/Staging Environment (PowerShell)
# Run from environments/qa/ directory

Write-Host "🚀 Deploying to QA/Staging Environment..." -ForegroundColor Cyan

# Load environment variables
if (Test-Path .env.qa) {
    Get-Content .env.qa | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
} elseif (Test-Path ..\..\.env.qa.example) {
    Write-Host "⚠️  Warning: .env.qa not found. Copy from ../../.env.qa.example" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  Warning: .env.qa not found. Using defaults." -ForegroundColor Yellow
}

# Build and start services (reference root docker-compose.yml as base)
docker-compose -f ../../docker-compose.yml -f docker-compose.qa.yml build
docker-compose -f ../../docker-compose.yml -f docker-compose.qa.yml up -d

Write-Host "`n✅ QA/Staging environment deployed!" -ForegroundColor Green
Write-Host "`nServices:" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:8082" -ForegroundColor White
Write-Host "  Backend:  http://localhost:3003" -ForegroundColor White
Write-Host "  Database: localhost:5434" -ForegroundColor White
Write-Host "  MinIO:    http://localhost:9005" -ForegroundColor White

