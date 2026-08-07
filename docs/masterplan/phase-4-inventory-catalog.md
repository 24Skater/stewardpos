# Phase 4 — Inventory & Catalog

**Objective.** Complete product/variant/category management: full CRUD, barcode support, product
images via MinIO/S3, CSV import/export, and low‑stock signals — all org‑scoped and RBAC‑gated. This
is what stocks the POS built in Phase 3.

**Entry criteria.** Phase 3 green (checkout decrements real stock).

**Exit criteria.**
- Products, variants, and categories have full CRUD via API + admin UI, org‑scoped and permissioned.
- Barcode lookup resolves a product/variant at the register.
- Product images upload to MinIO and render.
- CSV import (upsert) and export round‑trip cleanly with a documented column spec.
- Low‑stock threshold produces a visible signal.

---

### `P4-T1` — Product & variant CRUD (API)
**Context.** `products.ts` exists; ensure complete, validated, org‑scoped CRUD including variants.
**Files.** `backend/src/api/routes/products.ts`, DB adapter, shared types, `src/lib/api/products.ts`.
**Steps.**
1. Endpoints: `GET /` (list w/ pagination + `?q=` search + `?category=` filter), `GET /:id`,
   `POST /`, `PUT /:id`, `DELETE /:id` (soft delete or block if referenced by orders — pick and
   document), plus variant sub‑resources (`POST/PUT/DELETE /:id/variants[/:variantId]`).
2. Zod‑validate all inputs; `authorize('inventory', …)`; set/filter `org_id`.
3. Search: name + barcode + sku, case‑insensitive, paginated.
**Acceptance criteria.** CRUD works with validation, RBAC, pagination, and search.
**Verification.** Integration tests for each endpoint (happy + validation + RBAC). `npm run test`.

---

### `P4-T2` — Categories CRUD  `[parallel-ok]`
**Files.** `backend/src/api/routes/products.ts` or a new `categories.ts`; `AdminInventory.tsx`.
**Steps.** CRUD for `categories` (name unique per org, optional icon); prevent deleting a category in
use (or reassign). Wire the admin UI category picker.
**Acceptance criteria.** Categories manageable; products reference valid categories.
**Verification.** Create/rename/delete category via API; deletion of an in‑use category is blocked.

---

### `P4-T3` — Product images via MinIO/S3
**Context.** `upload.ts` route + `minio` dep + Compose MinIO service exist; wire uploads.
**Files.** `backend/src/api/routes/upload.ts`, a storage service using `minio`, `products.ts`
(store returned URL/key), `AdminInventory.tsx` image uploader, `docs/reference/environment.md`.
**Steps.**
1. `POST /api/upload` (multer, size/type limits: images only, ≤5MB) → stream to the MinIO bucket
   (`MINIO_BUCKET`) → return a stable public URL (`MINIO_PUBLIC_HOST`) or object key.
2. Store the key on the product; serve via the public host (or a signed URL if the bucket is private
   — pick and document). Ensure the bucket is created on boot if missing.
3. Frontend: upload widget with preview; product card renders the image.
**Acceptance criteria.** Uploading an image persists it in MinIO and renders on the product.
**Verification.** With the stack up, upload an image → it appears in MinIO console and on the product
card after reload.

---

### `P4-T4` — CSV import / export
**Context.** `xlsx` (frontend) + README claim CSV import/export; make it real and safe.
**Files.** `src/components/ImportInventoryDialog.tsx`, `src/lib/export-utils.ts`, backend
`products.ts` bulk‑upsert endpoint, `docs/guides/inventory-import.md`.
**Steps.**
1. Define and document the CSV column spec (name, description, category, base_price, barcode, and
   variant columns: size, color, sku, variant_barcode, price_override/price_delta, stock, enabled).
2. Export: `GET /api/products/export.csv` (or client‑side from fetched data) producing the exact spec.
3. Import: client parses + validates rows (zod), shows a preview with per‑row errors, then calls a
   backend **bulk‑upsert** endpoint that runs in a transaction (match on barcode/sku or name+variant).
   Reject the whole file on structural errors; report per‑row skips for soft errors.
4. Money parsed as decimal → cents server‑side.
**Acceptance criteria.** Export then re‑import is idempotent; malformed files are rejected clearly.
**Verification.** Export current catalog → modify a price → re‑import → the change applies and no
duplicates are created.

---

### `P4-T5` — Low‑stock signal  `[parallel-ok]`
**Files.** `product_variants` (add `low_stock_threshold` via a small migration, default null),
`products.ts` (`GET /api/products/low-stock`), `AdminInventory.tsx`, POS/dashboard badge.
**Steps.** Add an optional per‑variant threshold; an endpoint listing variants at/below threshold;
surface a count badge in admin and a filter in the inventory list.
**Acceptance criteria.** Variants below threshold are listed and badged.
**Verification.** Set a threshold above current stock → the variant appears in low‑stock results.

---

### `P4-T6` — Inventory admin UX polish  `[parallel-ok]`
**Files.** `src/pages/admin/AdminInventory.tsx`, `src/pages/Inventory.tsx`, related components.
**Steps.** Ensure list/table has search, category filter, pagination, create/edit dialogs with RHF +
zod, optimistic updates via TanStack Query, and proper loading/empty/error states. No `@/lib/db`
imports (Phase 1 invariant). Follow the design‑quality rules (no default‑template look).
**Acceptance criteria.** Inventory management is usable end‑to‑end from the UI.
**Verification.** Manual: create a product with two variants + image, edit price, delete — all reflect
immediately without a full reload.


---

## Progress notes (2026-08-07)

**P4-T1's variant sub-resources are done**, ahead of the rest of the phase,
because their absence had a visible consequence: `POST /api/products` accepted
nested variants but `PUT` accepted none, so a product's options were fixed at
creation. A shop could not add a size or correct a stock count without
recreating the product, and CSV re-import — the ordinary way a shop restocks —
had to drop every variant row on anything already in the catalog and say so.

`POST/PUT/DELETE /api/products/:id/variants[/:variantId]` now exist,
`inventory`-permissioned with delete separated from write. The update path
COALESCEs, so correcting a stock count does not blank the size or SKU. Deleting
a product's **last** variant is refused: a product with no variants cannot be
sold and there is no separate "unsellable" state, so it would be stranded —
disable it instead.

CSV import applies variant rows to existing products, matching on SKU, then
barcode, then the size/colour pair, since a CSV carries no variant id. Verified
in a browser: re-importing took a product's stock from 3 to 99 and added a
second variant.

**Search, filtering, paging, and barcode lookup are also done.**
`GET /api/products` takes `q` (name, product barcode, and variant SKU/barcode,
case-insensitively), `category`, `limit`, and `offset`, and always reports a
`total` in `meta`. `data` stays a bare array so no existing caller changed.

Paging is **opt-in with no default cap**, which is a deliberate choice rather
than an oversight: capping by default would drop products off the end of the
register with nothing to indicate it, so a truncated response would present as a
missing product. A default belongs with a register that actually pages.

`GET /api/products/barcode/:code` resolves a scan to a product *and the variant
it names*, so scanning the large size adds the large size. It requires an exact
match — the underlying search is a substring one, and `123` must not ring up an
item barcoded `1234`. It is declared before `/:id` so a scan is not mistaken for
a product id.

**Low-stock signals are done.** `GET /api/products/low-stock` returns the
variants at or below their threshold, worst shortfall first, with the product
they belong to.

The threshold is per-variant with a store-wide fallback, because what counts as
low differs by item — two wedding cakes is a lot where two rolls of receipt
paper is nearly none — and because a shop can be out of Large while Small is
fine. Disabled variants are excluded: they are not for sale, so they cannot run
out, and including them buries real shortages under discontinued ones.

The store default lives in `settings.config.lowStockThreshold` and is validated
on write rather than defended against on read, so a store that saves `"5"` is
told why nothing changed. A configured **0** is honoured as a real policy
("tell me only when it is actually gone") rather than being read as unset.

Two admin screens had each decided for themselves that low meant under 10, by
scanning the whole downloaded catalog. Both now ask the server, so they cannot
disagree, and raising the store threshold moves both together.

**Categories (P4-T2) are done.** `/api/categories` supports list, create,
rename, and delete. The `categories` table already existed and was seeded, but
nothing could reach it — there was no endpoint, and the admin category field was
free text, so a shop could only "create" a category by typing it and a typo
silently produced a second one no product would ever share.

`products.category` still stores the category **name**, not a foreign key. That
was the existing schema, and converting it would mean backfilling every product
whose category was typed rather than picked, then rewriting the catalog filter,
the CSV import, and the exports. The cost of leaving it is that the two must be
kept in step deliberately:

- **Renaming carries the products with it**, in one transaction. Renaming the
  row alone would leave every product in it naming something that no longer
  exists — they would drop out of the category filter while still claiming
  membership. The response reports how many moved.
- **Deleting an in-use category is refused**, with the count in the message,
  since moving two products is a different proposition from moving two hundred.
  `?reassignTo=` moves them to another *existing* category first; an unknown
  destination is refused, because it would strand them just as thoroughly.
- Names are unique **case-insensitively**. "drinks" beside "Drinks" is a typo,
  not two categories, and their products would never appear together.

The list also reports `meta.unmanaged`: names products use that no category row
defines. Without it a product stranded by an old import sits in a category the
manager cannot see and therefore cannot fix. They stay out of `data` because
they have no id and nothing can act on them directly. The admin picker offers
them anyway, and always includes the edited product's own value, so saving an
unrelated change cannot silently reassign it.

**Still open for this phase:** product images through MinIO. The register still filters its loaded catalog
client-side rather than using the search endpoint — fine while a catalog fits in
a page, and the endpoint is there when it does not.
