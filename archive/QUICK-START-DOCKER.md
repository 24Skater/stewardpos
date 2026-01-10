# Quick Start - Docker Desktop Setup

## 🚀 Fast Setup (5 minutes)

### Step 1: Create Environment File

Copy the example environment file:

```bash
# Windows PowerShell
Copy-Item docker-compose.env.example .env

# Or manually create .env with these values:
```

**Minimum .env file content:**
```bash
POSTGRES_DB=stewardpos
POSTGRES_USER=stewardpos_user
POSTGRES_PASSWORD=stewardpos_secure_password_123
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
DB_NAME=stewardpos
DB_USER=stewardpos_user
DB_PASSWORD=stewardpos_secure_password_123
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:8080,http://localhost:3001
BACKEND_PORT=3001
VITE_API_BASE_URL=http://localhost:3001
AUTO_SEED=true
```

### Step 2: Build and Start

```bash
# Build all images
docker-compose build

# Start all services
docker-compose up -d

# Watch logs
docker-compose logs -f
```

### Step 3: Wait for Services

Wait about 30-60 seconds for all services to start, then check status:

```bash
docker-compose ps
```

All services should show "healthy" or "running".

### Step 4: Access Application

- **Frontend:** http://localhost:8080
- **Backend API:** http://localhost:3001/api/health
- **MinIO Console:** http://localhost:9001

### Step 5: Login

Default admin credentials (after seeding):
- **Email:** admin@demo.local
- **Password:** DemoPass!1

## 🔧 Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs backend
docker-compose logs postgres

# Restart services
docker-compose restart
```

### Backend Can't Connect to Database

1. Verify PostgreSQL is healthy: `docker-compose ps postgres`
2. Check database credentials in `.env` match docker-compose.yml
3. Check backend logs: `docker-compose logs backend`

### Port Already in Use

If ports 3001, 5432, 8080, 9000, or 9001 are in use:

1. Find what's using the port:
   ```powershell
   netstat -ano | findstr :3001
   ```

2. Stop the conflicting service or change ports in `docker-compose.yml`

### Rebuild After Code Changes

```bash
docker-compose up -d --build
```

## 📋 Useful Commands

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v

# Restart a service
docker-compose restart backend

# Execute command in container
docker-compose exec backend sh
docker-compose exec postgres psql -U stewardpos_user -d stewardpos

# Check service health
docker-compose ps
```

## ✅ Verification Checklist

- [ ] Docker Desktop is running
- [ ] `.env` file created with all required variables
- [ ] `docker-compose build` completed successfully
- [ ] `docker-compose up -d` started all services
- [ ] All services show "healthy" in `docker-compose ps`
- [ ] Frontend accessible at http://localhost:8080
- [ ] Backend health check passes: http://localhost:3001/api/health
- [ ] Can login with admin credentials

## 🎉 You're Ready!

Once all services are healthy, open http://localhost:8080 in your browser and start using stewardPOS!

