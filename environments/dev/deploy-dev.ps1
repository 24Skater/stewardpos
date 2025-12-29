# Deploy to Development Environment (PowerShell)
# Run from environments/dev/ directory

Write-Host "🚀 Deploying to Development Environment..." -ForegroundColor Cyan

# Load environment variables
if (Test-Path .env.dev) {
    Get-Content .env.dev | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
} elseif (Test-Path ..\..\.env.dev.example) {
    Write-Host "⚠️  Warning: .env.dev not found. Copy from ../../.env.dev.example" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  Warning: .env.dev not found. Using defaults." -ForegroundColor Yellow
}

# Build and start services (reference root docker-compose.yml as base)
docker-compose -f ../../docker-compose.yml -f docker-compose.dev.yml build
docker-compose -f ../../docker-compose.yml -f docker-compose.dev.yml up -d

Write-Host "`n✅ Development environment deployed!" -ForegroundColor Green
Write-Host "`nServices:" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:8081" -ForegroundColor White
Write-Host "  Backend:  http://localhost:3002" -ForegroundColor White
Write-Host "  Database: localhost:5433" -ForegroundColor White
Write-Host "  MinIO:    http://localhost:9003" -ForegroundColor White

