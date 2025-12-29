# 🚀 Setup stewardPOS in Docker Desktop - RIGHT NOW

## Quick Setup (Copy & Paste)

### 1. Create .env File

Run this in PowerShell from the project root:

```powershell
@"
POSTGRES_DB=stewardpos
POSTGRES_USER=stewardpos_user
POSTGRES_PASSWORD=stewardpos123
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
DB_NAME=stewardpos
DB_USER=stewardpos_user
DB_PASSWORD=stewardpos123
JWT_SECRET=stewardpos-jwt-secret-key-minimum-32-characters-long-for-production-use
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:8080,http://localhost:3001
BACKEND_PORT=3001
VITE_API_BASE_URL=http://localhost:3001
AUTO_SEED=true
"@ | Out-File -FilePath .env -Encoding utf8
```

### 2. Build Docker Images

```powershell
docker-compose build
```

**This will take 5-10 minutes on first run** (downloading base images and dependencies)

### 3. Start All Services

```powershell
docker-compose up -d
```

### 4. Check Status

```powershell
docker-compose ps
```

Wait until all services show "healthy" or "running" (may take 30-60 seconds)

### 5. View Logs (Optional)

```powershell
docker-compose logs -f
```

Press `Ctrl+C` to stop watching logs

### 6. Access the Application

Open your browser:
- **Frontend:** http://localhost:8080
- **Backend Health:** http://localhost:3001/api/health

### 7. Login

- **Email:** admin@demo.local
- **Password:** DemoPass!1

## ✅ That's It!

If you see any errors, check the troubleshooting section below.

## 🔧 Quick Troubleshooting

### Build Failed?

```powershell
# Check what failed
docker-compose logs

# Try rebuilding just the failed service
docker-compose build backend
docker-compose build frontend
```

### Services Won't Start?

```powershell
# Check logs
docker-compose logs backend
docker-compose logs postgres

# Restart everything
docker-compose down
docker-compose up -d
```

### Port Already in Use?

Change the ports in `docker-compose.yml` or stop the conflicting service.

## 📞 Need Help?

1. Check `DOCKER-SETUP.md` for detailed instructions
2. Check `QUICK-START-DOCKER.md` for more troubleshooting
3. View logs: `docker-compose logs -f`

