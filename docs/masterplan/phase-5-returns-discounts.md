# Phase 5 — Returns/Refunds & Discounts/Promotions

**Objective.** Deliver the two selected v1 modules (**D2**). Returns/refunds must be as correct and
transactional as sales (they move money and stock in reverse). Discounts/promotions must be applied
**server‑side** through the Phase 3 pricing engine — never trusted from the client.

**Entry criteria.** Phase 3 green (transactional, repriced checkout). Migrations `003_returns_refunds`
and `004_discounts_promotions` already define base tables — verify and extend, don't duplicate.

**Exit criteria.**
- A cashier can look up a sale by receipt/order number, select items to return, choose a refund
  method, and complete a **transactional** refund that optionally restocks — with the order status
  updated (`refunded`/`partially_refunded`) and an audit trail.
- Discounts (manual %/amount, promo codes, quick buttons) validate and apply through `pricing.ts`,
  with limits/approval enforced server‑side; usage is tracked.

---

## Returns / Refunds

### `P5-T1` — Reconcile the returns schema
**Files.** Review `migrations/{postgres,sqlite}/003_returns_refunds.sql`; add a delta migration if it
lacks: `org_id`, link to original `order_id`/`order_item_id`, `refund_method`, `restocked` flag,
`reason`, `user_id`, `status`.
**Steps.** Ensure a `returns` (header) + `return_items` (lines) shape referencing the original order.
Add missing columns via a new migration (never edit shipped migrations).
**Acceptance criteria.** Returns tables can represent a partial, multi‑line refund tied to an order.
**Verification.** Migration applies on both DBs; a unit test inserts a return with 2 lines.

### `P5-T2` — Return lookup + eligibility (API)
**Files.** `backend/src/api/routes/returns.ts`, `src/lib/api/returns.ts`, `AdminReturns.tsx`,
POS "Quick return".
**Steps.**
1. `GET /api/returns/lookup?orderNumber=` or `/receipt/:id` → returns the original order with
   per‑line already‑returned quantities so the UI can cap selectable amounts.
2. Eligibility rules (document them): within a return window? already fully refunded? Reject clearly.
**Acceptance criteria.** Lookup returns remaining‑returnable quantities per line.
**Verification.** Integration test: an order with 1 line qty 3, one prior return of 1 → lookup shows 2
returnable.

### `P5-T3` — Transactional refund + restock
**Files.** `returns.ts`, DB adapter (`createReturnTransaction`), pricing/refund service.
**Steps.**
1. `POST /api/returns` with `{ orderId, items:[{orderItemId, quantity}], refundMethod, restock,
   reason }`. Server recomputes refund amount in cents from the **original persisted** line prices
   (never client‑supplied), capped at remaining‑returnable.
2. In a DB transaction: insert `returns` + `return_items`; if `restock`, increment
   `product_variants.stock`; create a negative `payments`/refund record; update the order `status`
   to `refunded`/`partially_refunded`. Commit. Emit audit.
3. For card refunds on Stripe, issue the refund via the Stripe adapter and record the refund id;
   cash refunds affect the drawer session.
**Acceptance criteria.** Refund amount is server‑authoritative and capped; restock and status updates
are atomic; over‑refund is impossible.
**Verification.** Integration tests: full refund → status `refunded` + stock restored; partial →
`partially_refunded`; attempt to over‑refund → rejected. `npm run test -- returns --run` green.

### `P5-T4` — Returns UI (admin + quick POS return)  `[parallel-ok]`
**Files.** `src/pages/admin/AdminReturns.tsx`, POS return entry, `Receipt.tsx` (refund receipt).
**Steps.** Lookup → select items/quantities → choose refund method + restock → confirm → refund
receipt. Loading/error states; RBAC (`returns.write`).
**Acceptance criteria.** A manager completes a return from the UI with a refund receipt.
**Verification.** Manual end‑to‑end return against a real prior sale.

---

## Discounts / Promotions

### `P5-T5` — Reconcile the discounts schema  `[parallel-ok]`
**Files.** Review `004_discounts_promotions.sql`; delta migration for missing: `org_id`, `type`
(`percent|amount`), `value`, `code` (nullable, unique per org when set), `scope` (`order|line`),
`min_subtotal`, `max_uses`, `used_count`, `requires_approval`, `active`, `starts_at`/`ends_at`.
**Acceptance criteria.** Table can express quick discounts, promo codes, and employee/manual
discounts with limits.
**Verification.** Migration applies both DBs; seed a sample percent code + amount code.

### `P5-T6` — Discount validation + application in the pricing engine (server‑authoritative)
**Context.** Discounts change money, so they run inside `pricing.ts` (Phase 3), not in the route.
**Files.** `backend/src/services/pricing.ts`, `backend/src/api/routes/discounts.ts`,
`src/lib/api/discounts.ts`.
**Steps.**
1. `pricing.ts` accepts `discountCode?` and per‑line `requestedLineDiscountId?`; it **looks up** the
   discount, checks validity (active, date window, `min_subtotal`, `max_uses`, scope), and applies it
   in cents. Invalid/expired/over‑used → structured rejection (the sale isn't silently full‑price).
2. Manual discounts above a threshold set `requires_approval`; the order can't complete without an
   approver token/permission (`authorize('discounts','write')` on the approval action).
3. On successful order creation, increment the discount `used_count` **within the order transaction**.
**Acceptance criteria.** Discounts only ever reduce price via server logic; limits/approval enforced;
usage counted atomically with the sale.
**Verification.** Integration tests: valid code reduces total correctly; expired/over‑used code
rejected; manual discount over threshold blocked without approval; `used_count` increments once per
sale (and rolls back if the sale rolls back).

### `P5-T7` — Discount management + POS application UI  `[parallel-ok]`
**Files.** `src/pages/admin/AdminDiscounts.tsx`, POS discount buttons/dialog, `Cart.tsx`.
**Steps.** Admin CRUD for discounts/codes with limits and approval flags; POS shows quick‑discount
buttons and a promo‑code field that calls the server (the server returns the repriced order). The UI
never computes the discounted total itself.
**Acceptance criteria.** Cashier applies a code/quick discount; totals come back from the server.
**Verification.** Manual: apply a 10% code at POS → server‑returned total reflects it; remove →
reverts.


---

## Note (2026-08-07): returns were repriced ahead of this phase

Found while auditing the money paths in Phase 3, and fixed there because it was
the same class of hole in the more dangerous direction — a sale mispriced
downwards costs margin, a refund mispriced upwards hands over cash.

`POST /api/returns` fetched the original order only to check it existed, then
stored whatever line prices and totals the request supplied. `process-refund`
then used the client's `amount` with no upper bound. Verified end to end: a $1
order produced a **$99,999 cash refund**, and would equally have minted a store
credit for it.

`repriceReturn` now prices a return from the order it came from:

- line prices come from what the customer actually paid, not the request and not
  today's catalog price
- quantities are bounded by what was sold minus what earlier returns already
  took; a pending return counts, so the same item cannot be submitted twice
  while the first awaits approval, while a rejected one does not
- tax is apportioned by share of the order's subtotal, so a partial return gets
  back the tax that was actually charged rather than today's rate
- a restocking fee cannot push a refund negative
- `process-refund` caps `amount` at the return's total

Restocking was also gated on approval, matching the refund path. It had none, so
a **pending** return put goods back into sellable stock on the say-so of whoever
filed it — for an item that may never have physically come back. (The underlying
adapter was already idempotent: it only touches rows still flagged
`restocked = false`, so a repeated call adds nothing. The gap was the missing
status check, not double-counting.)

Store credit is now redeemable: `GET /api/store-credits/:code` reports the
balance and `POST /api/store-credits/:code/redeem` spends part or all of it,
refusing in a single conditional UPDATE so two registers cannot spend the same
code. Partial redemption leaves the credit active; spending the balance flips it
to `used`. What remains is wiring it into checkout as a *tender* — it reduces
what is owed rather than what is charged, so it belongs with split tender
(P3-T2) and must not be modelled as a discount, which would understate revenue.

Still open for this phase: exchanges (`returnType: 'exchange'`) are accepted but
priced as a plain return.
