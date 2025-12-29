# Production Environment

This directory contains the production environment configuration.

## Files

- `docker-compose.prod.yml` - Docker Compose overrides for production
- `deploy-prod.sh` - Linux/Mac deployment script
- `deploy-prod.ps1` - Windows PowerShell deployment script
- `.env.prod` - Environment variables (create from `.env.prod.example` in root)

## Quick Start

1. Copy environment template from root:
   ```bash
   cp ../.env.prod.example .env.prod
   ```

2. **CRITICAL**: Edit `.env.prod` with STRONG, UNIQUE values:
   - Generate JWT_SECRET: `openssl rand -base64 32`
   - Use strong passwords (min 32 characters)
   - Set CORS_ORIGIN to your production domain
   - Configure email/SMS providers
   - Set up external storage (S3, Azure, etc.)

3. Deploy:
   ```bash
   # Linux/Mac
   ./deploy-prod.sh
   
   # Windows
   .\deploy-prod.ps1
   ```

## Security Checklist

- [ ] JWT_SECRET is 32+ characters
- [ ] All passwords are strong (32+ characters)
- [ ] CORS_ORIGIN set to production domain only
- [ ] AUTO_SEED=false
- [ ] LOG_LEVEL=warn
- [ ] Email provider configured
- [ ] External storage configured
- [ ] SSL/TLS certificates configured
- [ ] Backups configured
- [ ] Monitoring set up

## Usage

Deploy from this directory:
```bash
docker-compose -f ../../docker-compose.yml -f docker-compose.prod.yml up -d
```

Or use the deployment scripts which handle this automatically.

## Important Notes

- **Never** commit `.env.prod` to version control
- Use managed database services in production (AWS RDS, Azure Database, etc.)
- Use external S3-compatible storage (AWS S3, DigitalOcean Spaces, etc.)
- Set up proper monitoring and alerting
- Configure regular backups

