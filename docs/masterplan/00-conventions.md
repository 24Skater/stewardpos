# Global Conventions & Definition of Done

These rules apply to **every** task in every phase. When a task is silent on a detail, the answer is
here. Read this once, fully, before executing any phase.

---

## 1. Repository layout

```
/                      Frontend (Vite React app)
  src/                 Frontend source
    lib/api/           NEW: typed API SDK (Phase 1)
    lib/api-client.ts  Low-level fetch wrapper (kept, standardized in Phase 1)
  backend/             Express API
    src/api/routes/    Route modules (one per resource)
    src/services/      DB service, migrator, seeder
    src/adapters/db/   PostgresAdapter, SQLiteAdapter
    src/terminal/      Payment terminal adapters (TerminalPort)
    migrations/        postgres/ and sqlite/ (kept in lock-step)
  docs/                All human + agent documentation
    masterplan/        THIS plan
```

## 2. Tech stack (do not swap without a plan amendment)

- **Frontend:** Vite 5, React 18, TypeScript 5, shadcn/ui, Tailwind v4, TanStack Query 5,
  react-router-dom 6, react-hook-form + zod. `@steward-apps/{ui,tokens,icons}` design system.
- **Backend:** Node ≥18, Express 4, TypeScript 5, `pg` (Postgres 16) + `better-sqlite3` (dev/test),
  `zod`, `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, `winston`, `multer`, `minio`,
  `stripe`. Test with `vitest` + `supertest`.
- **DB:** PostgreSQL 16 in production; SQLite for local dev/tests only.
- **Object storage:** MinIO (S3-compatible) in Compose; any S3 in cloud.

## 3. API contract (canonical)

### 3.1 Response envelope — ALL endpoints
```ts
// success
{ "success": true, "data": <T>, "meta"?: { total: number, page: number, limit: number } }
// failure
{ "success": false, "error": "<human message>", "errors"?: { "<field>": ["<msg>"] } }
```
- List endpoints that paginate MUST return `meta`. Default `limit=50`, max `200`.
- HTTP status codes are meaningful: `200/201` success, `400` validation, `401` unauthenticated,
  `403` unauthorized, `404` missing, `409` conflict, `422` business-rule rejection, `500` server.

### 3.2 Frontend client (standardized in Phase 1)
`apiClient.get/post/put/delete` MUST unwrap `.data` and throw `ApiClientError` when
`response.ok === false` OR `body.success === false`. Callers receive `T`, never the envelope.

### 3.3 Route file shape (every resource route)
```ts
const router = Router();
router.use(authenticate);                 // unless explicitly public (health, setup, login)
router.get('/',  authorize('inventory','read'),  handler);
router.post('/', authorize('inventory','write'), validate(schema), handler);
```
- Validate every body/query/params with a **Zod schema** at the boundary. Never trust input.
- Handlers are thin; business logic lives in a service/use-case function that is unit-testable.

## 4. Money (CRITICAL — see D7)

- Compute all currency in **integer cents** on the server. Convert to/from `DECIMAL(10,2)` only at
  the storage/serialization boundary. Never do `+ - * /` on floating `number` dollars for totals.
- The **server is authoritative**. On checkout/return, the client sends *intents*
  (`productId`, `variantId`, `quantity`, requested discount id/code) — **never trusted prices**.
  The server looks up current prices, applies tax and discount rules, and computes every total.
  Client-sent `total`/`unitPrice` are ignored (may be used only to *warn* on mismatch).
- Tax: `settings.tax_rate_default` (DECIMAL(5,4)) unless a per-item override exists. Round per the
  documented rule: round the **tax total** half-up to the cent after summing the taxable base.

## 5. Auth & RBAC

- JWT bearer tokens (`Authorization: Bearer <jwt>`), signed with `JWT_SECRET` (≥32 chars, required;
  boot fails without it). Token payload: `{ sub: userId, orgId, roles: string[] }`.
- `authenticate` middleware verifies the token, loads the user, attaches `req.user`.
- `authorize(resource, action)` checks the user's aggregated role permissions
  (`RolePermissions` JSONB) for `{ read | write | delete }` on the resource.
- Public routes (no `authenticate`): `GET /api/health`, `/api/setup/*` (only until setup completes),
  `POST /api/auth/login`. **Everything else is protected.** No exceptions in v1.
- Passwords: bcrypt, `BCRYPT_ROUNDS` (default 12 for production).

## 6. Multi-tenant-ready (D4)

- Every tenant-scoped table gets a **nullable** `org_id UUID` column (Phase 2). A single default org
  is seeded; its id is injected as `req.orgId` (from the JWT, falling back to the default org).
- All queries that read/write tenant data filter/set `org_id`. Writing this now (even single-tenant)
  is cheap; retrofitting later is not.

## 7. Testing gates

- **Unit** (vitest): pure functions, pricing, validators, adapters (mocked DB).
- **Integration** (vitest + supertest): each route with a real SQLite test DB, auth on/off, RBAC,
  validation failures, happy path.
- **E2E** (Playwright): the critical cashier flow (Phase 7) + returns.
- **Coverage:** ≥80% lines on **money/checkout/returns/discounts** modules is a hard merge gate.
  Elsewhere, add tests for every bug fixed and every new endpoint. Do not chase 80% on generated UI.
- Every task's *Verification* block must pass before the task is "done."

## 8. Code quality (from repo rules)

- Files ≤ 800 lines; functions ≤ 50 lines; nesting ≤ 4 — refactor when exceeded.
- No `console.log` in committed code (use `logger`). No `any` in new/changed code (`unknown` +
  narrow). Explicit types on exported functions. Immutable updates (spread, no in-place mutation).
- Handle errors explicitly; never swallow. User-facing messages are friendly; logs carry detail.
- No hardcoded secrets. Config comes from env, validated at boot (backend `config/index.ts`).

## 9. Git & PR workflow

- Branch per task: `feat/pN-tM-short-slug` (or `fix/…`, `chore/…`, `refactor/…`).
- Conventional commits: `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `test: …`, `chore: …`.
- One PR per task (or per small cluster of `[parallel-ok]` tasks). PR body: what/why, the task ID,
  and pasted verification output. Do not merge with red CI.
- Never commit `.env`, `*.db`, `uploads/`, `logs/`, or `node_modules`.

## 10. Per-task template (how each task is specified)

Every task in a phase file uses this shape:

> ### `P<phase>-T<n>` — Title  `[parallel-ok?]`
> **Context.** Why this exists / what's currently wrong.
> **Files.** Exact paths to create/edit/delete.
> **Steps.** Ordered, concrete implementation steps.
> **Acceptance criteria.** Observable, checkable outcomes.
> **Verification.** Exact commands to run + expected result.

## 11. Standard verification commands

```bash
# Frontend (repo root)
npm run typecheck && npm run lint && npm run test && npm run build

# Backend
cd backend && npm run typecheck && npm run lint && npm run test

# Full stack via Docker (from repo root)
docker compose up -d --build && docker compose ps   # all healthy
curl -fsS http://localhost:3002/api/health          # {"success":true,...}

# E2E (Phase 7+)
npm run test:e2e
```
A task is **not done** until its verification output is green and pasted into the PR.
