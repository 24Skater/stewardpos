# PHASE 3 — PATH FORWARD (STACK-ALIGNED)

**Generated:** 2025-01-27  
**Project:** stewardPOS (Persona POS)  
**Status:** Architecture Plan Complete

**Based on:** Phase 2 Decision - Continue with Existing Stack (Option A)

---

## TARGET ARCHITECTURE

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         React SPA (Vite + TypeScript)                │   │
│  │  • Pages (POS, Inventory, Reports, Admin)            │   │
│  │  • Components (shadcn/ui)                            │   │
│  │  • State Management (TanStack Query)                 │   │
│  │  • Routing (React Router)                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│                          │ HTTP/REST (JWT Bearer)             │
│                          ▼                                    │
└─────────────────────────────────────────────────────────────┘
                          │
                          │
┌─────────────────────────────────────────────────────────────┐
│              REVERSE PROXY (Nginx)                           │
│  • Routes /api/* → Backend                                  │
│  • Routes /* → Frontend (SPA)                               │
│  • SSL/TLS Termination                                      │
│  • Security Headers                                         │
└─────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
        ▼                                   ▼
┌──────────────────┐              ┌──────────────────┐
│   BACKEND API    │              │    FRONTEND       │
│  (Express/Node)  │              │  (Static Files)   │
│                  │              │                   │
│  • REST API      │              │  • index.html     │
│  • JWT Auth      │              │  • JS/CSS bundles │
│  • Validation    │              │  • Assets        │
│  • Business Logic│              │                   │
└──────────────────┘              └───────────────────┘
        │
        │ Database Adapter (Port)
        │
        ├──► PostgreSQL (Production)
        │    • Scalable
        │    • ACID transactions
        │    • Full SQL features
        │
        └──► SQLite (Development/Small)
             • File-based
             • Zero configuration
             • Portable

┌─────────────────────────────────────────────────────────────┐
│              SUPPORTING SERVICES (Docker)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  PostgreSQL  │  │    MinIO     │  │   (Future)   │     │
│  │   Database   │  │  S3 Storage   │  │   Redis?     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Component Boundaries

#### Frontend Boundary
- **Owns:** UI/UX, client-side state, routing
- **Depends on:** Backend API (REST), Browser APIs
- **Does NOT own:** Business logic, data persistence, authentication logic

#### Backend Boundary
- **Owns:** Business logic, data persistence, authentication, validation
- **Depends on:** Database, external services (optional)
- **Does NOT own:** UI, client-side state

#### Shared Boundary
- **Ports (Interfaces):** Defined in `src/core/ports/`
- **Models (Types):** Defined in `src/core/models/`
- **NO Implementation Sharing:** Frontend and backend have separate implementations

---

## CLEAR BOUNDARIES

### 1. Frontend/Backend Separation

**Communication Protocol:**
- **Method:** HTTP REST API
- **Format:** JSON
- **Authentication:** JWT Bearer tokens
- **Base URL:** Configurable via `VITE_API_BASE_URL`

**API Contract:**
```
GET    /api/products          → List products
GET    /api/products/:id      → Get product
POST   /api/products          → Create product
PUT    /api/products/:id      → Update product
DELETE /api/products/:id      → Delete product

GET    /api/orders            → List orders
GET    /api/orders/:id        → Get order
POST   /api/orders            → Create order

GET    /api/customers         → List customers
POST   /api/customers         → Create customer

POST   /api/auth/login        → Login (get JWT)
GET    /api/auth/session      → Get current session
POST   /api/auth/logout       → Logout
POST   /api/auth/refresh      → Refresh JWT

GET    /api/health            → Health check
```

**Error Handling:**
- Standard HTTP status codes
- JSON error responses: `{ success: false, error: "message" }`
- Validation errors: 400 Bad Request
- Auth errors: 401 Unauthorized
- Not found: 404 Not Found
- Server errors: 500 Internal Server Error

### 2. Data Ownership

**Backend Owns:**
- ✅ All persistent data (PostgreSQL/SQLite)
- ✅ Data validation rules
- ✅ Business logic
- ✅ Data integrity
- ✅ Audit logs

**Frontend Owns:**
- ✅ UI state (form inputs, selections)
- ✅ Client-side caching (TanStack Query)
- ✅ Presentation logic
- ✅ User preferences (localStorage)

**Shared:**
- ✅ Type definitions (via API contract)
- ✅ Port interfaces (for documentation)

### 3. Authentication Flow

**Current (To Be Fixed):**
```
Frontend: SessionStorage → IndexedDB (local auth)
Backend: JWT tokens (API auth)
❌ Not connected
```

**Target:**
```
1. User submits login form (Frontend)
2. POST /api/auth/login (Backend)
3. Backend validates credentials
4. Backend returns JWT token
5. Frontend stores token (localStorage or httpOnly cookie)
6. Frontend includes token in Authorization header
7. Backend validates token on each request
8. Frontend refreshes token before expiry
```

**Token Storage Options:**
- **Option A:** localStorage (current, but vulnerable to XSS)
- **Option B:** httpOnly cookie (more secure, requires CORS config)
- **Recommendation:** Start with localStorage, migrate to cookies later

### 4. Extension Points

#### Plugin System (Future)
```
src/plugins/
  ├── payment-gateways/
  │   ├── stripe/
  │   ├── paypal/
  │   └── square/
  ├── reporting/
  │   ├── quickbooks/
  │   └── xero/
  └── integrations/
      ├── shopify/
      └── woocommerce/
```

#### Adapter Extensions
- **New Database:** Implement `DBPort` interface
- **New Auth:** Implement `AuthPort` interface
- **New Storage:** Implement `StoragePort` interface
- **New Email:** Implement `EmailPort` interface
- **New SMS:** Implement `SmsPort` interface

#### API Extensions
- **New Endpoints:** Add routes in `backend/src/api/routes/`
- **New Middleware:** Add in `backend/src/api/middleware/`
- **New Services:** Add in `backend/src/services/`

---

## RECOMMENDED CHANGES

### Required Changes (P0)

#### 1. Frontend-Backend Integration

**Files to Create:**
- `src/lib/api-client.ts` - API client wrapper
- `src/lib/auth-store.ts` - JWT token management

**Files to Modify:**
- `src/pages/*.tsx` - Replace `db.ts` calls with API calls
- `src/lib/auth.ts` - Use backend API instead of IndexedDB
- `vite.config.ts` - Add API proxy for development

**Implementation:**
```typescript
// src/lib/api-client.ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export const apiClient = {
  get: (path: string) => fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  }),
  post: (path: string, data: any) => fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`
    },
    body: JSON.stringify(data)
  }),
  // ... other methods
};
```

#### 2. Docker Completeness

**Files to Modify:**
- `docker-compose.yml` - Add backend service
- `Dockerfile` - Create backend Dockerfile (or use existing)

**New Files:**
- `backend/Dockerfile` - Backend container
- `.dockerignore` - Exclude unnecessary files

**Implementation:**
```yaml
# docker-compose.yml
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DB_ADAPTER=postgres
      - DB_HOST=postgres
      # ... other env vars
    depends_on:
      postgres:
        condition: service_healthy
```

### Strongly Recommended Changes (P1)

#### 3. Testing Infrastructure

**Files to Create:**
- `vitest.config.ts` - Frontend test config
- `backend/vitest.config.ts` - Backend test config
- `src/**/*.test.tsx` - Frontend tests
- `backend/src/**/*.test.ts` - Backend tests

**Dependencies to Add:**
- `vitest` - Test runner
- `@testing-library/react` - React testing
- `@testing-library/jest-dom` - DOM matchers

#### 4. TypeScript Strict Mode

**Files to Modify:**
- `tsconfig.app.json` - Enable strict mode
- `src/**/*.tsx` - Fix type errors incrementally

**Approach:**
- Enable strict mode
- Fix errors file by file
- Use `// @ts-expect-error` temporarily if needed

### Recommended Changes (P2)

#### 5. API Documentation

**Files to Create:**
- `docs/api/openapi.yaml` - OpenAPI specification
- `backend/src/api/swagger.ts` - Swagger UI setup

**Dependencies to Add:**
- `swagger-ui-express` - Swagger UI
- `swagger-jsdoc` - Generate OpenAPI from JSDoc

#### 6. Package Manager Cleanup

**Files to Remove:**
- `bun.lockb` - Remove Bun lockfile

**Files to Modify:**
- `.gitignore` - Add `bun.lockb` if not already

### Optional Changes (P3)

#### 7. Complete Backend Routes

**Files to Modify:**
- `backend/src/api/routes/services.ts` - Implement CRUD
- `backend/src/api/routes/admin.ts` - Implement admin endpoints

#### 8. Remove Frontend bcryptjs

**Files to Modify:**
- `src/lib/db-operations.ts` - Remove bcryptjs usage
- `package.json` - Remove bcryptjs dependency

**Rationale:** Password hashing should be backend-only

---

## ARCHITECTURE DECISIONS

### Decision 1: Keep IndexedDB for Development Only

**Rationale:**
- Useful for offline development
- No backend required for frontend work
- Can be removed in production build

**Implementation:**
- Use IndexedDB when `VITE_API_BASE_URL` is not set
- Use Backend API when `VITE_API_BASE_URL` is set
- Make it configurable via environment

### Decision 2: JWT Token Storage in localStorage

**Rationale:**
- Simpler implementation
- Works with CORS
- Can migrate to httpOnly cookies later

**Security Considerations:**
- XSS vulnerability (mitigate with CSP headers)
- Token refresh before expiry
- Short token expiry (15 minutes) + refresh token

### Decision 3: Keep Adapter Pattern

**Rationale:**
- Flexibility is a strength
- Easy to add new adapters
- Self-hostable options

**Implementation:**
- Keep all existing adapters
- Document which are production-ready
- Mark incomplete adapters as "TODO"

### Decision 4: No ORM (Keep Raw SQL)

**Rationale:**
- Current implementation works
- More control over queries
- Less abstraction = less magic

**Future Consideration:**
- Can add Prisma incrementally if needed
- Keep adapter pattern for flexibility

### Decision 5: Single Database Per Instance

**Rationale:**
- Simpler configuration
- Clear data ownership
- Avoids sync complexity

**Implementation:**
- Choose database at startup
- No runtime switching
- Clear migration path between databases

---

## DATA FLOW (TARGET STATE)

### Create Product Flow

```
1. User fills form (Frontend)
   └─> React component state

2. User clicks "Save" (Frontend)
   └─> Validation (Zod schema)
   └─> POST /api/products (API client)
       └─> JWT token in header

3. Request arrives (Backend)
   └─> CORS check
   └─> Auth middleware (JWT validation)
   └─> Rate limiting
   └─> Request logging

4. Route handler (Backend)
   └─> Validation (Zod schema)
   └─> Database adapter
       └─> PostgreSQL/SQLite query
       └─> Transaction (if needed)

5. Response (Backend)
   └─> Success: 201 Created + product data
   └─> Error: 400/500 + error message

6. Frontend receives response
   └─> TanStack Query cache update
   └─> UI update (optimistic or after response)
   └─> Toast notification
```

### Authentication Flow

```
1. User enters credentials (Frontend)
   └─> Login form

2. POST /api/auth/login (Frontend)
   └─> No auth required (public endpoint)

3. Backend validates (Backend)
   └─> Get user from database
   └─> Verify password (bcrypt)
   └─> Generate JWT token
   └─> Return token + user data

4. Frontend stores token (Frontend)
   └─> localStorage.setItem('auth_token', token)
   └─> Update auth state
   └─> Redirect to dashboard

5. Subsequent requests (Frontend)
   └─> Include token: Authorization: Bearer <token>
   └─> Backend validates on each request
```

---

## EXTENSION POINTS

### 1. Payment Gateway Integration

**Interface:**
```typescript
interface PaymentGateway {
  processPayment(amount: number, method: string): Promise<PaymentResult>;
  refundPayment(transactionId: string): Promise<RefundResult>;
}
```

**Implementation:**
- Create `src/adapters/payment/StripeAdapter.ts`
- Register in DI container
- Add to order creation flow

### 2. Reporting Integration

**Interface:**
```typescript
interface ReportingService {
  exportToQuickBooks(data: ReportData): Promise<void>;
  exportToXero(data: ReportData): Promise<void>;
}
```

**Implementation:**
- Create adapters for each service
- Add to admin exports page
- Schedule exports (future: cron jobs)

### 3. Inventory Sync

**Interface:**
```typescript
interface InventorySync {
  syncFromShopify(): Promise<void>;
  syncToWooCommerce(): Promise<void>;
}
```

**Implementation:**
- Create sync adapters
- Add to admin settings
- Schedule syncs (future: background jobs)

---

## MIGRATION PATH

### Phase 1: Integration (Week 1-2)
- Add API client
- Connect frontend to backend
- Remove IndexedDB from production
- Add Docker backend service

### Phase 2: Testing (Week 3)
- Add test infrastructure
- Write critical path tests
- Add CI/CD pipeline

### Phase 3: Polish (Week 4)
- TypeScript strict mode
- API documentation
- Complete backend routes

### Phase 4: Production (Week 5+)
- Production deployment guide
- Backup/restore scripts
- Monitoring setup
- Performance optimization

---

## END OF PHASE 3

**Next Steps:** Proceed to Phase 4 (Docker & Self-Hosting)

**Status:** ✅ Architecture plan complete. Ready for Docker implementation.

