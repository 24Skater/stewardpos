# QA/Staging Environment

This directory contains the QA/Staging environment configuration.

## Files

- `docker-compose.qa.yml` - Docker Compose overrides for QA
- `deploy-qa.sh` - Linux/Mac deployment script
- `deploy-qa.ps1` - Windows PowerShell deployment script
- `.env.qa` - Environment variables (create from `.env.qa.example` in root)

## Quick Start

1. Copy environment template from root:
   ```bash
   cp ../.env.qa.example .env.qa
   ```

2. Edit `.env.qa` with your QA settings:
   - Update database credentials
   - Set CORS_ORIGIN to your QA domain
   - Configure JWT_SECRET (min 32 characters)

3. Deploy:
   ```bash
   # Linux/Mac
   ./deploy-qa.sh
   
   # Windows
   .\deploy-qa.ps1
   ```

## Access

- Frontend: http://localhost:8082
- Backend: http://localhost:3003
- Database: localhost:5434
- MinIO Console: http://localhost:9005

## Usage

Deploy from this directory:
```bash
docker-compose -f ../../docker-compose.yml -f docker-compose.qa.yml up -d
```

Or use the deployment scripts which handle this automatically.

