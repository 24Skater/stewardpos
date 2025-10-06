# Phase 2 Quick Start Guide

## 🎯 What's New in Phase 2

Phase 2 adds a complete database layer with PostgreSQL and SQLite support, migrations, seed data, and full API integration.

## 🚀 Quick Setup (5 minutes)

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Database

**Option A: SQLite (Easiest - No setup required)**
```bash
cp .env.example .env
# Edit .env and set:
DB_ADAPTER=sqlite
DB_FILENAME=./data/persona-pos.db
```

**Option B: PostgreSQL (Recommended for production)**
```bash
# Start PostgreSQL (Docker)
docker run -d \
  --name persona-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=persona_pos \
  -p 5432:5432 \
  postgres:15

# Edit .env and set:
DB_ADAPTER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=persona_pos
DB_USER=postgres
DB_PASSWORD=postgres
```

### 3. Setup Database
```bash
npm run setup-db
```

This will:
- ✅ Run migrations (create all tables)
- ✅ Seed default data (roles, admin user, sample products)

### 4. Start Server
```bash
npm run dev
```

Server starts at: `http://localhost:3001`

## 🔐 Default Credentials

**Admin User:**
- Email: `admin@example.com`
- Password: `admin123`

⚠️ **Change this password in production!**

## 📡 Test the API

### 1. Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "...",
      "email": "admin@example.com",
      "name": "Admin User",
      "roleIds": ["..."],
      "roles": [...]
    }
  }
}
```

**Save the token for next requests!**

### 2. Get Products
```bash
curl http://localhost:3001/api/products \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 3. Create Product
```bash
curl -X POST http://localhost:3001/api/products \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Product",
    "description": "A test product",
    "category": "Electronics",
    "basePrice": 29.99,
    "variants": [
      {
        "size": "M",
        "color": "Blue",
        "stock": 10,
        "enabled": true
      }
    ]
  }'
```

### 4. Create Order
```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "productId": "PRODUCT_ID_HERE",
        "nameSnapshot": "Test Product",
        "quantity": 2,
        "unitPrice": 29.99,
        "lineTotal": 59.98
      }
    ],
    "subtotal": 59.98,
    "total": 59.98,
    "paymentMethod": "cash"
  }'
```

## 📚 Available API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/session` - Get current session
- `POST /api/auth/refresh` - Refresh token

### Products
- `GET /api/products` - List all products
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Orders
- `GET /api/orders` - List all orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order

### Customers
- `GET /api/customers` - List all customers
- `POST /api/customers` - Create customer

### Health
- `GET /api/health` - Health check

## 🛠️ NPM Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload

# Database
npm run setup-db         # Run migrations + seed data
npm run migrate          # Run migrations only
npm run seed             # Run seed data only

# Build & Production
npm run build            # Compile TypeScript
npm run start            # Start production server

# Code Quality
npm run lint             # Run ESLint
npm run typecheck        # Check TypeScript types
```

## 📁 Database Files

### SQLite
Database file: `./data/persona-pos.db`

To reset database:
```bash
rm -rf ./data
npm run setup-db
```

### PostgreSQL
To reset database:
```bash
# Drop and recreate database
psql -U postgres -c "DROP DATABASE IF EXISTS persona_pos;"
psql -U postgres -c "CREATE DATABASE persona_pos;"

# Run setup again
npm run setup-db
```

## 🗄️ Database Schema

### Core Tables
- `users` - User accounts
- `roles` - System roles (Admin, Supervisor, Reporter, Standard)
- `user_roles` - User-role assignments
- `products` - Product catalog
- `product_variants` - Product variants (size, color, etc.)
- `categories` - Product categories
- `orders` - Sales orders
- `order_items` - Order line items
- `customers` - Customer information
- `services` - Service offerings
- `quotes` - Service quotes
- `audit_logs` - Activity tracking
- `settings` - System settings

## 🔍 Troubleshooting

### Database connection failed
**SQLite:**
- Check `DB_FILENAME` path is writable
- Ensure directory exists: `mkdir -p data`

**PostgreSQL:**
- Check PostgreSQL is running: `docker ps`
- Verify credentials in `.env`
- Test connection: `psql -U postgres -h localhost`

### Migrations failed
```bash
# Check migration status
npm run migrate

# Reset and try again
rm -rf data  # SQLite only
npm run setup-db
```

### Cannot login
- Ensure database is seeded: `npm run seed`
- Check default credentials: `admin@example.com` / `admin123`
- Check server logs for errors

### Port already in use
Edit `.env` and change `PORT`:
```env
PORT=3002
```

## 📖 Additional Resources

- **Full Documentation**: See `PHASE2-COMPLETE.md`
- **Backend README**: See `backend/README.md`
- **API Examples**: See `backend/examples/` (coming soon)
- **Roadmap**: See `ROADMAP.md`

## 🎉 What's Next?

Phase 2 is complete! Next steps:

1. **Phase 3**: Automated installation scripts
2. **Add more API endpoints**: Services, Admin, Reports
3. **Add search & filtering**: Pagination, sorting, filtering
4. **API Documentation**: Swagger/OpenAPI
5. **Testing**: Unit and integration tests

## 💡 Tips

1. **Use SQLite for development** - No setup required
2. **Use PostgreSQL for production** - Better performance and features
3. **Always run migrations** before starting the server
4. **Check logs** in `backend/logs/` for debugging
5. **Use Postman** or similar tool for API testing

## 🐛 Found a Bug?

Please report issues on GitHub with:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, database adapter)
- Relevant logs

---

**Happy Coding! 🚀**
