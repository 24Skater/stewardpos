# Development Environment

Compose overrides for local development. The base stack lives in the repository
root; this directory only holds what differs.

## Files

- `docker-compose.dev.yml` — Docker Compose overrides for development
- `.env.dev` — environment variables, gitignored. Start from `.env.example` in the root

The deployment scripts live in `scripts/` at the repository root, not here.
There used to be a second copy in this directory; the two had drifted apart, so
the root pair is now the only one.

## Quick start

Run from the **repository root**:

```bash
cp .env.example .env.dev     # then edit it
./scripts/deploy-dev.sh      # Linux/Mac
.\scripts\deploy-dev.ps1     # Windows
```

Or drive Compose directly, also from the root:

```bash
docker-compose -f docker-compose.yml -f environments/dev/docker-compose.dev.yml up -d
```

## Access

- Frontend: http://localhost:8081
- Backend: http://localhost:3002
- Database: localhost:5433
- MinIO Console: http://localhost:9003
