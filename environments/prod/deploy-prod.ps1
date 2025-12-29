# Deploy to Production Environment (PowerShell)
# IMPORTANT: Review all settings before running!
# Run from environments/prod/ directory

Write-Host "🚨 PRODUCTION DEPLOYMENT" -ForegroundColor Red
Write-Host "⚠️  Make sure you have:" -ForegroundColor Yellow
Write-Host "   1. Strong passwords in .env.prod" -ForegroundColor White
Write-Host "   2. JWT_SECRET set (min 32 characters)" -ForegroundColor White
Write-Host "   3. CORS_ORIGIN set to your production domain" -ForegroundColor White
Write-Host "   4. Reviewed all security settings" -ForegroundColor White
Write-Host ""

$confirm = Read-Host "Continue with production deployment? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "❌ Deployment cancelled." -ForegroundColor Red
    exit 1
}

# Load environment variables
if (Test-Path .env.prod) {
    Get-Content .env.prod | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
} elseif (Test-Path ..\..\.env.prod.example) {
    Write-Host "❌ Error: .env.prod not found!" -ForegroundColor Red
    Write-Host "   Copy ../../.env.prod.example to .env.prod and configure it." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "❌ Error: .env.prod not found!" -ForegroundColor Red
    Write-Host "   Create .env.prod with production settings." -ForegroundColor Yellow
    exit 1
}

# Validate critical settings
$jwtSecret = [System.Environment]::GetEnvironmentVariable('JWT_SECRET', 'Process')
if ([string]::IsNullOrEmpty($jwtSecret) -or $jwtSecret.Length -lt 32) {
    Write-Host "❌ Error: JWT_SECRET must be at least 32 characters!" -ForegroundColor Red
    exit 1
}

$corsOrigin = [System.Environment]::GetEnvironmentVariable('CORS_ORIGIN', 'Process')
if ([string]::IsNullOrEmpty($corsOrigin)) {
    Write-Host "❌ Error: CORS_ORIGIN must be set!" -ForegroundColor Red
    exit 1
}

# Build and start services (reference root docker-compose.yml as base)
Write-Host "🔨 Building production images..." -ForegroundColor Cyan
docker-compose -f ../../docker-compose.yml -f docker-compose.prod.yml build

Write-Host "🚀 Starting production services..." -ForegroundColor Cyan
docker-compose -f ../../docker-compose.yml -f docker-compose.prod.yml up -d

Write-Host "`n✅ Production environment deployed!" -ForegroundColor Green
Write-Host "`n⚠️  Next steps:" -ForegroundColor Yellow
Write-Host "   1. Verify all services are running: docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps" -ForegroundColor White
Write-Host "   2. Check logs: docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f" -ForegroundColor White
Write-Host "   3. Test the application endpoints" -ForegroundColor White
Write-Host "   4. Set up monitoring and backups" -ForegroundColor White

