# Backend Quick Start Guide

Get the Persona POS backend API running in 5 minutes.

---

## 🚀 Quick Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Create Environment File

```bash
# Copy example
cp .env.example .env
```

**Edit `.env` with minimum configuration:**

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# Database (choose one)
DB_ADAPTER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=persona_pos
DB_USER=postgres
DB_PASSWORD=your_password

# JWT (REQUIRED - generate a strong secret)
JWT_SECRET=your_very_long_secret_key_minimum_32_characters_here

# CORS
CORS_ORIGIN=http://localhost:8080
```

### 3. Start Development Server

```bash
npm run dev
```

✅ **Server running at:** `http://localhost:3000`

---

## 🧪 Test the API

### Health Check

```bash
curl http://localhost:3000/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 123.456,
  "environment": "development",
  "memory": {
    "used": 45,
    "total": 128
  }
}
```

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "1",
      "email": "admin@example.com",
      "name": "Admin User",
      "roleIds": ["admin-role-id"]
    }
  }
}
```

**Save the token** for authenticated requests!

### Get Session (Authenticated)

```bash
# Replace YOUR_TOKEN with the token from login
curl http://localhost:3000/api/auth/session \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Test Protected Endpoint

```bash
curl http://localhost:3000/api/products \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 📝 Available Scripts

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type checking
npm run typecheck

# Linting
npm run lint

# Database migrations (coming soon)
npm run migrate
```

---

## 🔐 Default Credentials

**For Development Only:**
- Email: `admin@example.com`
- Password: `admin123`

⚠️ **These are hardcoded for development. Will be replaced with database users in Phase 2.**

---

## 📚 API Endpoints

### Public Endpoints
- `GET /api/health` - Health check
- `GET /api/health/db` - Database health
- `POST /api/auth/login` - User login

### Protected Endpoints (Require JWT)
- `POST /api/auth/logout` - Logout
- `GET /api/auth/session` - Get session
- `POST /api/auth/refresh` - Refresh token
- `GET /api/products` - List products
- `GET /api/orders` - List orders
- `GET /api/customers` - List customers
- `GET /api/services` - List services
- `GET /api/admin/*` - Admin endpoints

---

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process or change PORT in .env
```

### JWT_SECRET Error

```
❌ Configuration validation failed:
  - jwt.secret: String must contain at least 32 character(s)
```

**Fix:** Set a longer `JWT_SECRET` in `.env`:
```env
JWT_SECRET=this_is_a_very_long_secret_key_for_jwt_tokens_minimum_32_chars
```

### Cannot Connect to Database

Currently, database operations are mocked. This will be fixed in Phase 2.

### Module Not Found

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

## 🎯 What Works Now

✅ **Working:**
- Express server with TypeScript
- JWT authentication (login, logout, session)
- Security middleware (Helmet, CORS, rate limiting)
- Error handling and logging
- Health check endpoints
- Request/response logging

⚠️ **Mock/Stub:**
- User data (hardcoded admin user)
- Product/order/customer endpoints (return empty arrays)
- Database operations (no actual DB connection)

❌ **Not Yet Implemented:**
- Database migrations
- Actual CRUD operations
- RBAC permission checking
- Email/SMS sending
- File uploads
- API documentation (Swagger)

---

## 📖 Next Steps

1. **Phase 2:** Database Implementation
   - PostgreSQL adapter
   - SQLite adapter
   - Migrations
   - Real CRUD operations

2. **Complete API Endpoints**
   - Add validation schemas
   - Implement business logic
   - Connect to database

3. **Add Tests**
   - Unit tests
   - Integration tests
   - E2E tests

---

## 💡 Tips

### Generate Strong JWT Secret

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# OpenSSL
openssl rand -hex 32
```

### Watch Logs

```bash
# Development logs in console
npm run dev

# Production logs to file (if configured)
tail -f logs/app.log
```

### Test with Postman

Import these endpoints into Postman:
1. Create new request: `POST http://localhost:3000/api/auth/login`
2. Set body to JSON: `{"email":"admin@example.com","password":"admin123"}`
3. Save the token from response
4. Add token to Authorization header for other requests

### VS Code Debugging

Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Backend",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["run", "dev"],
  "skipFiles": ["<node_internals>/**"],
  "cwd": "${workspaceFolder}/backend"
}
```

---

## 🔗 Resources

- [Backend README](backend/README.md) - Full documentation
- [ROADMAP.md](ROADMAP.md) - Development roadmap
- [PHASE1-PROGRESS.md](PHASE1-PROGRESS.md) - Current progress
- [Express.js Docs](https://expressjs.com/)
- [TypeScript Docs](https://www.typescriptlang.org/)

---

**Questions?** Check the [ROADMAP.md](ROADMAP.md) or create an issue on GitHub.

**Ready for Phase 2?** See [ROADMAP.md#phase-2-database-implementation](ROADMAP.md#phase-2-database-implementation)
