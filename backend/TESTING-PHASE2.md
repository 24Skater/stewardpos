# Phase 2 Testing Guide

This guide helps you verify that Phase 2 (Database Implementation) is working correctly.

## 🧪 Prerequisites

```bash
cd backend
npm install
```

## Test 1: Database Setup (SQLite)

### Setup
```bash
# Configure for SQLite
cat > .env << EOF
NODE_ENV=development
PORT=3001
HOST=0.0.0.0
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
JWT_EXPIRES_IN=7d

# Database
DB_ADAPTER=sqlite
DB_FILENAME=./data/test-persona-pos.db
EOF

# Run setup
npm run setup-db
```

### Expected Output
```
=============================================================
DATABASE SETUP
=============================================================
Database Adapter: sqlite

Step 1: Running database migrations...
✅ Migrations completed successfully

Step 2: Seeding initial data...
✅ Seeding completed successfully

=============================================================
✅ DATABASE SETUP COMPLETE
=============================================================

Default admin credentials:
  Email: admin@example.com
  Password: admin123

⚠️  IMPORTANT: Change the admin password after first login!
```

### Verification
```bash
# Check database file exists
ls -lh ./data/test-persona-pos.db

# Should show file size > 0
```

✅ **Pass Criteria**: Database file created, no errors

---

## Test 2: Server Startup

### Run
```bash
npm run dev
```

### Expected Output
```
Testing database connection...
✅ Database connection successful
🚀 Server running on http://0.0.0.0:3001
📊 Environment: development
🗄️  Database: sqlite
```

✅ **Pass Criteria**: Server starts without errors, database connection successful

---

## Test 3: Authentication

### Test 3.1: Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

### Expected Response
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
      "roles": [
        {
          "id": "...",
          "name": "Admin",
          "systemRole": "admin",
          "permissions": {...}
        }
      ]
    }
  }
}
```

✅ **Pass Criteria**: Status 200, token returned, user data present

**Save the token for next tests:**
```bash
export TOKEN="your-token-here"
```

### Test 3.2: Invalid Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "wrongpassword"
  }'
```

### Expected Response
```json
{
  "success": false,
  "error": "Invalid credentials"
}
```

✅ **Pass Criteria**: Status 401, error message returned

### Test 3.3: Get Session
```bash
curl http://localhost:3001/api/auth/session \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "email": "admin@example.com",
      "name": "Admin User",
      "roleIds": ["..."],
      "status": "active",
      "roles": [...]
    }
  }
}
```

✅ **Pass Criteria**: Status 200, user data returned

---

## Test 4: Products API

### Test 4.1: List Products
```bash
curl http://localhost:3001/api/products \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "Wireless Mouse",
      "description": "Ergonomic wireless mouse",
      "category": "Electronics",
      "basePrice": 29.99,
      "variants": [
        {
          "id": "...",
          "size": null,
          "color": "Black",
          "stock": 50,
          "enabled": true
        }
      ]
    }
    // ... more products
  ]
}
```

✅ **Pass Criteria**: Status 200, array of products with variants

### Test 4.2: Get Single Product
```bash
# Get first product ID from list
PRODUCT_ID="first-product-id-from-above"

curl http://localhost:3001/api/products/$PRODUCT_ID \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Wireless Mouse",
    "variants": [...]
  }
}
```

✅ **Pass Criteria**: Status 200, single product returned

### Test 4.3: Create Product
```bash
curl -X POST http://localhost:3001/api/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Product",
    "description": "A test product for verification",
    "category": "Test Category",
    "basePrice": 19.99,
    "variants": [
      {
        "size": "M",
        "color": "Blue",
        "stock": 10,
        "enabled": true
      },
      {
        "size": "L",
        "color": "Red",
        "stock": 5,
        "enabled": true
      }
    ]
  }'
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Test Product",
    "description": "A test product for verification",
    "category": "Test Category",
    "basePrice": 19.99,
    "variants": [
      {
        "id": "...",
        "size": "M",
        "color": "Blue",
        "stock": 10,
        "enabled": true
      },
      {
        "id": "...",
        "size": "L",
        "color": "Red",
        "stock": 5,
        "enabled": true
      }
    ]
  }
}
```

✅ **Pass Criteria**: Status 201, product created with variants

**Save product ID:**
```bash
export TEST_PRODUCT_ID="new-product-id"
```

### Test 4.4: Update Product
```bash
curl -X PUT http://localhost:3001/api/products/$TEST_PRODUCT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Test Product",
    "basePrice": 24.99
  }'
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Updated Test Product",
    "basePrice": 24.99
  }
}
```

✅ **Pass Criteria**: Status 200, product updated

### Test 4.5: Delete Product
```bash
curl -X DELETE http://localhost:3001/api/products/$TEST_PRODUCT_ID \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

✅ **Pass Criteria**: Status 200, success message

---

## Test 5: Orders API

### Test 5.1: List Orders
```bash
curl http://localhost:3001/api/orders \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": true,
  "data": []
}
```

✅ **Pass Criteria**: Status 200, empty array (no orders yet)

### Test 5.2: Create Order
```bash
# Use a product ID from the list
PRODUCT_ID="existing-product-id"

curl -X POST http://localhost:3001/api/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "productId": "'$PRODUCT_ID'",
        "nameSnapshot": "Test Product",
        "quantity": 2,
        "unitPrice": 29.99,
        "lineTotal": 59.98
      }
    ],
    "subtotal": 59.98,
    "taxTotal": 5.40,
    "total": 65.38,
    "paymentMethod": "cash",
    "customerEmail": "test@example.com"
  }'
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "id": "...",
    "createdAt": 1234567890,
    "subtotal": 59.98,
    "taxTotal": 5.40,
    "total": 65.38,
    "paymentMethod": "cash",
    "customerEmail": "test@example.com",
    "items": [...]
  }
}
```

✅ **Pass Criteria**: Status 201, order created with items

### Test 5.3: Get Order
```bash
ORDER_ID="order-id-from-above"

curl http://localhost:3001/api/orders/$ORDER_ID \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "id": "...",
    "total": 65.38,
    "items": [...]
  }
}
```

✅ **Pass Criteria**: Status 200, order with items returned

---

## Test 6: Customers API

### Test 6.1: List Customers
```bash
curl http://localhost:3001/api/customers \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": true,
  "data": []
}
```

✅ **Pass Criteria**: Status 200, empty array

### Test 6.2: Create Customer
```bash
curl -X POST http://localhost:3001/api/customers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "address": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zip": "62701",
    "country": "USA"
  }'
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "address": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zip": "62701",
    "country": "USA"
  }
}
```

✅ **Pass Criteria**: Status 201, customer created

---

## Test 7: PostgreSQL (Optional)

If you have PostgreSQL available:

### Setup
```bash
# Start PostgreSQL
docker run -d \
  --name persona-postgres-test \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=persona_pos_test \
  -p 5433:5432 \
  postgres:15

# Update .env
cat > .env << EOF
NODE_ENV=development
PORT=3001
HOST=0.0.0.0
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
JWT_EXPIRES_IN=7d

# Database
DB_ADAPTER=postgres
DB_HOST=localhost
DB_PORT=5433
DB_NAME=persona_pos_test
DB_USER=postgres
DB_PASSWORD=postgres
EOF

# Setup database
npm run setup-db
```

### Run All Tests
Repeat Tests 2-6 with PostgreSQL

✅ **Pass Criteria**: All tests pass with PostgreSQL

### Cleanup
```bash
docker stop persona-postgres-test
docker rm persona-postgres-test
```

---

## Test 8: Error Handling

### Test 8.1: Unauthorized Access
```bash
curl http://localhost:3001/api/products
```

### Expected Response
```json
{
  "success": false,
  "error": "No token provided"
}
```

✅ **Pass Criteria**: Status 401, error message

### Test 8.2: Invalid Token
```bash
curl http://localhost:3001/api/products \
  -H "Authorization: Bearer invalid-token"
```

### Expected Response
```json
{
  "success": false,
  "error": "Invalid token"
}
```

✅ **Pass Criteria**: Status 401, error message

### Test 8.3: Not Found
```bash
curl http://localhost:3001/api/products/nonexistent-id \
  -H "Authorization: Bearer $TOKEN"
```

### Expected Response
```json
{
  "success": false,
  "error": "Product not found"
}
```

✅ **Pass Criteria**: Status 404, error message

### Test 8.4: Validation Error
```bash
curl -X POST http://localhost:3001/api/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "",
    "basePrice": -10
  }'
```

### Expected Response
```json
{
  "success": false,
  "error": "Validation error: ..."
}
```

✅ **Pass Criteria**: Status 400, validation error

---

## Test Summary Checklist

- [ ] SQLite database setup successful
- [ ] Server starts and connects to database
- [ ] Login works with correct credentials
- [ ] Login fails with wrong credentials
- [ ] Session endpoint returns user data
- [ ] List products returns seeded data
- [ ] Get single product works
- [ ] Create product with variants works
- [ ] Update product works
- [ ] Delete product works
- [ ] List orders works
- [ ] Create order with items works
- [ ] Get order with items works
- [ ] List customers works
- [ ] Create customer works
- [ ] PostgreSQL setup works (if tested)
- [ ] All PostgreSQL tests pass (if tested)
- [ ] Unauthorized access blocked
- [ ] Invalid token rejected
- [ ] Not found errors handled
- [ ] Validation errors handled

---

## Troubleshooting

### Database connection failed
```bash
# Check database file
ls -lh ./data/*.db

# Check PostgreSQL
docker ps | grep postgres
```

### Token expired
```bash
# Login again to get new token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'
```

### Server won't start
```bash
# Check logs
cat logs/error.log

# Check port
lsof -i :3001
```

---

## Automated Testing Script

Save this as `test-phase2.sh`:

```bash
#!/bin/bash

echo "🧪 Testing Phase 2 Implementation"
echo "=================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Test counter
PASSED=0
FAILED=0

# Test function
test_endpoint() {
  local name=$1
  local cmd=$2
  local expected_status=$3
  
  echo -n "Testing $name... "
  
  response=$(eval $cmd)
  status=$?
  
  if [ $status -eq 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
  fi
}

# Run tests
test_endpoint "Health Check" \
  "curl -s http://localhost:3001/api/health" \
  200

# Add more tests...

echo ""
echo "=================================="
echo "Results: $PASSED passed, $FAILED failed"
```

---

**Phase 2 Testing Complete!** 🎉
