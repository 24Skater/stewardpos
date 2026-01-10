# PHASE 1 — FILE-BY-FILE MAPPING

**Generated:** 2025-01-27  
**Project:** stewardPOS (Persona POS)  
**Status:** Complete File Analysis

---

## A) FULL FILE MAP TABLE

### Root Configuration Files

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `package.json` | Config | Frontend dependencies & scripts | npm, build tools | All frontend deps | None | None | Root package manager config |
| `package-lock.json` | Lockfile | Dependency version locking | npm | None | None | None | npm lockfile v3 |
| `bun.lockb` | Lockfile | Bun dependency locking | Bun | None | None | None | Binary lockfile - potential conflict |
| `tsconfig.json` | Config | TypeScript root config | tsc, IDE | None | None | None | Project references only |
| `tsconfig.app.json` | Config | Frontend TS config | Vite, tsc | None | None | None | Strict mode disabled |
| `tsconfig.node.json` | Config | Node/build tool TS config | Vite | None | None | None | Strict mode enabled |
| `vite.config.ts` | Config | Vite build configuration | Vite | react, path, lovable-tagger | None | None | Dev server on port 8080 |
| `tailwind.config.ts` | Config | Tailwind CSS configuration | PostCSS, Tailwind | tailwindcss-animate | None | None | shadcn/ui theme config |
| `postcss.config.js` | Config | PostCSS processing | PostCSS | tailwindcss, autoprefixer | None | None | CSS processing pipeline |
| `eslint.config.js` | Config | ESLint rules | ESLint | @eslint/js, typescript-eslint | None | None | Flat config format |
| `components.json` | Config | shadcn/ui configuration | shadcn CLI | None | None | None | Component generator config |
| `nginx.conf` | Config | Nginx server config | Nginx (Docker) | None | None | None | SPA routing, security headers |
| `Dockerfile` | Config | Frontend container build | Docker | node:20-alpine, nginx:alpine | None | FS writes | Multi-stage build |
| `docker-compose.yml` | Config | Docker services orchestration | docker-compose | postgres, minio, nginx | VITE_* vars | Network, volumes | Missing backend service |
| `.gitignore` | Config | Git ignore patterns | Git | None | None | None | Root ignore rules |
| `index.html` | Source | HTML entry point | Vite, browser | None | None | None | React mount point |

### Backend Configuration Files

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `backend/package.json` | Config | Backend dependencies | npm | All backend deps | None | None | Node.js >=18 required |
| `backend/tsconfig.json` | Config | Backend TypeScript config | tsc, tsx | None | None | None | Strict mode enabled |
| `backend/env.example` | Config | Environment template | Developers | None | None | None | Copy to .env |
| `backend/.gitignore` | Config | Backend gitignore | Git | None | None | None | Backend-specific ignores |

### Backend Source Files

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `backend/src/server.ts` | Source | Express server entry | node, tsx | express, cors, helmet, rate-limit | PORT, HOST, NODE_ENV | Network (HTTP server) | Main backend entry point |
| `backend/src/config/index.ts` | Source | Configuration loader | server.ts, all routes | dotenv, zod | All backend env vars | None | Validates config on startup |
| `backend/src/services/database.ts` | Source | Database service singleton | server.ts, routes | PostgresAdapter, SQLiteAdapter | DB_* vars | DB connections | Factory pattern |
| `backend/src/services/migrator.ts` | Source | Database migration runner | setup-database.ts | fs, pg, better-sqlite3 | DB_* vars | DB writes (schema) | CLI executable |
| `backend/src/services/seeder.ts` | Source | Database seed data | setup-database.ts | bcryptjs, pg, better-sqlite3 | DB_* vars | DB writes (data) | CLI executable |
| `backend/src/utils/logger.ts` | Source | Winston logger | All backend files | winston | LOG_LEVEL, LOG_FILE | FS writes (if file transport) | Singleton logger |
| `backend/src/utils/errors.ts` | Source | Custom error classes | All routes, middleware | None | None | None | Error hierarchy |
| `backend/src/api/middleware/auth.ts` | Source | JWT authentication | All protected routes | jsonwebtoken | JWT_SECRET | None | Bearer token validation |
| `backend/src/api/middleware/errorHandler.ts` | Source | Global error handler | server.ts | None | NODE_ENV | None | Last middleware |
| `backend/src/api/middleware/requestLogger.ts` | Source | HTTP request logging | server.ts | logger | None | None | Request/response logging |
| `backend/src/api/routes/auth.ts` | Source | Authentication routes | server.ts | bcryptjs, jsonwebtoken, zod | JWT_SECRET | DB reads/writes | Login, logout, session |
| `backend/src/api/routes/products.ts` | Source | Product CRUD routes | server.ts | zod | None | DB reads/writes | Full CRUD operations |
| `backend/src/api/routes/orders.ts` | Source | Order CRUD routes | server.ts | zod | None | DB reads/writes | Create, read operations |
| `backend/src/api/routes/customers.ts` | Source | Customer CRUD routes | server.ts | zod | None | DB reads/writes | Create, read operations |
| `backend/src/api/routes/services.ts` | Source | Service routes | server.ts | None | None | None | TODO: Not implemented |
| `backend/src/api/routes/admin.ts` | Source | Admin routes | server.ts | None | None | None | TODO: Not implemented |
| `backend/src/api/routes/health.ts` | Source | Health check endpoint | server.ts | None | NODE_ENV | None | No auth required |
| `backend/src/adapters/db/PostgresAdapter.ts` | Source | PostgreSQL implementation | database.ts | pg | DB_* vars | DB connections, queries | Production-ready |
| `backend/src/adapters/db/SQLiteAdapter.ts` | Source | SQLite implementation | database.ts | better-sqlite3, fs | DB_FILENAME | FS reads/writes | Production-ready |
| `backend/scripts/setup-database.ts` | Script | DB setup script | npm run setup-db | Migrator, Seeder | DB_* vars | DB writes | CLI tool |

### Backend Migration Files

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `backend/migrations/postgres/001_initial_schema.sql` | SQL | PostgreSQL schema | migrator.ts | PostgreSQL | None | DB writes (DDL) | Complete schema |
| `backend/migrations/sqlite/001_initial_schema.sql` | SQL | SQLite schema | migrator.ts | SQLite | None | DB writes (DDL) | Complete schema |

### Frontend Source Files - Core

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `src/main.tsx` | Source | React entry point | Vite, browser | react, react-dom | None | DOM manipulation | App bootstrap |
| `src/App.tsx` | Source | Main React component | main.tsx | react-router, react-query | None | None | Route definitions |
| `src/index.css` | Source | Global styles | main.tsx | Tailwind CSS | None | None | CSS variables, base styles |
| `src/App.css` | Source | App-specific styles | App.tsx | None | None | None | Component styles |
| `src/vite-env.d.ts` | Source | Vite type definitions | TypeScript | None | None | None | Type declarations |

### Frontend Source Files - Core Domain

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `src/core/models/index.ts` | Source | Type exports | All adapters, pages | None | None | None | Re-exports from db.ts |
| `src/core/ports/DBPort.ts` | Source | Database port interface | di.ts, adapters | None | None | None | Interface definition |
| `src/core/ports/AuthPort.ts` | Source | Auth port interface | di.ts, adapters | None | None | None | Interface definition |
| `src/core/ports/EmailPort.ts` | Source | Email port interface | di.ts, adapters | None | None | None | Interface definition |
| `src/core/ports/SmsPort.ts` | Source | SMS port interface | di.ts, adapters | None | None | None | Interface definition |
| `src/core/ports/StoragePort.ts` | Source | Storage port interface | di.ts, adapters | None | None | None | Interface definition |

### Frontend Source Files - Adapters

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `src/adapters/db/IndexedDBAdapter.ts` | Source | IndexedDB implementation | di.ts | idb | None | Browser storage | Browser-only |
| `src/adapters/db/PostgresAdapter.ts` | Source | PostgreSQL client adapter | di.ts | None | VITE_DB_* | Network (HTTP) | Frontend DB adapter |
| `src/adapters/auth/LocalAuthAdapter.ts` | Source | Local auth implementation | di.ts | bcryptjs | None | SessionStorage | Client-side auth |
| `src/adapters/auth/GoogleAuthAdapter.ts` | Source | Google OAuth adapter | di.ts | None | VITE_AUTH_* | Network (OAuth) | Not implemented |
| `src/adapters/auth/OIDCAuthAdapter.ts` | Source | OIDC adapter | di.ts | None | VITE_AUTH_* | Network (OIDC) | Not implemented |
| `src/adapters/email/ConsoleEmailAdapter.ts` | Source | Console email (dev) | di.ts | None | None | Console.log | Dev only |
| `src/adapters/email/SMTPEmailAdapter.ts` | Source | SMTP email | di.ts | None | VITE_EMAIL_* | Network (SMTP) | Not implemented |
| `src/adapters/email/ResendEmailAdapter.ts` | Source | Resend email | di.ts | None | VITE_EMAIL_* | Network (API) | Not implemented |
| `src/adapters/sms/ConsoleSmsAdapter.ts` | Source | Console SMS (dev) | di.ts | None | None | Console.log | Dev only |
| `src/adapters/sms/TwilioSmsAdapter.ts` | Source | Twilio SMS | di.ts | None | VITE_SMS_* | Network (API) | Not implemented |
| `src/adapters/storage/LocalStorageAdapter.ts` | Source | Browser localStorage | di.ts | None | None | Browser storage | Client-only |
| `src/adapters/storage/S3StorageAdapter.ts` | Source | S3 storage | di.ts | None | VITE_STORAGE_* | Network (S3) | Not implemented |
| `src/adapters/storage/AzureBlobStorageAdapter.ts` | Source | Azure Blob storage | di.ts | None | VITE_STORAGE_* | Network (Azure) | Not implemented |

### Frontend Source Files - Libraries

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `src/lib/db.ts` | Source | IndexedDB operations | All pages, components | idb | None | Browser storage | Main DB interface |
| `src/lib/db-operations.ts` | Source | DB operation helpers | auth.ts, pages | bcryptjs, db.ts | None | Browser storage | CRUD operations |
| `src/lib/auth.ts` | Source | Auth utilities | ProtectedRoute, pages | db-operations.ts | None | SessionStorage | Session management |
| `src/lib/config.ts` | Source | Frontend configuration | di.ts | zod | VITE_* vars | None | Config loader |
| `src/lib/di.ts` | Source | Dependency injection | All adapters | All adapters | VITE_* vars | None | Singleton container |
| `src/lib/utils.ts` | Source | Utility functions | All components | clsx, tailwind-merge | None | None | cn() helper |
| `src/lib/export-utils.ts` | Source | Export utilities | AdminExports | jspdf, jspdf-autotable | None | FS writes (downloads) | CSV/PDF export |

### Frontend Source Files - Components

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `src/components/AdminLayout.tsx` | Source | Admin layout wrapper | All admin pages | react-router | None | None | Layout component |
| `src/components/ProtectedRoute.tsx` | Source | Route protection | App.tsx | auth.ts | None | None | Auth guard |
| `src/components/Cart.tsx` | Source | Shopping cart UI | POS.tsx | UI components | None | None | Cart display |
| `src/components/ProductCard.tsx` | Source | Product card UI | POS.tsx, Inventory.tsx | UI components | None | None | Product display |
| `src/components/Receipt.tsx` | Source | Receipt component | ReceiptDialog.tsx | UI components | None | None | Receipt rendering |
| `src/components/ReceiptDialog.tsx` | Source | Receipt dialog | POS.tsx | UI components | None | None | Receipt modal |
| `src/components/VariantPicker.tsx` | Source | Variant selection | ProductCard.tsx | UI components | None | None | Size/color picker |
| `src/components/ImportInventoryDialog.tsx` | Source | Inventory import | AdminInventory.tsx | UI components | None | FS reads | CSV import |
| `src/components/ui/*.tsx` | Source | shadcn/ui components | All pages | Radix UI, Tailwind | None | None | 40+ UI components |

### Frontend Source Files - Pages

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `src/pages/Index.tsx` | Source | Home page | App.tsx | None | None | None | Redirects to POS |
| `src/pages/Login.tsx` | Source | Login page | App.tsx | auth.ts | None | SessionStorage | Auth form |
| `src/pages/POS.tsx` | Source | Point of sale | App.tsx | db.ts, components | None | Browser storage | Main POS interface |
| `src/pages/Inventory.tsx` | Source | Inventory view | App.tsx | db.ts | None | Browser storage | Product listing |
| `src/pages/Reports.tsx` | Source | Reports page | App.tsx | db.ts, recharts | None | Browser storage | Sales reports |
| `src/pages/Settings.tsx` | Source | Settings page | App.tsx | db.ts | None | Browser storage | User settings |
| `src/pages/ServicesPos.tsx` | Source | Services POS | App.tsx | db.ts | None | Browser storage | Services checkout |
| `src/pages/NotFound.tsx` | Source | 404 page | App.tsx | None | None | None | Error page |
| `src/pages/admin/Dashboard.tsx` | Source | Admin dashboard | App.tsx | db.ts, recharts | None | Browser storage | Admin overview |
| `src/pages/admin/AdminInventory.tsx` | Source | Admin inventory | App.tsx | db.ts, export-utils | None | Browser storage, FS | Full CRUD |
| `src/pages/admin/AdminReports.tsx` | Source | Admin reports | App.tsx | db.ts | None | Browser storage | Admin reports |
| `src/pages/admin/AdminExports.tsx` | Source | Export management | App.tsx | export-utils | None | FS writes | CSV/PDF export |
| `src/pages/admin/AdminCustomers.tsx` | Source | Customer management | App.tsx | db.ts | None | Browser storage | Customer CRUD |
| `src/pages/admin/AdminServices.tsx` | Source | Service management | App.tsx | db.ts | None | Browser storage | Service CRUD |
| `src/pages/admin/AdminSettings.tsx` | Source | Admin settings | App.tsx | db.ts | None | Browser storage | System settings |
| `src/pages/admin/AdminRoles.tsx` | Source | Role management | App.tsx | db.ts | None | Browser storage | RBAC management |
| `src/pages/admin/AdminAudit.tsx` | Source | Audit logs | App.tsx | db.ts | None | Browser storage | Audit log viewer |

### Frontend Source Files - Hooks

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `src/hooks/use-mobile.tsx` | Source | Mobile detection hook | Components | None | None | None | Responsive hook |
| `src/hooks/use-toast.ts` | Source | Toast notification hook | Components | sonner | None | None | Toast system |

### Configuration Files

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `config/default.yml` | Config | Default YAML config | config.ts (frontend) | js-yaml | None | None | Default settings |
| `config/README.md` | Doc | Config documentation | Developers | None | None | None | Config guide |

### Documentation Files

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `README.md` | Doc | Main project README | Developers | None | None | None | Project overview |
| `CONTRIBUTING.md` | Doc | Contribution guide | Contributors | None | None | None | How to contribute |
| `SECURITY.md` | Doc | Security policy | Developers | None | None | None | Security practices |
| `LICENSE` | Doc | MIT License | Legal | None | None | None | License terms |
| `CHANGELOG.md` | Doc | Version history | Developers | None | None | None | Change log |
| `ROADMAP.md` | Doc | Development roadmap | Developers | None | None | None | Future plans |
| `INSTALL.md` | Doc | Installation guide | Users | None | None | None | Setup instructions |
| `CONFIGURATION.md` | Doc | Configuration guide | Users | None | None | None | Config reference |
| `PHASE2-COMPLETE.md` | Doc | Phase 2 summary | Developers | None | None | None | Progress notes |
| `CLEANUP-SUMMARY.md` | Doc | Cleanup notes | Developers | None | None | None | Cleanup log |
| `docs/architecture.svg` | Doc | Architecture diagram | README | None | None | None | Visual diagram |
| `docs/archive/*.md` | Doc | Archived docs | Developers | None | None | None | Historical docs |

### Static Assets

| Path | Type | Responsibility | Importers/Callers | External Deps | Env Vars | Side Effects | Notes |
|------|------|---------------|-------------------|---------------|----------|--------------|-------|
| `public/favicon.ico` | Asset | Site favicon | Browser | None | None | None | Browser icon |
| `public/placeholder.svg` | Asset | Placeholder image | Components | None | None | None | Default image |
| `public/robots.txt` | Config | SEO robots file | Search engines | None | None | None | Crawler rules |

---

## B) DEPENDENCY GRAPH SUMMARY

### Frontend Dependency Graph

```
main.tsx
  └─> App.tsx
       ├─> React Router (Routes)
       │    ├─> POS.tsx
       │    │    ├─> Cart.tsx
       │    │    ├─> ProductCard.tsx
       │    │    └─> db.ts (IndexedDB)
       │    ├─> Inventory.tsx
       │    │    └─> db.ts
       │    ├─> Reports.tsx
       │    │    └─> db.ts, recharts
       │    ├─> Login.tsx
       │    │    └─> auth.ts
       │    │         └─> db-operations.ts
       │    │              └─> db.ts, bcryptjs
       │    └─> admin/*.tsx
       │         ├─> AdminLayout.tsx
       │         ├─> ProtectedRoute.tsx
       │         │    └─> auth.ts
       │         └─> db.ts, export-utils.ts
       │
       └─> TanStack Query (API state)
            └─> Backend API (REST)
                 └─> Express server
```

### Backend Dependency Graph

```
server.ts
  ├─> Express App
  │    ├─> Middleware
  │    │    ├─> helmet (security)
  │    │    ├─> cors (CORS)
  │    │    ├─> rate-limit (throttling)
  │    │    ├─> requestLogger
  │    │    └─> errorHandler
  │    │
  │    └─> Routes
  │         ├─> /api/auth
  │         │    └─> auth middleware (JWT)
  │         ├─> /api/products
  │         │    └─> database.ts
  │         │         └─> PostgresAdapter | SQLiteAdapter
  │         ├─> /api/orders
  │         │    └─> database.ts
  │         ├─> /api/customers
  │         │    └─> database.ts
  │         └─> /api/health
  │
  └─> database.ts
       └─> Adapters (PostgresAdapter | SQLiteAdapter)
```

### Cross-Cutting Dependencies

**Configuration:**
- Frontend: `config.ts` → `VITE_*` env vars → `di.ts` → Adapters
- Backend: `config/index.ts` → `.env` → All services

**Authentication:**
- Frontend: `auth.ts` → `db-operations.ts` → `db.ts` (IndexedDB)
- Backend: `auth.ts` (routes) → `auth.ts` (middleware) → JWT → `database.ts`

**Database:**
- Frontend: `db.ts` → IndexedDB (browser)
- Backend: `database.ts` → PostgresAdapter | SQLiteAdapter → pg | better-sqlite3

**Error Handling:**
- Frontend: React Error Boundaries (implicit)
- Backend: `errorHandler.ts` → `errors.ts` → Express error middleware

---

## C) APPLICATION RUNTIME FLOW

### Development Mode

#### Frontend Startup (Vite)
1. **Vite Dev Server** (`vite.config.ts`)
   - Starts on `http://localhost:8080` (or 5173)
   - Watches `src/` for changes
   - Hot Module Replacement (HMR) enabled
   - Serves `index.html` as entry

2. **React Bootstrap** (`main.tsx`)
   - Imports `App.tsx`
   - Mounts to `#root` DOM element
   - Loads `index.css` (global styles)

3. **App Initialization** (`App.tsx`)
   - Sets up React Router
   - Configures TanStack Query
   - Defines all routes
   - Wraps with providers (Tooltip, Toaster)

4. **Route Resolution**
   - User navigates → React Router matches route
   - `ProtectedRoute` checks auth (if needed)
   - Page component renders
   - Component fetches data:
     - **IndexedDB path:** `db.ts` → IndexedDB (browser storage)
     - **Backend API path:** TanStack Query → HTTP → Backend API

5. **Data Flow (IndexedDB Mode)**
   ```
   Component → db.ts → getDB() → IndexedDB (idb)
   ```
   - All data stored in browser
   - No network requests
   - Offline-capable

6. **Data Flow (Backend API Mode)**
   ```
   Component → TanStack Query → fetch('/api/*') → Backend Express
   ```
   - Requires backend running
   - JWT token in Authorization header
   - CORS must be configured

#### Backend Startup (Express)
1. **Server Bootstrap** (`server.ts`)
   - Loads `.env` via `config/index.ts`
   - Validates configuration (Zod schema)
   - Creates Express app
   - Applies middleware (helmet, cors, rate-limit)
   - Registers routes

2. **Database Connection** (`database.ts`)
   - Reads `DB_ADAPTER` from config
   - Creates adapter (PostgresAdapter | SQLiteAdapter)
   - Tests connection
   - Exits if connection fails

3. **Route Handling**
   - Request arrives → `requestLogger` logs it
   - Protected routes → `auth` middleware validates JWT
   - Route handler → `database.ts` → Adapter → Database
   - Response → `errorHandler` catches errors

4. **Request Flow Example (GET /api/products)**
   ```
   HTTP Request
     → Express
     → requestLogger (log)
     → auth middleware (JWT validation)
     → products route handler
     → database.getAdapter()
     → PostgresAdapter.getAllProducts()
     → PostgreSQL query
     → Response JSON
     → errorHandler (if error)
   ```

### Production Mode (Docker)

#### Docker Compose Services

1. **PostgreSQL Service**
   - Image: `postgres:16-alpine`
   - Port: `5432:5432`
   - Volume: `postgres_data` (persistent)
   - Health check: `pg_isready`
   - Env: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`

2. **MinIO Service**
   - Image: `minio/minio:latest`
   - Ports: `9000:9000` (API), `9001:9001` (Console)
   - Volume: `minio_data` (persistent)
   - Health check: HTTP endpoint
   - Env: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`

3. **Frontend App Service**
   - Build: `Dockerfile` (multi-stage)
   - Stage 1: `node:20-alpine` → Build with Vite
   - Stage 2: `nginx:alpine` → Serve static files
   - Port: `8080:80`
   - Env: `VITE_*` variables (build-time)
   - **Note:** Backend not in compose (runs separately)

#### Production Startup Sequence

1. **Database Initialization**
   - PostgreSQL starts → Health check passes
   - Backend runs migrations (`npm run migrate`)
   - Backend seeds data (`npm run seed`)

2. **Backend Startup** (separate from compose)
   - Reads `.env` or environment variables
   - Connects to PostgreSQL (from compose)
   - Starts Express server on `PORT` (default 3001)

3. **Frontend Build**
   - Docker build runs `npm run build`
   - Vite bundles React app
   - Static files copied to Nginx container
   - Nginx serves files with SPA routing

4. **Request Flow (Production)**
   ```
   Browser
     → Nginx (port 80)
     → Serves static files (React app)
     → React app loads
     → API calls → Backend (port 3001, separate)
     → Backend → PostgreSQL (port 5432, compose)
   ```

#### Missing Production Elements

1. **Backend Container:** Not in docker-compose.yml
   - Must run separately or add to compose
   - No health checks for backend
   - No automatic restart

2. **Service Discovery:** Hardcoded URLs
   - Frontend must know backend URL
   - No service discovery mechanism
   - CORS must be configured

3. **Reverse Proxy:** No unified entry point
   - Frontend on port 80
   - Backend on port 3001
   - Should use reverse proxy (Nginx) for both

---

## KEY OBSERVATIONS

### Architecture Patterns

1. **Clean Architecture:** Well-separated ports and adapters
2. **Dependency Injection:** Singleton DI container
3. **Configuration-Driven:** Environment variables control behavior
4. **Adapter Pattern:** Multiple implementations per port

### Data Flow Issues

1. **Dual Storage:** Frontend uses IndexedDB OR Backend API (not both)
2. **No Sync:** IndexedDB and Backend are separate (no synchronization)
3. **Auth Split:** Frontend has local auth, backend has JWT auth (inconsistent)

### Missing Connections

1. **Frontend → Backend:** No clear API client configuration
2. **Backend in Docker:** Not containerized in compose
3. **Health Checks:** Backend health not checked by compose

### Security Concerns

1. **bcryptjs in Frontend:** Password hashing client-side (unusual)
2. **SessionStorage Auth:** Client-side sessions (vulnerable to XSS)
3. **No HTTPS:** Docker setup doesn't enforce HTTPS

---

## END OF PHASE 1

**Next Steps:** Proceed to Phase 2 (Stack Assessment & Decision Point)

**Status:** ✅ Complete file mapping compiled. Ready for architectural decisions.

