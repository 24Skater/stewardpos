# Environment Setup Quick Reference

## Quick Start

### 1. Development Environment

```bash
# Copy the example file
cp .env.dev.example .env.dev

# Edit if needed (defaults work for local dev)
# Then deploy:
./scripts/deploy-dev.sh        # Linux/Mac
.\scripts\deploy-dev.ps1       # Windows
```

**Access:**
- Frontend: http://localhost:8081
- Backend: http://localhost:3002
- Database: localhost:5433

### 2. QA/Staging Environment

```bash
# Copy the example file
cp .env.qa.example .env.qa

# Edit with your QA settings:
# - Update database credentials
# - Set CORS_ORIGIN to your QA domain
# - Configure JWT_SECRET (min 32 chars)

# Then deploy:
./scripts/deploy-qa.sh         # Linux/Mac
.\scripts\deploy-qa.ps1        # Windows
```

**Access:**
- Frontend: http://localhost:8082
- Backend: http://localhost:3003
- Database: localhost:5434

### 3. Production Environment

```bash
# Copy the example file
cp .env.prod.example .env.prod

# CRITICAL: Edit with STRONG, UNIQUE values:
# - Generate JWT_SECRET: openssl rand -base64 32
# - Use strong passwords (min 32 characters)
# - Set CORS_ORIGIN to your production domain
# - Configure email/SMS providers
# - Set up external storage (S3, Azure, etc.)

# Then deploy:
./scripts/deploy-prod.sh       # Linux/Mac
.\scripts\deploy-prod.ps1      # Windows
```

## Port Summary

| Service | DEV | QA | PROD |
|---------|-----|-----|------|
| Frontend | 8081 | 8082 | 80 |
| Backend | 3002 | 3003 | 3001 |
| Database | 5433 | 5434 | 5432 |
| MinIO API | 9002 | 9004 | 9000 |
| MinIO Console | 9003 | 9005 | 9001 |

## Environment Differences

| Setting | DEV | QA | PROD |
|---------|-----|-----|------|
| NODE_ENV | development | production | production |
| LOG_LEVEL | debug | info | warn |
| AUTO_SEED | true | false | false |
| Rate Limit | 1000/10min | 200/15min | 100/15min |

## Security Checklist (Production)

- [ ] JWT_SECRET is 32+ characters (use: `openssl rand -base64 32`)
- [ ] All passwords are strong (32+ characters)
- [ ] CORS_ORIGIN set to production domain only
- [ ] AUTO_SEED=false
- [ ] LOG_LEVEL=warn
- [ ] Email provider configured
- [ ] External storage configured (S3/Azure)
- [ ] SSL/TLS certificates configured
- [ ] Backups configured
- [ ] Monitoring set up

## Manual Commands

```bash
# Start environment
docker-compose -f docker-compose.yml -f docker-compose.{env}.yml up -d

# Stop environment
docker-compose -f docker-compose.yml -f docker-compose.{env}.yml down

# View logs
docker-compose -f docker-compose.yml -f docker-compose.{env}.yml logs -f

# Rebuild
docker-compose -f docker-compose.yml -f docker-compose.{env}.yml build
```

Replace `{env}` with `dev`, `qa`, or `prod`.

## Full Documentation

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete deployment guide.

