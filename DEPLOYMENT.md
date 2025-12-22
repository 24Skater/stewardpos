# Multi-Environment Deployment Guide

This guide explains how to deploy stewardPOS to Development, QA/Staging, and Production environments.

## Overview

The application supports three environments:
- **DEV** - Development environment for local development and testing
- **QA** - QA/Staging environment for pre-production testing
- **PROD** - Production environment for live deployment

Each environment uses separate:
- Docker Compose configurations
- Environment variable files
- Database instances
- Port mappings
- Resource limits

## Quick Start

### Development Environment

```bash
# 1. Copy environment template
cp .env.dev.example .env.dev

# 2. Edit .env.dev with your settings (optional, defaults work for dev)

# 3. Deploy
./scripts/deploy-dev.sh        # Linux/Mac
# OR
.\scripts\deploy-dev.ps1       # Windows PowerShell
```

**Access:**
- Frontend: http://localhost:8081
- Backend: http://localhost:3002
- Database: localhost:5433
- MinIO Console: http://localhost:9003

### QA/Staging Environment

```bash
# 1. Copy environment template
cp .env.qa.example .env.qa

# 2. Edit .env.qa with your QA settings
#    - Update database credentials
#    - Set CORS_ORIGIN to your QA domain
#    - Configure JWT_SECRET

# 3. Deploy
./scripts/deploy-qa.sh         # Linux/Mac
# OR
.\scripts\deploy-qa.ps1        # Windows PowerShell
```

**Access:**
- Frontend: http://localhost:8082
- Backend: http://localhost:3003
- Database: localhost:5434
- MinIO Console: http://localhost:9005

### Production Environment

```bash
# 1. Copy environment template
cp .env.prod.example .env.prod

# 2. Edit .env.prod with STRONG, UNIQUE values
#    - Generate strong passwords (min 32 characters)
#    - Set JWT_SECRET (use: openssl rand -base64 32)
#    - Configure CORS_ORIGIN to your production domain
#    - Set up email/SMS providers
#    - Configure external storage (S3, Azure, etc.)

# 3. Review security settings
#    - Verify AUTO_SEED=false
#    - Check LOG_LEVEL=warn
#    - Confirm rate limiting settings

# 4. Deploy
./scripts/deploy-prod.sh       # Linux/Mac
# OR
.\scripts\deploy-prod.ps1      # Windows PowerShell
```

**Access:**
- Frontend: Configured via FRONTEND_PORT (default: 80)
- Backend: Configured via BACKEND_PORT (default: 3001)
- Database: Configured via DB_HOST/DB_PORT
- MinIO: Configured via ports 9000/9001

## Manual Deployment

If you prefer manual deployment:

### Development
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### QA
```bash
docker-compose -f docker-compose.yml -f docker-compose.qa.yml up -d
```

### Production
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Environment Configuration

### Port Mappings

| Service | DEV | QA | PROD |
|---------|-----|-----|------|
| Frontend | 8081 | 8082 | 80 (configurable) |
| Backend | 3002 | 3003 | 3001 (configurable) |
| Database | 5433 | 5434 | 5432 (configurable) |
| MinIO API | 9002 | 9004 | 9000 |
| MinIO Console | 9003 | 9005 | 9001 |

### Environment Variables

Each environment has its own `.env` file:
- `.env.dev` - Development settings
- `.env.qa` - QA/Staging settings
- `.env.prod` - Production settings

**Important:** Never commit `.env.prod` to version control!

### Key Differences

| Setting | DEV | QA | PROD |
|---------|-----|-----|------|
| NODE_ENV | development | production | production |
| LOG_LEVEL | debug | info | warn |
| AUTO_SEED | true | false | false |
| Rate Limit | 1000/10min | 200/15min | 100/15min |
| CORS | Localhost | QA domain | Production domain |
| Resource Limits | None | None | CPU/Memory limits |

## Database Management

### Development
- Auto-seeds with demo data
- Uses local Docker volume
- Port exposed for debugging

### QA
- No auto-seed
- Uses local Docker volume
- Port exposed for testing

### Production
- **Never** auto-seeds
- Consider using managed database (AWS RDS, Azure Database)
- Port should be internal-only (remove port mapping)

## Storage Configuration

### Development/QA
- Uses MinIO in Docker
- Local volumes for data

### Production
- **Recommended:** Use external S3-compatible storage
  - AWS S3
  - DigitalOcean Spaces
  - Azure Blob Storage
  - Google Cloud Storage
- Update `STORAGE_*` environment variables accordingly

## Security Checklist

### Before Production Deployment

- [ ] Strong, unique passwords (min 32 characters)
- [ ] JWT_SECRET generated securely (`openssl rand -base64 32`)
- [ ] CORS_ORIGIN set to production domain only
- [ ] AUTO_SEED=false
- [ ] LOG_LEVEL=warn (less verbose)
- [ ] Rate limiting configured appropriately
- [ ] Database credentials are strong
- [ ] Storage credentials are secure
- [ ] Email/SMS providers configured
- [ ] SSL/TLS certificates configured (via reverse proxy)
- [ ] Firewall rules configured
- [ ] Backups configured
- [ ] Monitoring set up

## Monitoring and Maintenance

### Check Service Status
```bash
# Development
docker-compose -f docker-compose.yml -f docker-compose.dev.yml ps

# QA
docker-compose -f docker-compose.yml -f docker-compose.qa.yml ps

# Production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

### View Logs
```bash
# Development
docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

# QA
docker-compose -f docker-compose.yml -f docker-compose.qa.yml logs -f

# Production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

### Update Services
```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose -f docker-compose.yml -f docker-compose.{env}.yml build
docker-compose -f docker-compose.yml -f docker-compose.{env}.yml up -d
```

## Troubleshooting

### Services Won't Start
1. Check logs: `docker-compose logs [service-name]`
2. Verify environment variables are set correctly
3. Check port conflicts
4. Verify database connectivity

### Database Connection Issues
1. Check database is running: `docker-compose ps postgres`
2. Verify credentials in `.env` file
3. Check network connectivity
4. Review database logs

### Frontend Can't Connect to Backend
1. Verify `VITE_API_BASE_URL` is correct
2. Check CORS settings in backend
3. Verify backend is running and healthy
4. Check firewall/network rules

## Best Practices

1. **Separate Environments**: Never share databases or storage between environments
2. **Strong Secrets**: Use strong, unique secrets for each environment
3. **Version Control**: Never commit `.env.prod` or production secrets
4. **Backups**: Set up regular backups for production database
5. **Monitoring**: Use monitoring tools (Prometheus, Grafana, etc.)
6. **Updates**: Test updates in DEV/QA before deploying to PROD
7. **Documentation**: Keep deployment notes and changes documented

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Environment Variables Best Practices](./PHASE5-BEST-PRACTICES.md)
- [Security Guidelines](./SECURITY.md)

