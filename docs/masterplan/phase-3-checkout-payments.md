# Phase 3 — Checkout & Payments (the money path)

**Objective.** Deliver a **correct, transactional, secure** sale. Fix **C1/C2/C8**: server reprices
every sale in integer cents, order creation is atomic and decrements stock, and v1 tenders (cash +
Stripe Terminal) work end‑to‑end with split tender, change calculation, cash‑drawer sessions, and
branded receipts. This is the highest‑risk phase — bar for correctness and tests is highest here.

**Entry criteria.** Phase 2 green (auth/RBAC enforced, org_id present).

**Exit criteria.**
- `POST /api/orders` ignores client prices, reprices from DB in cents, applies tax + discounts,
  wraps order+items+stock decrement (+payment rows) in one DB transaction, and rejects on
  insufficient stock or price/stock drift.
- Cash (with change) and Stripe Terminal card payments both complete a real sale; split tender works.
- A cash‑drawer session (open/close with expected vs counted) exists.
- A branded receipt can be printed and emailed. ≥80% coverage on checkout modules.

---

### `P3-T1` — Payments/tender schema (C7)
**Context.** `orders.payment_method` is a single varchar; no tender breakdown, no `user_id`, no order
number/status, no cash‑drawer session. Returns (Phase 5) also need this.
**Files.** New migration `00X_payments_tender.sql` (postgres + sqlite); DB adapter; shared types.
**Steps.**
1. Add to `orders`: `order_number` (human sequential per org), `user_id` (cashier),
   `status` (`completed|voided|refunded|partially_refunded`), `amount_tendered`, `change_given`,
   `terminal_id`/`card_transaction_id`/`card_auth_code` (already partly present via terminal txns).
2. New `payments` table: `id, order_id, org_id, method('cash'|'card'|'other'), amount, reference,
   terminal_transaction_id, created_at`. An order has 1..n payments (split tender).
3. New `cash_drawer_sessions` table: `id, org_id, user_id, opened_at, opening_float, closed_at,
   expected_cash, counted_cash, variance, status`.
4. Keep `payment_method` on `orders` as a denormalized summary for existing reads, or drop it and
   update readers — pick one and update all consumers + tests.
**Acceptance criteria.** Migration applies on both DBs; types updated; adapter can insert an order
with multiple payment rows.
**Verification.** Migration up/down clean; a unit test inserts an order + 2 payments and reads back.

---

### `P3-T2` — Server‑side pricing engine (fixes C1/C8)
**Context.** The server must be the sole authority on money, computed in integer cents.
**Files.** New `backend/src/services/pricing.ts` (pure, unit‑tested); used by orders + returns +
quotes. Do **not** put math in the route handler.
**Steps.**
1. Input: an *intent* — `{ items: [{ productId, variantId?, quantity, requestedLineDiscountId? }],
   discountCode?, taxExempt? }` + org context. Output: fully priced order in cents with a per‑line
   breakdown and grand totals.
2. Look up current `base_price` + variant `price_override`/`price_delta` from the DB (never trust
   client prices). Compute `unitPrice`, `lineDiscount` (from validated discount rules — Phase 5),
   `lineTotal`, `subtotal`, `discountTotal`, `taxTotal` (apply `settings.tax_rate_default` to the
   taxable base, round half‑up to the cent), and `total`. All in integer cents.
3. Validate stock availability per line; return a structured rejection if any line exceeds stock.
4. Provide a `priceOrder(intent): PricedOrder` function and a `centsToDecimal`/`decimalToCents` pair.
**Acceptance criteria.** Deterministic pricing in cents; exhaustive unit tests (rounding edges,
multi‑line, variant pricing, discounts, tax exemption, insufficient stock).
**Verification.** `cd backend && npm run test -- pricing --run` green with ≥90% coverage on this file.

---

### `P3-T3` — Transactional order creation with stock decrement (fixes C2)
**Context.** Current `POST /api/orders` trusts client totals and never touches stock — must be
replaced with a repriced, atomic flow.
**Files.** `backend/src/api/routes/orders.ts`, DB adapter (`createOrderTransaction`),
`backend/src/services/pricing.ts`, order create service.
**Steps.**
1. Rewrite the create schema to accept **intents + tender**, not trusted totals:
   `{ items:[{productId,variantId,quantity}], payments:[{method,amount,reference?}],
   discountCode?, customerEmail?, customerPhone?, cashTendered? }`.
2. Handler: `priceOrder(intent)` → verify `sum(payments) >= total` (compute change for cash) →
   open a **DB transaction**:
   - re‑check + decrement `product_variants.stock` per line (row lock / `... WHERE stock >= qty`);
     if any decrement affects 0 rows → rollback → `409/422` "insufficient stock".
   - insert `orders` (with repriced totals, `order_number`, `user_id`, `org_id`, `status=completed`),
     `order_items`, and `payments` rows.
   - if a card payment, link the terminal transaction (existing
     `updateTerminalTransactionByChargeId`).
   - commit.
3. Return the persisted, server‑priced order (+ change due) in the standard envelope.
4. Emit an audit row (P2‑T7).
**Acceptance criteria.** Client‑sent prices are ignored; concurrent oversell is impossible; partial
failures roll back fully (no orphan order/items/stock).
**Verification.** Integration tests: (a) tampered client price → server price wins; (b) two
concurrent orders for the last unit → exactly one succeeds; (c) forced mid‑transaction error →
no rows persisted. `npm run test -- orders --run` green.

---

### `P3-T4` — Cash tender: change + drawer session
**Context.** Cash is the primary tender for churches; needs change math and a drawer session.
**Files.** `orders.ts` (cash path), new `backend/src/api/routes/drawer.ts`, frontend
`src/pages/POS.tsx` + a `CashPaymentDialog` + `DrawerSession` UI.
**Steps.**
1. Backend: endpoints to open a drawer session (with opening float), get the current open session,
   and close it (enter counted cash → compute expected vs counted variance). All org+user scoped.
2. Checkout cash path: accept `cashTendered`; server computes `change = tendered - total`; reject if
   `tendered < total`. Record `amount_tendered`/`change_given` and a `payments` row `method='cash'`.
3. Frontend: a cash dialog with quick‑cash buttons and change display; a drawer open/close screen.
**Acceptance criteria.** Cash sale computes correct change; drawer session tracks expected vs counted.
**Verification.** Integration test: tender > total → correct change + payment row; tender < total →
422. Manual: open drawer, ring cash sales, close drawer → variance correct.

---

### `P3-T5` — Stripe Terminal card payment (D3, live path)
**Context.** `StripeTerminalAdapter` + `TerminalPort` + `terminal.ts` route exist; wire the real,
tested flow. Other adapters stay behind a flag (P3‑T6).
**Files.** `backend/src/terminal/StripeTerminalAdapter.ts`, `TerminalAdapterFactory.ts`,
`backend/src/api/routes/terminal.ts`, `orders.ts` (card path), frontend POS card flow,
`docs/reference/environment.md` (Stripe vars).
**Steps.**
1. Config: `STRIPE_SECRET_KEY`, `STRIPE_TERMINAL_LOCATION`, terminal selection. Validate at boot when
   the Stripe terminal is enabled.
2. Implement the connection‑token → payment‑intent → capture flow via `terminal.ts`:
   create a PaymentIntent for the priced order total, collect via the reader, capture, and return a
   `card_transaction_id` + `auth_code`. Handle decline/timeout/cancel with clear errors.
3. Checkout card path: the order's card `payments` row references the captured PaymentIntent; the
   terminal transaction is linked to the order (existing linkage code). **Never** finalize the order
   until capture succeeds; on capture failure, do not create the order (or void it atomically).
4. Frontend: a card dialog showing "insert/tap on reader", live status, and success/decline.
**Acceptance criteria.** A real Stripe **test‑mode** terminal payment completes a sale end‑to‑end;
declines don't create phantom orders.
**Verification.** Against Stripe test mode + the Terminal simulator: complete a card sale; the order,
payment row, and Stripe PaymentIntent all reconcile. Decline → no order created.

---

### `P3-T6` — Gate the non‑v1 terminals behind a feature flag (D3)  `[parallel-ok]`
**Context.** Square/Clover/Verifone/Dejavoo adapters exist but are uncertified for v1.
**Files.** `TerminalAdapterFactory.ts`, `terminal.ts`, config, `docs/reference/payments.md`.
**Steps.**
1. Add `PAYMENT_TERMINAL=manual|stripe` (default) and an allow‑list; the factory throws a clear
   "not enabled in v1" error for others. Keep their code compiled and unit‑tested but unreachable.
2. Document in `docs/reference/payments.md`: v1 supports manual + Stripe; others are experimental and
   require future certification (list what each needs: hardware, PSP account, test matrix).
**Acceptance criteria.** Only `manual` and `stripe` are selectable at runtime; others error clearly.
**Verification.** Setting `PAYMENT_TERMINAL=square` → boot/route returns a clear "not enabled" error;
`stripe`/`manual` work.

---

### `P3-T7` — Receipts: generate, print, email (branded)
**Context.** `receipts.ts` route + `Receipt.tsx` + `jspdf` exist; wire to real orders + branding.
**Files.** `backend/src/api/routes/receipts.ts`, `src/components/Receipt.tsx`, email adapter,
branding settings (Phase 6 provides the config UI; here consume it).
**Steps.**
1. Build a receipt from a persisted order: store identity + logo (from settings), line items,
   discounts, tax, tenders, change, timestamp, order number, and footer message.
2. Print: a print‑optimized receipt view (frontend) and/or a server PDF via `jspdf`.
3. Email: `POST /api/receipts/:orderId/email` sends via the configured email adapter (console in dev,
   SMTP/Resend in prod). Requires a customer email on the order or supplied ad‑hoc.
4. Money on the receipt is formatted from the persisted (server‑priced) order, never recomputed.
**Acceptance criteria.** A completed sale yields a correct, branded receipt that prints and emails.
**Verification.** Complete a sale → open its receipt (correct totals) → email it (console adapter logs
the message in dev; SMTP delivers in a configured env).

---

## Progress notes (2026-08-06)

**Partially done, ahead of the stated entry criteria.** Phase 2 is not fully
green (P2-T6 `org_id` is untouched), but the pricing hole was too serious to
leave: `POST /api/orders` stored whatever totals it was handed, so a shaped
request bought a $1 item for $0.01. Verified before the fix, on the live stack.

**Landed** — `backend/src/services/pricing.ts` (`repriceOrder`) and its use in
`POST /api/orders`:

- Line prices come from the catalog. `unitPrice`, `lineTotal`, `subtotal`,
  `taxTotal`, and `total` are read off the request and discarded; only product
  and variant ids, quantities, and notes are believed.
- `nameSnapshot`, size, and colour are snapshotted from the catalog too, so a
  receipt names what was actually sold rather than what the caller claimed.
- Tax comes from store settings.
- All arithmetic is in integer cents, converting back to dollars only at the API
  boundary.
- Unknown products, unknown or disabled variants, fractional quantities, and
  insufficient stock are rejected as 400s. Quantities are summed per variant
  first, so two lines for the same variant cannot each pass a stock check that
  the pair would fail.

Verified live after the fix: a request asking to pay $0.01 for a $1 item is
charged $1 and its forged item name is replaced; a request for 99,999 units is
refused with the remaining stock; a normal two-unit sale prices correctly and
decrements stock by two.

**Not done, and why it matters:**

- ~~Discounts are still client-supplied~~ — **fixed.** `POST /api/orders` now
  takes an `appliedDiscounts` array naming *which* discounts were applied, and
  resolves each against the catalog: it must exist, be active, be flagged
  `showInPos` for a register discount, be inside its date window, be under its
  usage cap, and meet its minimum purchase. The amount is computed from the
  stored definition; a bare `discountTotal` is now worth nothing. Manual
  discounts have no catalog entry to check, so they require `discounts.write` —
  a cashier cannot grant one. Employee discounts are refused pending their own
  entitlement checks, rather than honoured unverified.

  Verified live: a bare `discountTotal: 9999` yields $0 off; a request claiming
  90% against a stored 10% discount takes 10%; an invented discount id is
  rejected; a cashier's manual 100%-off is refused while the same cashier can
  apply a configured discount.
- **Change calculation is done** (part of P3-T4). `POST /api/orders` accepts
  `cashTendered`, computes the change against its own repriced total, and
  refuses a shortfall as a 400 naming the amount still owed. Migration 010 adds
  `amount_tendered` and `change_given` to `orders`, so the till's expected
  contents can be reconstructed. The register shows a cash field with
  note-denomination shortcuts and live change, and warns while the tender is
  short.

  Computing against the *repriced* total is the point: a request claiming a
  $0.01 total while tendering $20 is charged $3 and given $17 back, not $19.99.

- **Cash-drawer sessions are done** (the rest of P3-T4). Migration 011 adds
  `cash_drawer_sessions`; `/api/drawer` opens, reports, closes, and lists them.
  Expected cash is the opening float plus cash taken in less change given, over
  sales rung while the session was open — card sales are excluded, since they
  never touch the till. It is always computed server-side and never accepted
  from the caller: a reconciliation means nothing if both sides come from the
  counter.

  One session at a time is enforced by a partial unique index rather than a
  read-then-write, so two cashiers cannot both open a drawer and leave "which
  till did this sale go into" unanswerable.

  The register gains a Drawer button showing the open/close form with a live
  shortfall preview, so a discrepancy is visible while there is still time to
  recount.

- **Split tender is done.** Migration 012 adds a `payments` table — an order had
  one `payment_method` varchar, so it could only ever have been paid one way.
  `POST /api/orders` accepts a `payments` array whose amounts must add up to the
  repriced total; a single `paymentMethod` still becomes one payment covering
  the sale, so existing callers are unchanged. `orders.payment_method` survives
  as a denormalised summary holding the method name, or `'Split'`.

  Store credit is now spendable, which is what made it a real refund option:
  redemption happens **inside the order's transaction**, so a failure cannot
  burn a credit for a sale that never happened, nor record a sale paid with a
  credit still worth its full value. Verified by claiming more credit than the
  balance — the order rolls back, the credit is untouched, and stock does not
  move.

  Change is computed against the *cash portion* of a tender rather than the
  total, since only cash can produce change; giving change against the whole
  total would hand back money the card already covered. The card path likewise
  charges the total less any credit — charging the full amount would take the
  credit's share twice and be rejected for overpayment after the card was
  already authorised.

  The register gained a store-credit field showing what is applied, what stays
  on the credit, and what is still due. The Complete Sale button previously
  showed `subtotal - discount`, which ignored tax; it now shows what is actually
  due.

- ~~The card path charges before the server prices~~ — **fixed.**
  `POST /api/orders/quote` prices a cart without committing to it, sharing the
  `priceCart` path with order creation so the quote is by construction what the
  sale will charge. `handleChargeCard` calls it first and sends the terminal the
  authoritative amount, and a discount the server declines now surfaces while
  the customer's card is still in their hand rather than after it is authorised.
  Tests assert quote and sale agree on all four totals; verified live too.

  Split tender (P3-T2) has the endpoint it needs.

  Order creation also stopped *requiring* the money fields it discards
  (`nameSnapshot`, `unitPrice`, `lineTotal`, `subtotal`, `total`). They are
  still accepted for compatibility, but demanding a figure that is then ignored
  forced every caller to compute something it is not trusted on.
- ~~Atomicity is partial~~ — **fixed.** The decrement is now conditional
  (`UPDATE ... WHERE id = $2 AND stock >= $1`) and a no-op fails the
  transaction, so the pre-transaction stock check in `repriceOrder` is an early
  courtesy rather than the guarantee. Verified by firing two concurrent sales of
  a variant with one unit left: one 201, one 400, final stock 0. The previous
  `GREATEST(0, stock - $1)` clamped at zero and reported success, so both sales
  were recorded against a single unit.
