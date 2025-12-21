# PHASE 0 — COMPLETE REPOSITORY INVENTORY

**Generated:** 2025-01-27  
**Project:** stewardPOS (Persona POS)  
**Status:** Complete Inventory - No Design Decisions Yet

---

## 1. COMPLETE REPOSITORY TREE

```
stewardpos/
├── .gitignore                          # Root gitignore
├── bun.lockb                           # Bun lockfile (binary)
├── CHANGELOG.md                        # Version history
├── CLEANUP-SUMMARY.md                  # Cleanup documentation
├── components.json                     # shadcn/ui configuration
├── CONFIGURATION.md                    # Configuration guide
├── CONTRIBUTING.md                     # Contribution guidelines
├── docker-compose.yml                  # Docker Compose configuration
├── Dockerfile                          # Frontend Docker build
├── eslint.config.js                    # ESLint configuration
├── index.html                          # Frontend entry HTML
├── INSTALL.md                          # Installation guide
├── LICENSE                             # MIT License
├── nginx.conf                          # Nginx configuration
├── package-lock.json                   # npm lockfile
├── package.json                        # Root package.json (frontend)
├── PHASE2-COMPLETE.md                  # Phase 2 completion notes
├── postcss.config.js                   # PostCSS configuration
├── README.md                           # Main project README
├── ROADMAP.md                          # Development roadmap
├── SECURITY.md                         # Security policy
├── tailwind.config.ts                  # Tailwind CSS configuration
├── tsconfig.json                       # Root TypeScript config
├── tsconfig.app.json                   # App TypeScript config
├── tsconfig.node.json                  # Node TypeScript config
├── vite.config.ts                     # Vite build configuration
│
├── backend/                            # Backend API (Express/Node.js)
│   ├── .gitignore                     # Backend gitignore
│   ├── env.example                     # Backend environment template
│   ├── package.json                    # Backend dependencies
│   ├── PHASE2-QUICKSTART.md            # Backend quickstart
│   ├── README.md                       # Backend documentation
│   ├── TESTING-PHASE2.md              # Testing guide
│   ├── tsconfig.json                   # Backend TypeScript config
│   │
│   ├── migrations/                     # Database migrations
│   │   ├── postgres/
│   │   │   └── 001_initial_schema.sql  # PostgreSQL schema
│   │   └── sqlite/
│   │       └── 001_initial_schema.sql  # SQLite schema
│   │
│   ├── scripts/
│   │   └── setup-database.ts          # Database setup script
│   │
│   └── src/
│       ├── adapters/
│       │   └── db/
│       │       ├── PostgresAdapter.ts  # PostgreSQL adapter
│       │       └── SQLiteAdapter.ts    # SQLite adapter
│       │
│       ├── api/
│       │   ├── middleware/
│       │   │   ├── auth.ts            # JWT authentication middleware
│       │   │   ├── errorHandler.ts    # Error handling middleware
│       │   │   └── requestLogger.ts   # Request logging middleware
│       │   │
│       │   └── routes/
│       │       ├── admin.ts           # Admin routes
│       │       ├── auth.ts            # Authentication routes
│       │       ├── customers.ts      # Customer routes
│       │       ├── health.ts          # Health check routes
│       │       ├── orders.ts          # Order routes
│       │       ├── products.ts       # Product routes
│       │       └── services.ts       # Service routes
│       │
│       ├── config/
│       │   └── index.ts               # Backend configuration (Zod schema)
│       │
│       ├── services/
│       │   ├── database.ts            # Database service (singleton)
│       │   ├── migrator.ts            # Migration runner
│       │   └── seeder.ts              # Database seeder
│       │
│       ├── server.ts                  # Express server entry point
│       │
│       └── utils/
│           ├── errors.ts              # Custom error classes
│           └── logger.ts              # Winston logger
│
├── config/                            # Configuration files
│   ├── default.yml                    # Default YAML configuration
│   └── README.md                      # Config documentation
│
├── docs/                              # Documentation
│   ├── architecture.svg               # Architecture diagram
│   └── archive/                      # Archived documentation
│       ├── BACKEND-QUICKSTART.md
│       ├── CODE-REVIEW-PHASE2.md
│       ├── CODE-REVIEW-SUMMARY.md
│       ├── DEVELOPMENT-SUMMARY.md
│       ├── GITHUB-READINESS-CHECKLIST.md
│       ├── PHASE1-PROGRESS.md
│       ├── PHASE2-DELIVERABLES.md
│       ├── PHASE2-PROGRESS.md
│       ├── PHASE2-SUMMARY.md
│       ├── QUICK-REFERENCE.md
│       ├── README-UPDATE-SUMMARY.md
│       └── README.md
│
├── public/                            # Static assets
│   ├── favicon.ico
│   ├── placeholder.svg
│   └── robots.txt
│
└── src/                               # Frontend source (React)
    ├── adapters/                      # Frontend adapters (Ports & Adapters)
    │   ├── auth/
    │   │   ├── GoogleAuthAdapter.ts
    │   │   ├── LocalAuthAdapter.ts
    │   │   └── OIDCAuthAdapter.ts
    │   ├── db/
    │   │   ├── IndexedDBAdapter.ts
    │   │   └── PostgresAdapter.ts
    │   ├── email/
    │   │   ├── ConsoleEmailAdapter.ts
    │   │   ├── ResendEmailAdapter.ts
    │   │   └── SMTPEmailAdapter.ts
    │   ├── sms/
    │   │   ├── ConsoleSmsAdapter.ts
    │   │   └── TwilioSmsAdapter.ts
    │   └── storage/
    │       ├── AzureBlobStorageAdapter.ts
    │       ├── LocalStorageAdapter.ts
    │       └── S3StorageAdapter.ts
    │
    ├── components/                    # React components
    │   ├── AdminLayout.tsx
    │   ├── Cart.tsx
    │   ├── ImportInventoryDialog.tsx
    │   ├── ProductCard.tsx
    │   ├── ProtectedRoute.tsx
    │   ├── Receipt.tsx
    │   ├── ReceiptDialog.tsx
    │   ├── VariantPicker.tsx
    │   │
    │   └── ui/                        # shadcn/ui components (40+ files)
    │       ├── accordion.tsx
    │       ├── alert-dialog.tsx
    │       ├── alert.tsx
    │       ├── aspect-ratio.tsx
    │       ├── avatar.tsx
    │       ├── badge.tsx
    │       ├── breadcrumb.tsx
    │       ├── button.tsx
    │       ├── calendar.tsx
    │       ├── card.tsx
    │       ├── carousel.tsx
    │       ├── chart.tsx
    │       ├── checkbox.tsx
    │       ├── collapsible.tsx
    │       ├── command.tsx
    │       ├── context-menu.tsx
    │       ├── dialog.tsx
    │       ├── drawer.tsx
    │       ├── dropdown-menu.tsx
    │       ├── form.tsx
    │       ├── hover-card.tsx
    │       ├── input-otp.tsx
    │       ├── input.tsx
    │       ├── label.tsx
    │       ├── menubar.tsx
    │       ├── navigation-menu.tsx
    │       ├── pagination.tsx
    │       ├── popover.tsx
    │       ├── progress.tsx
    │       ├── radio-group.tsx
    │       ├── resizable.tsx
    │       ├── scroll-area.tsx
    │       ├── select.tsx
    │       ├── separator.tsx
    │       ├── sheet.tsx
    │       ├── sidebar.tsx
    │       ├── skeleton.tsx
    │       ├── slider.tsx
    │       ├── sonner.tsx
    │       ├── switch.tsx
    │       ├── table.tsx
    │       ├── tabs.tsx
    │       ├── textarea.tsx
    │       ├── toast.tsx
    │       ├── toaster.tsx
    │       ├── toggle-group.tsx
    │       ├── toggle.tsx
    │       ├── tooltip.tsx
    │       └── use-toast.ts
    │
    ├── core/                          # Core domain (Ports & Adapters)
    │   ├── models/
    │   │   └── index.ts               # Type exports
    │   └── ports/
    │       ├── AuthPort.ts
    │       ├── DBPort.ts
    │       ├── EmailPort.ts
    │       ├── SmsPort.ts
    │       └── StoragePort.ts
    │
    ├── hooks/                         # React hooks
    │   ├── use-mobile.tsx
    │   └── use-toast.ts
    │
    ├── lib/                           # Utilities
    │   ├── auth.ts                    # Frontend auth utilities
    │   ├── config.ts                  # Frontend configuration (Zod)
    │   ├── db-operations.ts           # Database operations
    │   ├── db.ts                      # IndexedDB implementation
    │   ├── di.ts                      # Dependency injection container
    │   ├── export-utils.ts            # Export utilities
    │   └── utils.ts                   # General utilities
    │
    ├── pages/                         # Route pages
    │   ├── admin/
    │   │   ├── AdminAudit.tsx
    │   │   ├── AdminCustomers.tsx
    │   │   ├── AdminExports.tsx
    │   │   ├── AdminInventory.tsx
    │   │   ├── AdminReports.tsx
    │   │   ├── AdminRoles.tsx
    │   │   ├── AdminServices.tsx
    │   │   ├── AdminSettings.tsx
    │   │   └── Dashboard.tsx
    │   │
    │   ├── Index.tsx
    │   ├── Inventory.tsx
    │   ├── Login.tsx
    │   ├── NotFound.tsx
    │   ├── POS.tsx
    │   ├── Reports.tsx
    │   ├── ServicesPos.tsx
    │   └── Settings.tsx
    │
    ├── App.css
    ├── App.tsx                        # Main React app component
    ├── index.css                      # Global styles
    ├── main.tsx                       # React entry point
    └── vite-env.d.ts                  # Vite type definitions
```

---

## 2. CURRENT STACK IDENTIFICATION

### 2.1 Languages
- **TypeScript** (primary)
  - Frontend: ES2020 target, ESNext modules, React JSX
  - Backend: ES2022 target, CommonJS modules
- **SQL** (migrations)
  - PostgreSQL dialect
  - SQLite dialect
- **YAML** (configuration)
- **CSS** (Tailwind CSS)

### 2.2 Frontend Stack

**Framework & Runtime:**
- **React 18.3.1** (functional components, hooks)
- **Vite 5.4.19** (build tool, dev server)
- **TypeScript 5.8.3** (strict mode disabled in frontend)

**UI Framework:**
- **shadcn/ui** (Radix UI primitives)
- **Tailwind CSS 3.4.17** (utility-first CSS)
- **PostCSS 8.5.6** (CSS processing)
- **Autoprefixer 10.4.21**

**State Management:**
- **TanStack Query 5.83.0** (server state, caching)
- **React Router 6.30.1** (routing)
- **SessionStorage** (auth sessions - client-side)

**Form Handling:**
- **React Hook Form 7.61.1**
- **Zod 3.25.76** (validation)
- **@hookform/resolvers 3.10.0**

**Data Layer:**
- **idb 8.0.3** (IndexedDB wrapper - browser storage)
- **js-yaml 4.1.0** (YAML parsing)

**Utilities:**
- **date-fns 3.6.0** (date manipulation)
- **jspdf 3.0.3** + **jspdf-autotable 5.0.2** (PDF generation)
- **recharts 2.15.4** (charts)
- **bcryptjs 3.0.2** (password hashing - client-side)

**Development Tools:**
- **ESLint 9.32.0** (linting)
- **TypeScript ESLint 8.38.0**
- **@vitejs/plugin-react-swc 3.11.0** (fast React refresh)
- **lovable-tagger 1.1.10** (dev tool - Lovable-specific)

### 2.3 Backend Stack

**Runtime & Framework:**
- **Node.js** (>=18.0.0 required)
- **Express 4.18.2** (web framework)
- **TypeScript 5.3.3** (strict mode enabled)
- **tsx 4.7.0** (TypeScript execution)

**Database:**
- **PostgreSQL** (via `pg` 8.11.3)
- **SQLite** (via `better-sqlite3` 9.2.2)
- **Raw SQL migrations** (no ORM)

**Authentication & Security:**
- **jsonwebtoken 9.0.2** (JWT)
- **bcryptjs 2.4.3** (password hashing)
- **helmet 7.1.0** (security headers)
- **express-rate-limit 7.1.5** (rate limiting)
- **cors 2.8.5** (CORS middleware)

**Validation:**
- **zod 3.22.4** (schema validation)

**Logging:**
- **winston 3.11.0** (structured logging)

**External Services (Adapters):**
- **nodemailer 6.9.7** (SMTP email)
- **twilio 4.20.0** (SMS)
- **@aws-sdk/client-s3 3.478.0** (S3 storage)
- **@azure/storage-blob 12.17.0** (Azure Blob storage)

**Configuration:**
- **dotenv 16.3.1** (environment variables)
- **js-yaml 4.1.0** (YAML parsing)

**Development Tools:**
- **ESLint 8.56.0**
- **@typescript-eslint/parser 6.17.0**
- **@typescript-eslint/eslint-plugin 6.17.0**

### 2.4 Package Managers
- **npm** (primary - `package-lock.json` present)
- **Bun** (lockfile present: `bun.lockb` - binary)
- **Note:** Both lockfiles exist, indicating potential multi-package-manager usage

### 2.5 Build Tools
- **Frontend:** Vite (dev server + production build)
- **Backend:** TypeScript compiler (`tsc`) for production builds
- **CSS:** PostCSS + Tailwind CSS

### 2.6 Database(s)
- **PostgreSQL 16** (via Docker, production-ready)
- **SQLite** (via better-sqlite3, production-ready)
- **IndexedDB** (browser-only, via idb library)

### 2.7 ORM / Data Layer
- **No ORM** - Raw SQL queries via adapters
- **Adapter Pattern** - Database-agnostic interface
- **Migrations:** Manual SQL files (PostgreSQL + SQLite versions)

### 2.8 Auth/Session Approach
- **Frontend:** SessionStorage-based sessions (client-side)
- **Backend:** JWT tokens (Bearer authentication)
- **Password Hashing:** bcrypt (both frontend and backend)
- **Adapters:** Local, Google OAuth, OIDC (Azure AD, Okta)

### 2.9 API Style
- **REST API** (Express routes)
- **JSON** request/response format
- **Standard HTTP methods** (GET, POST, PUT, DELETE)

### 2.10 State Management (Frontend)
- **TanStack Query** (server state, API caching)
- **React Context** (implicit via components)
- **SessionStorage** (auth state persistence)
- **IndexedDB** (local data storage)

### 2.11 Hosting Assumptions

**Current Docker Setup:**
- **Frontend:** Nginx Alpine (static files)
- **Backend:** Node.js (Express server)
- **Database:** PostgreSQL 16 Alpine
- **Storage:** MinIO (S3-compatible)

**Environment Variables:**
- Frontend: `VITE_*` prefix (Vite convention)
- Backend: Standard `NODE_ENV`, `PORT`, `DB_*`, etc.

**Deployment Model:**
- Docker Compose (local + self-host)
- Assumes containerized deployment
- No cloud-specific dependencies (self-hostable)

---

## 3. DEPENDENCY MANIFESTS & LOCKFILES

### 3.1 Root `package.json` (Frontend)

**Runtime Dependencies (67):**
- **UI Libraries:** 30+ Radix UI components
- **React Ecosystem:** React, React DOM, React Router, React Hook Form
- **Data:** TanStack Query, idb, js-yaml
- **Utilities:** date-fns, jspdf, recharts, bcryptjs, zod
- **Styling:** Tailwind CSS utilities, class-variance-authority

**Dev Dependencies (17):**
- **Build:** Vite, TypeScript, PostCSS, Autoprefixer
- **Linting:** ESLint, TypeScript ESLint, React hooks plugins
- **Tools:** lovable-tagger (dev tool)

**Critical/Security-Sensitive:**
- `bcryptjs` (password hashing - client-side is unusual)
- `idb` (IndexedDB - browser storage)
- All Radix UI components (UI security)

### 3.2 Backend `package.json`

**Runtime Dependencies (16):**
- **Core:** express, cors, helmet, express-rate-limit
- **Auth:** jsonwebtoken, bcryptjs
- **Database:** pg, better-sqlite3
- **Validation:** zod
- **Logging:** winston
- **External:** nodemailer, twilio, AWS SDK, Azure SDK
- **Config:** dotenv, js-yaml

**Dev Dependencies (12):**
- **TypeScript:** typescript, tsx
- **Types:** @types/* packages
- **Linting:** eslint, @typescript-eslint/*

**Critical/Security-Sensitive:**
- `jsonwebtoken` (JWT secrets)
- `bcryptjs` (password hashing)
- `pg` (database credentials)
- `better-sqlite3` (file access)
- `twilio` (SMS API keys)
- `@aws-sdk/client-s3` (AWS credentials)
- `@azure/storage-blob` (Azure credentials)

### 3.3 Lockfiles

**package-lock.json:**
- npm lockfile v3
- Frontend dependencies locked
- ~7000+ lines (large dependency tree)

**bun.lockb:**
- Binary Bun lockfile
- Indicates Bun usage (alternative package manager)
- **Note:** Dual lockfiles may cause conflicts

### 3.4 Duplicated/Conflicting Tooling

**Potential Issues:**
1. **Dual Package Managers:** Both npm and Bun lockfiles present
2. **bcryptjs in Frontend:** Unusual - password hashing should be backend-only
3. **Zod Duplication:** Used in both frontend and backend (acceptable)
4. **js-yaml Duplication:** Used in both (acceptable)

**No Conflicts Detected:**
- TypeScript versions compatible
- React versions consistent
- No conflicting framework versions

---

## 4. ARCHITECTURE PATTERNS IDENTIFIED

### 4.1 Clean Architecture (Hexagonal)
- **Core Domain:** `src/core/` (models, ports)
- **Adapters:** `src/adapters/` (implementations)
- **Ports:** Interfaces defined in `src/core/ports/`
- **Dependency Injection:** `src/lib/di.ts` (singleton container)

### 4.2 Separation of Concerns
- **Frontend:** React SPA (client-side routing)
- **Backend:** REST API (Express)
- **Shared:** Port interfaces (but not implementations)

### 4.3 Configuration-Driven
- **YAML config:** `config/default.yml`
- **Environment variables:** `.env` files
- **Zod schemas:** Runtime validation

---

## 5. MISSING/UNCLEAR ELEMENTS

### 5.1 Testing
- **No test files found** (`*.test.*`, `*.spec.*`)
- **No test framework configured** (Jest, Vitest, etc.)
- **No CI/CD pipelines** (no `.github/workflows/`, `.gitlab-ci.yml`, etc.)

### 5.2 Documentation
- **Extensive docs present** (README, CONTRIBUTING, SECURITY, etc.)
- **API documentation:** Not found (no Swagger/OpenAPI)
- **Architecture diagram:** SVG exists but not analyzed

### 5.3 Environment Files
- **Backend:** `env.example` exists
- **Frontend:** No `.env.example` found
- **Docker:** Environment variables in `docker-compose.yml`

### 5.4 Database
- **Migrations:** Present (PostgreSQL + SQLite)
- **Seeds:** Present (via seeder service)
- **No migration tool:** Manual SQL files (no Knex, Prisma, etc.)

---

## 6. KEY OBSERVATIONS

### 6.1 Strengths
1. **Clean Architecture:** Well-structured ports & adapters
2. **Type Safety:** TypeScript throughout
3. **Flexibility:** Multiple adapter options (DB, auth, email, SMS, storage)
4. **Self-Hostable:** No SaaS dependencies required
5. **Docker Ready:** docker-compose.yml present
6. **Security Conscious:** JWT, bcrypt, helmet, rate limiting
7. **Documentation:** Comprehensive docs

### 6.2 Concerns
1. **No Tests:** Zero test files found
2. **Dual Package Managers:** npm + Bun (potential conflicts)
3. **bcryptjs in Frontend:** Security risk (password hashing client-side)
4. **No CI/CD:** No automated testing/deployment
5. **SessionStorage Auth:** Client-side sessions (security consideration)
6. **No API Documentation:** No Swagger/OpenAPI spec
7. **TypeScript Strict Mode:** Disabled in frontend (`strict: false`)

### 6.3 Architecture Decisions
1. **No ORM:** Raw SQL via adapters (flexibility vs. convenience)
2. **Separate Frontend/Backend:** Not a monolith
3. **Adapter Pattern:** Excellent for extensibility
4. **Docker-First:** docker-compose.yml suggests containerized deployment

---

## 7. RUNTIME FLOW (CURRENT STATE)

### 7.1 Development Mode

**Frontend:**
1. Vite dev server starts (`npm run dev`)
2. Serves React app on `http://localhost:8080` (or 5173)
3. Hot module replacement enabled
4. Uses IndexedDB adapter by default (browser storage)

**Backend:**
1. Express server starts (`npm run dev` in `backend/`)
2. Runs on `http://localhost:3001` (or PORT from env)
3. Connects to database (PostgreSQL or SQLite)
4. Runs migrations on startup (if configured)
5. API endpoints available at `/api/*`

**Communication:**
- Frontend → Backend: REST API calls (fetch/axios)
- CORS configured for localhost origins
- JWT tokens in Authorization header

### 7.2 Production Mode (Docker)

**Docker Compose Services:**
1. **postgres:** PostgreSQL 16 Alpine
2. **minio:** MinIO (S3-compatible storage)
3. **app:** Frontend (Nginx serving static files)

**Missing:**
- Backend service not in docker-compose.yml
- Backend must run separately or added to compose

**Flow:**
1. Frontend built via Vite (`npm run build`)
2. Static files copied to Nginx container
3. Nginx serves SPA with routing support
4. Backend runs separately (not containerized in compose)

---

## 8. UNCERTAINTIES & QUESTIONS

1. **Backend Docker:** Why is backend not in docker-compose.yml?
2. **Bun Usage:** Is Bun actively used or just lockfile leftover?
3. **Frontend-Backend Integration:** How does frontend connect to backend in production?
4. **IndexedDB vs Backend:** When does frontend use IndexedDB vs backend API?
5. **bcryptjs Frontend:** Why is password hashing in frontend? (security concern)
6. **Testing Strategy:** What testing approach is planned?
7. **CI/CD:** What CI/CD system is intended?
8. **API Base URL:** How is backend URL configured in frontend?

---

## END OF PHASE 0

**Next Steps:** Proceed to Phase 1 (File-by-File Mapping) after review.

**Status:** ✅ Complete inventory compiled. No design decisions made yet.

