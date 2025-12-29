# Docker Setup Guide for stewardPOS

This guide will help you set up and run stewardPOS using Docker Desktop.

## Prerequisites

- ✅ Docker Desktop installed and running
- ✅ At least 4GB of available RAM
- ✅ Ports 3001, 5432, 8080, 9000, 9001 available

## Quick Start

### Step 1: Create Environment File

Create a `.env` file in the root directory with the following content:

```bash
# Database Configuration
POSTGRES_DB=stewardpos
POSTGRES_USER=stewardpos_user
POSTGRES_PASSWORD=stewardpos_secure_password_123

# MinIO Storage
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123

# Backend Configuration
DB_NAME=stewardpos
DB_USER=stewardpos_user
DB_PASSWORD=stewardpos_secure_password_123
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long-change-this
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:8080,http://localhost:3001
BACKEND_PORT=3001

# Frontend Configuration
VITE_API_BASE_URL=http://localhost:3001
```

**⚠️ IMPORTANT:** 
- Change all passwords before deploying to production
- Generate a secure JWT_SECRET (minimum 32 characters)
- You can generate a secure JWT_SECRET using: `openssl rand -base64 32`

### Step 2: Build and Start Services

Open a terminal in the project root and run:

```bash
# Build all Docker images
docker-compose build

# Start all services
docker-compose up -d

# Check service status
docker-compose ps
```

### Step 3: Initialize Database

The backend needs to run migrations and seed initial data:

```bash
# Run migrations
docker-compose exec backend npm run migrate

# Seed initial data (optional - creates admin user)
docker-compose exec backend npm run seed
```

### Step 4: Access the Application

- **Frontend:** http://localhost:8080
- **Backend API:** http://localhost:3001
- **MinIO Console:** http://localhost:9001 (login with MINIO_ROOT_USER/MINIO_ROOT_PASSWORD)
- **PostgreSQL:** localhost:5432

### Default Admin Credentials

After seeding:
- **Email:** admin@demo.local
- **Password:** DemoPass!1

## Useful Commands

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres
```

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v
```

### Restart Services

```bash
# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart backend
```

### Rebuild After Code Changes

```bash
# Rebuild and restart
docker-compose up -d --build
```

### Access Container Shell

```bash
# Backend container
docker-compose exec backend sh

# PostgreSQL container
docker-compose exec postgres psql -U stewardpos_user -d stewardpos
```

## Troubleshooting

### Port Already in Use

If you get "port already in use" errors:

1. Check what's using the port:
   ```bash
   # Windows PowerShell
   netstat -ano | findstr :3001
   netstat -ano | findstr :8080
   ```

2. Either stop the conflicting service or change ports in `docker-compose.yml`

### Backend Won't Start

1. Check backend logs:
   ```bash
   docker-compose logs backend
   ```

2. Verify database is healthy:
   ```bash
   docker-compose ps postgres
   ```

3. Check if migrations ran:
   ```bash
   docker-compose exec backend npm run migrate
   ```

### Frontend Can't Connect to Backend

1. Verify backend is running:
   ```bash
   curl http://localhost:3001/api/health
   ```

2. Check CORS_ORIGIN in `.env` includes your frontend URL

3. Verify VITE_API_BASE_URL in `.env` matches backend URL

### Database Connection Issues

1. Verify PostgreSQL is healthy:
   ```bash
   docker-compose ps postgres
   ```

2. Check database credentials in `.env` match docker-compose.yml

3. Try connecting manually:
   ```bash
   docker-compose exec postgres psql -U stewardpos_user -d stewardpos
   ```

## Health Checks

Verify all services are healthy:

```bash
# Check all services
docker-compose ps

# Test backend health endpoint
curl http://localhost:3001/api/health

# Test frontend (should return HTML)
curl http://localhost:8080
```

## Next Steps

1. ✅ All services running
2. ✅ Database initialized
3. ✅ Access frontend at http://localhost:8080
4. ✅ Login with admin credentials
5. ✅ Start using the application!

## Production Deployment

For production deployment:

1. **Change all default passwords** in `.env`
2. **Generate secure JWT_SECRET**: `openssl rand -base64 32`
3. **Use environment-specific .env files**
4. **Set up SSL/TLS** (use reverse proxy like Traefik or Nginx)
5. **Configure proper CORS_ORIGIN** for your domain
6. **Set up database backups**
7. **Configure log rotation**
8. **Use Docker secrets** for sensitive data

## Support

If you encounter issues:
1. Check the logs: `docker-compose logs`
2. Verify all prerequisites are met
3. Check the troubleshooting section above
4. Review the main README.md for more information

