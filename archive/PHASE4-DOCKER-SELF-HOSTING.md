# PHASE 4 — DOCKER & SELF-HOSTING

**Generated:** 2025-01-27  
**Project:** stewardPOS (Persona POS)  
**Status:** Docker Plan Complete

**Based on:** Current stack analysis (PostgreSQL, Express, React, MinIO)

---

## DOCKER ARCHITECTURE

### Container Model: **Multi-Container with Reverse Proxy**

**Rationale:**
- Frontend and backend are separate services
- Database and storage are separate services
- Nginx as reverse proxy unifies entry point
- Each service can scale independently

### Container Breakdown

```
┌─────────────────────────────────────────────────────────┐
│                    Nginx (Reverse Proxy)                │
│  Port: 80 (HTTP), 443 (HTTPS)                          │
│  Routes: /api/* → backend, /* → frontend                │
└─────────────────────────────────────────────────────────┘
         │                    │
         │                    │
    ┌────▼────┐         ┌─────▼─────┐
    │ Backend │         │ Frontend  │
    │ Express │         │  React    │
    │ :3001   │         │  Static   │
    └────┬────┘         └───────────┘
         │
    ┌────▼────┐    ┌──────────┐
    │PostgreSQL│    │  MinIO   │
    │  :5432   │    │ :9000/01 │
    └──────────┘    └──────────┘
```

---

## DOCKERFILE SPECIFICATIONS

### 1. Frontend Dockerfile (EXISTS - Needs Review)

**Current:** `Dockerfile` (root)

**Analysis:**
- ✅ Multi-stage build (good)
- ✅ Uses node:20-alpine (good)
- ✅ Nginx Alpine (good)
- ✅ Health check (good)
- ⚠️ No non-root user (security concern)
- ⚠️ No build-time env var validation

**Recommended Improvements:**

```dockerfile
# Frontend Dockerfile (Improved)
# Stage 1: Builder
FROM node:20-alpine AS builder

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies as root (needed for npm)
RUN npm ci --only=production=false

# Copy source code
COPY . .

# Change ownership to non-root user
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Build (as non-root)
RUN npm run build

# Stage 2: Production
FROM nginx:1.25-alpine

# Remove default nginx user, create new one
RUN deluser nginx && \
    addgroup -g 1001 -S nginx && \
    adduser -S nginx -u 1001 -G nginx

# Copy built assets from builder
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

# Switch to non-root user
USER nginx

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
```

### 2. Backend Dockerfile (NEW - To Create)

**Location:** `backend/Dockerfile`

```dockerfile
# Backend Dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Stage 2: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Set NODE_ENV
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy migrations (needed at runtime)
COPY --chown=nodejs:nodejs migrations ./migrations

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/server.js"]
```

**Key Features:**
- ✅ Multi-stage build (smaller image)
- ✅ Non-root user
- ✅ Production dependencies only
- ✅ Health check
- ✅ Migrations included

---

## DOCKER COMPOSE CONFIGURATION

### Complete docker-compose.yml

```yaml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:16-alpine
    container_name: stewardpos-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-stewardpos}
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
      POSTGRES_INITDB_ARGS: "-E UTF8 --locale=C"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "${DB_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks:
      - stewardpos-network
    # Security: Run as postgres user (non-root)
    user: "999:999"

  # MinIO (S3-compatible storage)
  minio:
    image: minio/minio:latest
    container_name: stewardpos-storage
    restart: unless-stopped
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    ports:
      - "${MINIO_API_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
      start_period: 30s
    networks:
      - stewardpos-network
    # Security: MinIO runs as non-root by default

  # Backend API
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: stewardpos-backend
    restart: unless-stopped
    environment:
      # Server
      NODE_ENV: production
      PORT: 3001
      HOST: 0.0.0.0
      
      # Database
      DB_ADAPTER: postgres
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-stewardpos}
      DB_USER: ${DB_USER:-postgres}
      DB_PASSWORD: ${DB_PASSWORD:-postgres}
      
      # JWT
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-7d}
      
      # CORS
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost}
      
      # Rate Limiting
      RATE_LIMIT_WINDOW_MS: ${RATE_LIMIT_WINDOW_MS:-900000}
      RATE_LIMIT_MAX_REQUESTS: ${RATE_LIMIT_MAX_REQUESTS:-100}
      
      # Logging
      LOG_LEVEL: ${LOG_LEVEL:-info}
      LOG_FILE: ${LOG_FILE:-/app/logs/app.log}
    volumes:
      - backend_logs:/app/logs
    ports:
      - "${BACKEND_PORT:-3001}:3001"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - stewardpos-network
    # Security: Runs as non-root user (nodejs:1001)

  # Frontend Application
  frontend:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        - VITE_API_BASE_URL=${VITE_API_BASE_URL:-http://localhost/api}
    container_name: stewardpos-frontend
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT:-8080}:80"
    depends_on:
      - backend
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    networks:
      - stewardpos-network
    # Security: Runs as non-root user (nginx:1001)

  # Nginx Reverse Proxy (Optional - for unified entry point)
  nginx:
    image: nginx:1.25-alpine
    container_name: stewardpos-proxy
    restart: unless-stopped
    volumes:
      - ./nginx-proxy.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "${HTTP_PORT:-80}:80"
      - "${HTTPS_PORT:-443}:443"
    depends_on:
      - frontend
      - backend
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 3s
      retries: 3
    networks:
      - stewardpos-network
    # Security: Runs as nginx user (non-root)

volumes:
  postgres_data:
    driver: local
  minio_data:
    driver: local
  backend_logs:
    driver: local

networks:
  stewardpos-network:
    driver: bridge
    name: stewardpos-network
```

### Nginx Reverse Proxy Configuration

**File:** `nginx-proxy.conf` (NEW)

```nginx
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server backend:3001;
    }

    upstream frontend {
        server frontend:80;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general_limit:10m rate=50r/s;

    server {
        listen 80;
        server_name _;

        # Security headers
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # API routes → Backend
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;
            
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            
            # Timeouts
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # Health check
        location /health {
            access_log off;
            proxy_pass http://backend/api/health;
        }

        # Frontend routes → Frontend
        location / {
            limit_req zone=general_limit burst=50 nodelay;
            
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

---

## ENVIRONMENT VARIABLES

### .env.example (Root)

```bash
# =============================================================================
# StewardPOS Environment Configuration
# =============================================================================
# Copy this file to .env and update with your values
# DO NOT commit .env to version control

# -----------------------------------------------------------------------------
# Application
# -----------------------------------------------------------------------------
APP_ENV=production
APP_NAME=StewardPOS

# -----------------------------------------------------------------------------
# Frontend
# -----------------------------------------------------------------------------
VITE_API_BASE_URL=http://localhost/api
FRONTEND_PORT=8080

# -----------------------------------------------------------------------------
# Backend
# -----------------------------------------------------------------------------
BACKEND_PORT=3001
NODE_ENV=production

# -----------------------------------------------------------------------------
# Database (PostgreSQL)
# -----------------------------------------------------------------------------
DB_ADAPTER=postgres
DB_HOST=postgres
DB_PORT=5432
DB_NAME=stewardpos
DB_USER=postgres
DB_PASSWORD=CHANGE_THIS_STRONG_PASSWORD

# -----------------------------------------------------------------------------
# JWT Authentication
# -----------------------------------------------------------------------------
# Generate with: openssl rand -base64 32
JWT_SECRET=CHANGE_THIS_MIN_32_CHARACTERS_SECRET
JWT_EXPIRES_IN=7d

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ORIGIN=http://localhost,https://yourdomain.com

# -----------------------------------------------------------------------------
# Rate Limiting
# -----------------------------------------------------------------------------
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
LOG_LEVEL=info
LOG_FILE=/app/logs/app.log

# -----------------------------------------------------------------------------
# Storage (MinIO)
# -----------------------------------------------------------------------------
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=CHANGE_THIS_MINIO_PASSWORD

# -----------------------------------------------------------------------------
# Network
# -----------------------------------------------------------------------------
HTTP_PORT=80
HTTPS_PORT=443
```

### .env.example (Backend)

```bash
# Backend-specific environment variables
# Most are set in docker-compose.yml, but can be overridden here

NODE_ENV=production
PORT=3001
HOST=0.0.0.0

DB_ADAPTER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=stewardpos
DB_USER=postgres
DB_PASSWORD=postgres

JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
JWT_EXPIRES_IN=7d

CORS_ORIGIN=http://localhost:8080

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

LOG_LEVEL=info
LOG_FILE=./logs/app.log
```

---

## VOLUMES & PERSISTENCE STRATEGY

### Volume Configuration

```yaml
volumes:
  postgres_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./data/postgres  # For local development
  minio_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./data/minio  # For local development
  backend_logs:
    driver: local
```

### Production Volume Strategy

**Option A: Named Volumes (Docker Managed)**
- ✅ Simple, Docker handles location
- ✅ Easy backup (docker volume commands)
- ⚠️ Less control over location

**Option B: Bind Mounts (Host Paths)**
- ✅ Full control over location
- ✅ Easy access from host
- ⚠️ Permission issues possible
- ⚠️ Path must exist

**Recommendation:** Use named volumes for production, bind mounts for development

### Backup Strategy

**PostgreSQL Backup:**
```bash
# Backup script
#!/bin/bash
docker exec stewardpos-db pg_dump -U postgres stewardpos > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore script
#!/bin/bash
cat backup_*.sql | docker exec -i stewardpos-db psql -U postgres stewardpos
```

**MinIO Backup:**
```bash
# Backup script (using mc - MinIO client)
docker exec stewardpos-storage mc mirror /data /backup
```

---

## HEALTHCHECKS

### Health Check Strategy

**All Services:**
- ✅ Interval: 30s
- ✅ Timeout: 3-10s
- ✅ Retries: 3
- ✅ Start period: 5-30s (depending on service)

**Service-Specific:**

1. **PostgreSQL:**
   ```yaml
   test: ["CMD-SHELL", "pg_isready -U postgres"]
   ```

2. **MinIO:**
   ```yaml
   test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
   ```

3. **Backend:**
   ```yaml
   test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
   ```

4. **Frontend:**
   ```yaml
   test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/"]
   ```

5. **Nginx:**
   ```yaml
   test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
   ```

---

## STARTUP ORDER & DEPENDENCY READINESS

### Dependency Chain

```
1. PostgreSQL (no dependencies)
   └─> Health check: pg_isready

2. MinIO (no dependencies)
   └─> Health check: HTTP endpoint

3. Backend (depends on PostgreSQL)
   └─> Waits for: postgres.condition: service_healthy
   └─> Health check: /api/health

4. Frontend (depends on Backend)
   └─> Waits for: backend (no health check, just startup)
   └─> Health check: HTTP endpoint

5. Nginx (depends on Frontend + Backend)
   └─> Waits for: frontend, backend (no health checks)
   └─> Health check: /health endpoint
```

### Startup Script

**File:** `scripts/start.sh` (NEW)

```bash
#!/bin/bash
set -e

echo "Starting StewardPOS..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found. Copy .env.example to .env and configure it."
    exit 1
fi

# Check for required environment variables
if [ -z "$JWT_SECRET" ]; then
    echo "Error: JWT_SECRET not set in .env"
    exit 1
fi

# Start services
echo "Starting Docker Compose services..."
docker-compose up -d

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
docker-compose ps

echo "StewardPOS is starting. Check logs with: docker-compose logs -f"
```

---

## PRODUCTION GUIDANCE

### Security Checklist

- [ ] Change all default passwords
- [ ] Use strong JWT_SECRET (32+ characters)
- [ ] Enable HTTPS (SSL/TLS certificates)
- [ ] Configure firewall rules
- [ ] Use non-root containers (✅ implemented)
- [ ] Regular security updates
- [ ] Backup strategy in place
- [ ] Monitor logs for suspicious activity

### SSL/TLS Setup

**Option A: Let's Encrypt (Recommended)**
```yaml
# Add to docker-compose.yml
services:
  certbot:
    image: certbot/certbot
    volumes:
      - ./certs:/etc/letsencrypt
    # ... certbot configuration
```

**Option B: Self-Signed (Development)**
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ./certs/key.pem \
  -out ./certs/cert.pem
```

### Resource Limits

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### Monitoring

**Recommended Tools:**
- **Prometheus** - Metrics collection
- **Grafana** - Visualization
- **Loki** - Log aggregation
- **Alertmanager** - Alerting

**Basic Monitoring:**
```yaml
# Add to docker-compose.yml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
```

---

## SELF-HOSTING DEPLOYMENT

### Prerequisites

1. **Server Requirements:**
   - 2+ CPU cores
   - 2GB+ RAM
   - 10GB+ disk space
   - Docker & Docker Compose installed

2. **Network:**
   - Port 80 (HTTP) open
   - Port 443 (HTTPS) open (recommended)
   - Port 5432 (PostgreSQL) - internal only

### Deployment Steps

1. **Clone Repository:**
   ```bash
   git clone https://github.com/yourorg/stewardpos.git
   cd stewardpos
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Generate Secrets:**
   ```bash
   # Generate JWT secret
   openssl rand -base64 32

   # Generate database password
   openssl rand -base64 24
   ```

4. **Start Services:**
   ```bash
   docker-compose up -d
   ```

5. **Run Migrations:**
   ```bash
   docker-compose exec backend npm run migrate
   ```

6. **Seed Database (Optional):**
   ```bash
   docker-compose exec backend npm run seed
   ```

7. **Verify:**
   ```bash
   curl http://localhost/api/health
   ```

### Maintenance

**View Logs:**
```bash
docker-compose logs -f [service-name]
```

**Restart Services:**
```bash
docker-compose restart [service-name]
```

**Update Application:**
```bash
git pull
docker-compose build
docker-compose up -d
```

**Backup Database:**
```bash
./scripts/backup-db.sh
```

---

## END OF PHASE 4

**Next Steps:** Proceed to Phase 5 (Best Practices Review)

**Status:** ✅ Docker & self-hosting plan complete. Ready for best practices review.

