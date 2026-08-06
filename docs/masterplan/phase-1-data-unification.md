# Phase 1 — Data‑Layer Unification (the fork)

> **Status: complete** (2026-08-06). All exit criteria verified — see
> [Completion notes](#completion-notes) at the end for what was found along the way
> and what deliberately did not get done.

**Objective.** Resolve **D1/C5/C4**: make the Express REST API the *only* data source for the
frontend. Remove the client‑side IndexedDB/DI/adapter machinery, standardize the response envelope,
and give the frontend a typed API SDK that every page uses through TanStack Query.

**Entry criteria.** Phase 0 exit criteria green (builds, boots, CI, brand unified).

**Exit criteria.**
- `src/lib/db.ts`, `src/lib/db-operations.ts`, `src/lib/di.ts`, and `src/adapters/**` are deleted.
- No `src/**` file imports `idb`, `@/lib/di`, `@/lib/db`, or `@/lib/db-operations`.
- `apiClient` unwraps `.data` and throws on failure; a typed SDK (`src/lib/api/*`) covers all v1
  resources; shared DTO types live in one place.
- Every page renders from API data via TanStack Query hooks; loading/error/empty states exist.
- Frontend typechecks, builds, and the POS/Inventory pages work against the live backend.

---

### `P1-T1` — Standardize the API envelope client‑side (fixes C4)
**Context.** Backend returns `{success,data}`; `api-client.ts` returns raw `response.json()`, so
callers get the envelope, not the payload — a latent bug across every consumer.
**Files.** `src/lib/api-client.ts`, `src/lib/__tests__/api-client.test.ts`.
**Steps.**
1. Change `handleResponse<T>` to: parse JSON; if `!response.ok` OR `body.success === false`, throw
   `ApiClientError(status, body.error||body.message, body.errors)`; else return `body.data as T`.
2. Add an overload/param for list endpoints that also need `meta` (e.g. `getList<T>` returning
   `{ data: T[], meta }`), or expose `meta` via a second method. Keep it minimal and typed.
3. Centralize 401 handling: on `401`, clear `authStore` and redirect to `/login`.
4. Update/extend the existing test to cover: success unwrap, `success:false` throw, HTTP‑error throw,
   401 side effect.
**Acceptance criteria.** Callers receive `T` (never the envelope); tests cover the four cases.
**Verification.** `npm run test -- src/lib/__tests__/api-client.test.ts --run` passes; typecheck green.

---

### `P1-T2` — Shared DTO types (single source)
**Context.** `src/lib/db.ts` holds the canonical TS interfaces (Product, Variant, Order, etc.); they
must survive its deletion and match the backend JSON.
**Files.** Create `src/lib/api/types.ts` (or extend `src/lib/api-types.ts` — pick one and delete the
other). Reference: backend `migrations/postgres/001_initial_schema.sql` for field truth.
**Steps.**
1. Move the domain interfaces (Product, ProductVariant, Category, Order, OrderItem, Customer,
   Service, User, Role, RolePermissions, Settings, AuditLog, plus Return/Discount DTOs from
   migrations 003/004) into the shared types file. Model money as `number` **dollars** at the DTO
   boundary (backend serializes DECIMAL → number); note in a comment that server compute is in cents.
2. Ensure field names match the API JSON exactly (camelCase in JSON; backend maps snake_case↔camel).
   If the backend currently returns snake_case, standardize on camelCase in the API layer (add a
   mapper in the adapter) and document it.
3. Delete the redundant types file; update imports.
**Acceptance criteria.** One shared types module; no page imports types from `@/lib/db`.
**Verification.** `grep -r "from '@/lib/db'" src` → only (temporarily) non‑type usages remain, to be
removed in P1‑T4/T5. Typecheck green.

---

### `P1-T3` — Typed API SDK per resource
**Context.** Pages should call `productsApi.list()` not hand‑roll fetch paths.
**Files.** Create `src/lib/api/{products,orders,customers,inventory,discounts,returns,receipts,
settings,auth,reports,admin}.ts` and a barrel `src/lib/api/index.ts`. Built on `apiClient`.
**Steps.**
1. For each backend route module, add typed functions mirroring its endpoints, e.g.:
   ```ts
   export const productsApi = {
     list: (q?: ProductQuery) => apiClient.get<Product[]>(`/api/products${qs(q)}`),
     get:  (id: string)       => apiClient.get<Product>(`/api/products/${id}`),
     create: (b: ProductInput)=> apiClient.post<Product>('/api/products', b),
     update: (id, b) => apiClient.put<Product>(`/api/products/${id}`, b),
     remove: (id) => apiClient.delete<void>(`/api/products/${id}`),
   };
   ```
2. Only include endpoints the backend actually exposes (verify against each `routes/*.ts`). Note
   gaps (missing CRUD) for the relevant later phase; do not invent client calls to nonexistent routes.
3. Add a tiny `qs()` querystring helper.
**Acceptance criteria.** Every v1 resource has a typed SDK module; barrel exports them.
**Verification.** Typecheck green; each SDK function's path matches an existing backend route
(cross‑checked in the PR description).

---

### `P1-T4` — TanStack Query hooks + migrate POS & Inventory first
**Context.** POS and Inventory are the highest‑value pages and currently read `@/lib/db`.
**Files.** Create `src/hooks/queries/*.ts`; edit `src/pages/POS.tsx`, `src/pages/Inventory.tsx`,
`src/components/{Cart,ProductCard,VariantPicker,ImportInventoryDialog}.tsx`.
**Steps.**
1. Wrap the SDK in query/mutation hooks: `useProducts()`, `useCreateOrder()`, etc., with sensible
   `queryKey`s and cache invalidation on mutation.
2. Refactor POS and Inventory to use the hooks. Remove all `db`/`db-operations`/`di` imports from
   these files. Add explicit loading/error/empty UI states.
3. Keep the checkout call as `ordersApi.create(intent)` — **but** note that server repricing
   (Phase 3) will change the request shape from "totals" to "intents." For now match the current
   backend contract; Phase 3 updates both sides together.
**Acceptance criteria.** POS and Inventory work end‑to‑end against the live backend (products load;
a sale posts; inventory list renders) with no IndexedDB imports.
**Verification.** With the stack up (P0‑T5), manually complete a sale from `/pos`; the order appears
via `GET /api/orders`. Typecheck + build green.

---

### `P1-T5` — Migrate remaining pages off the client DB  `[parallel-ok per page]`
**Context.** The 15 `admin/*` pages, `Reports`, `Settings`, `ServicesPos`, `Login`, `Setup` must all
move to the SDK.
**Files.** `src/pages/**` (all remaining), `src/components/**` still importing client DB.
**Steps.**
1. Page by page, replace `@/lib/db*`/`@/lib/di` usage with SDK hooks. Services/Quotes pages are
   **deferred** (D2) — keep them compiling but you may render a "Coming soon" placeholder wired to
   real endpoints later; do not spend effort finishing them.
2. `Login` uses `authApi.login` → stores JWT in `authStore`. `Setup` uses `/api/setup/*`.
3. Delete `src/pages/Index.tsx` (dead Lovable boilerplate; `/` routes to `POS`).
**Acceptance criteria.** No `src/**` file imports `@/lib/db`, `@/lib/db-operations`, `@/lib/di`,
or `idb`.
**Verification.** `grep -rE "idb|@/lib/(db|db-operations|di)" src` returns nothing. Build green.

---

### `P1-T6` — Delete the client‑side data layer (completes C5/D1)
**Context.** With all imports gone, remove the dead offline machinery to end the split‑brain.
**Files.** Delete `src/lib/db.ts`, `src/lib/db-operations.ts`, `src/lib/di.ts`, `src/lib/config.ts`
(client adapter config), and the entire `src/adapters/**` tree. Remove `idb` from `package.json`.
**Steps.**
1. Delete the files/folders above. Remove now‑unused deps (`idb`; keep libs still used elsewhere).
2. Run `knip`/`ts-prune` (or `refactor-cleaner` agent) to catch orphaned exports; remove them.
3. Confirm nothing references removed symbols.
**Acceptance criteria.** Client DB layer is gone; frontend builds and runs on the API alone.
**Verification.** `npm run typecheck && npm run build` green; `docker compose up` → POS still works.

---

### `P1-T7` — Vite dev proxy & API base URL hygiene  `[parallel-ok]`
**Context.** `api-client.ts` uses `VITE_API_BASE_URL || ''` to allow a dev proxy; make dev ergonomic.
**Files.** `vite.config.ts`, `docs/reference/environment.md`.
**Steps.**
1. Add a Vite dev `server.proxy` mapping `/api` → `http://localhost:3002` so `VITE_API_BASE_URL`
   can be empty in local dev while remaining absolute in the Docker/prod build.
2. Document the two modes (dev proxy vs built absolute URL) in the env reference.
**Acceptance criteria.** `npm run dev` (frontend) + backend running → pages work with empty base URL.
**Verification.** Start backend + `npm run dev`; POS loads products through the proxy.

---

## Completion notes

**Verified exit criteria** (2026-08-06, against the live Docker stack):

| Criterion | Result |
|---|---|
| `db.ts`, `db-operations.ts`, `di.ts`, `config.ts`, `adapters/**` deleted | ✅ also `src/core/{models,ports}`, orphaned once the adapters went |
| No `src/**` imports `idb` / `@/lib/db*` / `@/lib/di` | ✅ `grep` returns nothing |
| `apiClient` unwraps `.data` and throws; typed SDK; one DTO module | ✅ 15 SDK modules, one per backend route file |
| Every page renders from API data; loading/error/empty states | ⚠️ partial — see below |
| Frontend typechecks, builds, POS/Inventory work against live backend | ✅ a sale posts and decrements stock |

Additionally: **no file under `src/` constructs an API path by hand any more**,
which was not a stated criterion but is what makes the SDK worth having.
`idb` and `bcryptjs` (the latter never used client-side) are out of the bundle.

### Defects found and fixed

Pointing pages at shared types, and checking those types against the running
backend, surfaced five real bugs that were not in the assessment:

1. **`POST /api/orders` returned snake_case items** while `GET` returned
   camelCase, so a client reading the checkout response saw `undefined` for
   every line field. The mapping was inlined at each read site and omitted on
   create; now extracted into `mapOrderItemRow`/`mapOrderRow` in
   `PostgresAdapter` and used by all four paths.
2. **Sales tax was hard-coded to 0** at three separate checkout sites, each with
   its own `const taxRate = 0` and a TODO, while `taxRateDefault` sat in settings
   the page already fetched.
3. **Receipt filters were ignored.** AdminReceipts sent `query`/`startDate`/
   `endDate`/`paymentMethod` to `/api/receipts`, which reads only `limit` and
   `offset`. Filtering lives on `/api/receipts/search`.
4. **A `free_shipping` promo would apply as $0 off** — the register wrote any
   validated promo's kind into state that only models percentage/fixed, and the
   server returns 0 for the other kinds.
5. **Loading state was computed but never rendered** on POS and Inventory, so a
   slow or failed catalog load displayed "No products yet".

Several shared DTOs carried over from `db.ts` were also wrong against the API:
`Service.unitType` (`per-item` vs the real `per_item`, missing `daily`),
`Quote`/`QuoteItem` (offline shapes, missing two status values the UI renders),
and `ValidatePromoResponse`.

### Deliberately not done

- **Only POS and Inventory use TanStack Query hooks.** The admin pages call the
  SDK from `useEffect` + `useState`. They are correct and typed, but do not get
  caching or shared invalidation. Converting them is mechanical and independent
  — worth doing, but it is not what blocks go-live.
- **`strictNullChecks` is off**, so the `null`-vs-`undefined` gap between the
  API's JSON and the `?:` fields in `src/lib/api/types.ts` is invisible to the
  compiler. Documented at the top of that module; tightening it is Phase 7.
- **No route is protected.** Every `/admin/*` path renders for an anonymous
  visitor; data is safe only because the API 401s and `apiClient` redirects to
  `/login`. That is incidental, not by design — Phase 2 owns it.
- **Variant-level catalog edits have no endpoint.** `PUT /api/products/:id`
  takes no variants, so CSV import cannot apply variant changes to an existing
  product; it reports the skipped count instead of dropping them silently.
  Phase 4 owns the endpoint.
