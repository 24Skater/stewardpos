# Persona POS Backend API

Production-ready backend API for Persona POS with PostgreSQL and SQLite support.

## 🎯 Status

- ✅ **Phase 1**: Backend API Foundation (Complete)
- ✅ **Phase 2**: Database Implementation (Complete)
- 🔄 **Phase 3**: Installation & Deployment (In Progress)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ (optional, SQLite works out of the box)

### Installation (5 minutes)

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env

# Setup database (migrations + seed data)
npm run setup-db

# Start development server
npm run dev
```

The API will be available at `http://localhost:3001`

**Default Admin:**
- Email: `admin@example.com`
- Password: `admin123`

📖 **See [PHASE2-QUICKSTART.md](./PHASE2-QUICKSTART.md) for detailed setup and API examples**

## 📝 Environment Variables

See `.env.example` for all available configuration options.

**Required:**
- `JWT_SECRET` - JWT signing secret (minimum 32 characters)
- `DB_ADAPTER` - Database adapter (`postgres` or `sqlite`)
- Database connection details

## 🛠️ Development

```bash
# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type checking
npm run typecheck

# Linting
npm run lint
```

## 📚 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/session` - Get current session
- `POST /api/auth/refresh` - Refresh token

### Products
- `GET /api/products` - List products
- `GET /api/products/:id` - Get product
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Orders
- `GET /api/orders` - List orders
- `GET /api/orders/:id` - Get order
- `POST /api/orders` - Create order

### Customers
- `GET /api/customers` - List customers
- `POST /api/customers` - Create customer

### Services
- `GET /api/services` - List services

### Admin
- `GET /api/admin/users` - List users
- `GET /api/admin/roles` - List roles
- `GET /api/admin/settings` - Get settings
- `GET /api/admin/audit` - Audit logs

### Health
- `GET /api/health` - Health check
- `GET /api/health/db` - Database health

## 🔐 Authentication

All endpoints (except `/api/health` and `/api/auth/login`) require JWT authentication.

**Example:**
```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Use token in subsequent requests
curl http://localhost:3000/api/products \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 🗄️ Database

### PostgreSQL

```bash
# Create database
createdb persona_pos

# Run migrations
npm run migrate
```

### SQLite

```bash
# Database file will be created automatically
npm run migrate
```

## 📦 Project Structure

```
backend/
├── src/
│   ├── api/
│   │   ├── routes/          # API route handlers
│   │   └── middleware/      # Express middleware
│   ├── config/              # Configuration
│   ├── services/            # Business logic
│   ├── adapters/            # Database/email/storage adapters
│   ├── utils/               # Utilities
│   └── server.ts            # Express app
├── dist/                    # Compiled JavaScript
├── package.json
└── tsconfig.json
```

## 🧪 Testing

```bash
# Run tests (coming soon)
npm test
```

## 🚢 Deployment

### Production Build

```bash
npm run build
npm start
```

### Environment Variables

Set these in production:
- `NODE_ENV=production`
- `JWT_SECRET` - Strong random secret
- Database credentials
- Email/SMS credentials (if using)

### Docker

```bash
docker build -t persona-pos-backend .
docker run -p 3000:3000 --env-file .env persona-pos-backend
```

## 📖 Documentation

- [Full Roadmap](../ROADMAP.md)
- [Installation Guide](../INSTALL.md)
- [Configuration Guide](../CONFIGURATION.md)

## 🤝 Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md)

## 📄 License

MIT License - see [LICENSE](../LICENSE)
