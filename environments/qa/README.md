# QA / Staging Environment

Compose overrides for QA. The base stack lives in the repository root; this
directory only holds what differs.

## Files

- `docker-compose.qa.yml` — Docker Compose overrides for QA
- `.env.qa` — environment variables, gitignored. Start from `.env.example` in the root

The deployment scripts live in `scripts/` at the repository root, not here.
There used to be a second copy in this directory; the two had drifted apart, so
the root pair is now the only one.

## Quick start

Run from the **repository root**:

```bash
cp .env.example .env.qa
```

Then edit `.env.qa`:

- update the database credentials
- set `CORS_ORIGIN` to your QA domain
- set `JWT_SECRET` to at least 32 characters

```bash
./scripts/deploy-qa.sh       # Linux/Mac
.\scripts\deploy-qa.ps1      # Windows
```

Or drive Compose directly, also from the root:

```bash
docker-compose -f docker-compose.yml -f environments/qa/docker-compose.qa.yml up -d
```

## Access

- Frontend: http://localhost:8082
- Backend: http://localhost:3003
- Database: localhost:5434
- MinIO Console: http://localhost:9005
