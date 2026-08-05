# Demo/Quick Start Guide

This is a simplified Docker setup for quick demos and local development.

## Quick Start

1. **Start the demo environment:**
   ```bash
   docker-compose -f docker-compose.demo.yml up -d
   ```

2. **Access the application:**
   - Frontend: http://localhost:8080
   - Backend API: http://localhost:3001
   - MinIO Console: http://localhost:9001 (minioadmin / minioadmin123)
   - Database: localhost:5432

3. **Default credentials:**
   - Email: `admin@demo.local`
   - Password: `DemoPass!1`

## What's Included

- PostgreSQL database (auto-seeded with demo data)
- MinIO storage (S3-compatible)
- Backend API
- Frontend application

## Environment Variables

You can override defaults by creating a `.env` file:

```env
POSTGRES_PASSWORD=your_password
JWT_SECRET=your_jwt_secret_min_32_characters
CORS_ORIGIN=http://localhost:8080
VITE_API_BASE_URL=http://localhost:3001
```

## Stopping the Demo

```bash
docker-compose -f docker-compose.demo.yml down
```

To also remove volumes (deletes all data):
```bash
docker-compose -f docker-compose.demo.yml down -v
```

## For Production Use

This demo setup is **NOT** suitable for production. For production deployments, use the environment-specific configurations:

- **Development**: See `environments/dev/`
- **QA/Staging**: See `environments/qa/`
- **Production**: See `environments/prod/`

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full deployment guide.

