# Development Environment

This directory contains the development environment configuration.

## Files

- `docker-compose.dev.yml` - Docker Compose overrides for development
- `deploy-dev.sh` - Linux/Mac deployment script
- `deploy-dev.ps1` - Windows PowerShell deployment script
- `.env.dev` - Environment variables (create from `.env.dev.example` in root)

## Quick Start

1. Copy environment template from root:
   ```bash
   cp ../.env.dev.example .env.dev
   ```

2. Deploy:
   ```bash
   # Linux/Mac
   ./deploy-dev.sh
   
   # Windows
   .\deploy-dev.ps1
   ```

## Access

- Frontend: http://localhost:8081
- Backend: http://localhost:3002
- Database: localhost:5433
- MinIO Console: http://localhost:9003

## Usage

Deploy from this directory:
```bash
docker-compose -f ../../docker-compose.yml -f docker-compose.dev.yml up -d
```

Or use the deployment scripts which handle this automatically.

