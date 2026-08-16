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

## How the Frontend Finds the Backend

The frontend reaches the API two different ways, and `VITE_API_BASE_URL` is what
switches between them.

| Mode | `VITE_API_BASE_URL` | How requests resolve |
|------|---------------------|----------------------|
| Local dev (`npm run dev`) | leave empty | The app issues same-origin `/api/...` requests. Vite's dev server proxies `/api` and `/uploads` to the backend (default `http://localhost:3002`). |
| Docker / built bundle | absolute URL, e.g. `http://localhost:3002` | Baked into the bundle at build time; requests go straight to that origin, and backend `CORS_ORIGIN` must allow the frontend's origin. |

Because Vite inlines `VITE_*` variables during `vite build`, the value is fixed
when the image is built — changing it later requires a rebuild, not a restart.

Override the dev proxy target with `VITE_DEV_API_PROXY_TARGET` if the backend is
not on port 3002 (for example, when pointing the dev UI at the QA backend on
3003). `/uploads` is proxied alongside `/api` because uploaded logos and icons
are stored as relative URLs.

## Environment Differences

| Setting | DEV | QA | PROD |
|---------|-----|-----|------|
| NODE_ENV | development | production | production |
| LOG_LEVEL | debug | info | info |
| AUTO_SEED | true | false | false |
| RATE_LIMIT_MAX_REQUESTS | 3000 | 3000 | 3000 |
| RATE_LIMIT_MAX_LOGIN_ATTEMPTS | 10 | 10 | 10 |
| TRUST_PROXY | 1 | 1 | 1 |

**The rate limit is not "stricter in production".** This table used to say
100 per 15 minutes there, which is what the compose files shipped. Measured
against the running app, opening the register costs about 24 API calls and each
sale adds about 3 — and every terminal in a shop shares one public IP. That is
roughly 25 sales per quarter-hour for an entire store before 429s begin.
Brute force is bounded separately by `RATE_LIMIT_MAX_LOGIN_ATTEMPTS`, which
counts failures only; that is what "stricter" should mean.

`TRUST_PROXY` must equal the number of reverse proxies actually in front of the
API. Too low and every client shares one bucket, because they all appear to come
from the proxy. Too high and a forged `X-Forwarded-For` walks straight past the
limits. The production stack puts exactly one (Caddy) in front of the backend.

## Logging

| Variable | Default | Notes |
|----------|---------|-------|
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `LOG_FILE` | unset | Omit to log to stdout only |
| `LOG_MAX_SIZE_MB` | `20` | Size at which the file rotates |
| `LOG_MAX_FILES` | `5` | How many are kept |

Total on disk is `LOG_MAX_SIZE_MB × LOG_MAX_FILES` — 100 MB by default. Before
these existed the file had no bound at all and grew for the life of the install.

## Security Checklist (Production)

- [ ] JWT_SECRET is 32+ characters and generated, not edited (`openssl rand -base64 32`)
- [ ] All passwords are strong and generated
- [ ] CORS_ORIGIN set to the production domain only
- [ ] AUTO_SEED=false
- [ ] TRUST_PROXY matches the number of proxies in front of the API

The first three are enforced: the backend **refuses to start** in production if
`JWT_SECRET`, `DB_PASSWORD` or `MINIO_SECRET_KEY` is one of the placeholders
this repository ships. A skipped line fails loudly at boot rather than quietly
for the life of the install.
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

See [DEPLOYMENT.md](../guides/deployment.md) for complete deployment guide.

