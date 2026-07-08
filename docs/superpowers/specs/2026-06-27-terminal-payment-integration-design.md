# Terminal Payment Integration — Design Spec
**Date:** 2026-06-27  
**Status:** Approved  
**Scope:** Semi-integrated card terminal support for Stripe Terminal, Square, Clover, Verifone, and Dejavoo via cloud processor SDKs

---

## 1. Problem Statement

StewardPOS currently accepts "Card" as a payment method but has no actual terminal communication. Selecting Card records a string and nothing more — no charge is sent to a physical reader, no approval or decline is received. This feature adds real semi-integrated terminal support so the POS can send a charge to a physical reader and receive an approved/declined result before creating an order.

---

## 2. Goals

- Support the most common retail card terminals: Stripe Terminal readers, Square Terminal, Clover devices, Verifone, Dejavoo
- Semi-integrated only: card data never touches StewardPOS (terminal handles all card entry, PCI compliance stays on the processor)
- Cashier sees real-time terminal status (waiting, approved, declined) without leaving the checkout screen
- Orders are only created after a confirmed approval — declined attempts are logged separately
- Provider credentials configured through existing Admin Settings UI with a dynamic per-provider form
- Fits the existing adapter pattern used for DB, email, SMS, auth, and storage

---

## 3. Out of Scope

- Refunds via terminal (handled manually through processor dashboard for now; `refundCharge` method reserved for future)
- Multi-register / multi-reader per location (one active reader per installation)
- Offline / LAN-only terminal protocols (Datacap, PAX POSLINK)
- Admin Reports "Card Transactions" summary (follow-on feature using the `terminal_transactions` table)

---

## 4. Architecture

### 4.1 Adapter Pattern

Follows the existing `Port → Adapter` pattern in the codebase.

```
src/core/ports/TerminalPort.ts
src/adapters/terminal/
  StripeTerminalAdapter.ts
  SquareTerminalAdapter.ts
  CloverTerminalAdapter.ts
  VerifoneTerminalAdapter.ts
  DejavooTerminalAdapter.ts
  ManualTerminalAdapter.ts      ← dev/test fallback, auto-approves
```

Active adapter is selected at startup based on `card.provider` from admin settings, wired through the existing DI container (`src/lib/di.ts`).

### 4.2 TerminalPort Interface

```typescript
// src/core/ports/TerminalPort.ts

export type ChargeStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'error';

export interface ChargeMeta {
  orderId?: string;       // reference only — order not created yet
  readerId?: string;
  description?: string;
}

export interface ChargeResult {
  chargeId: string;
  status: ChargeStatus;
  authCode?: string;       // 6-digit approval code
  errorMessage?: string;
}

export interface TerminalPort {
  createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult>;
  getChargeStatus(chargeId: string): Promise<ChargeResult>;
  cancelCharge(chargeId: string): Promise<void>;
  listReaders(): Promise<Array<{ id: string; label: string; status: string }>>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}
```

### 4.3 Adapter Behaviour Summary

| Adapter | Mechanism | Polling target |
|---------|-----------|---------------|
| StripeTerminalAdapter | Stripe Terminal Server SDK, PaymentIntent + reader present | Stripe API `paymentIntents.retrieve` |
| SquareTerminalAdapter | Square Terminal API REST, `POST /v2/terminals/checkouts` | Square `GET /v2/terminals/checkouts/:id` |
| CloverTerminalAdapter | Clover Remote Pay WebSocket SDK | Clover merchant API |
| VerifoneTerminalAdapter | Verifone Cloud Payment API | Verifone transaction status endpoint |
| DejavooTerminalAdapter | Dejavoo Cloud API | Dejavoo transaction query |
| ManualTerminalAdapter | No-op, returns `approved` after 2s fake delay | N/A |

---

## 5. Backend API Routes

New file: `backend/src/api/routes/terminal.ts`  
Registered in `backend/src/server.ts` alongside existing routes.

All routes require authentication (`authenticate` middleware).

### 5.1 Route Summary

```
POST   /api/terminal/charge           Initiate a charge on the active terminal
GET    /api/terminal/status/:chargeId Poll charge status
POST   /api/terminal/cancel/:chargeId Cancel a pending charge
GET    /api/terminal/readers          List registered readers for active provider
POST   /api/terminal/test             Test provider credentials (ping, $0 check)
```

### 5.2 POST /api/terminal/charge

**Request:**
```json
{
  "amount": 700,          // cents
  "currency": "USD",
  "readerId": "tmr_xxx",  // optional — uses configured default if omitted
  "description": "Order checkout"
}
```

**Response (202):**
```json
{
  "success": true,
  "data": {
    "chargeId": "pi_xxx",
    "status": "pending"
  }
}
```

The terminal is now prompting the customer. No order is created yet.

### 5.3 GET /api/terminal/status/:chargeId

**Response:**
```json
{
  "success": true,
  "data": {
    "chargeId": "pi_xxx",
    "status": "approved",       // pending | approved | declined | cancelled | error
    "authCode": "123456",       // present when approved
    "errorMessage": null
  }
}
```

### 5.4 POST /api/terminal/cancel/:chargeId

Sends cancel to processor and terminal. Returns `{ success: true }` or error.

### 5.5 GET /api/terminal/readers

Returns readers registered with the active provider:
```json
{
  "success": true,
  "data": [
    { "id": "tmr_xxx", "label": "Front Register", "status": "online" }
  ]
}
```

### 5.6 POST /api/terminal/test

Validates stored credentials against the processor without initiating a charge. Returns `{ success: true, message: "Connected to Stripe Terminal" }` or a specific error.

---

## 6. Order Integration

### 6.1 Order Creation Flow (Card)

```
1. Cashier clicks [Charge Card]
2. Frontend: POST /api/terminal/charge
3. Frontend polls GET /api/terminal/status every 2 seconds
4. On status = 'approved':
   → Frontend: POST /api/orders (existing route)
     payload includes: cardTransactionId, cardAuthCode
5. Order saved, receipt dialog opens
6. On status = 'declined' | 'cancelled' | 'error':
   → No order created
   → Attempt logged to terminal_transactions
```

Cash and Zelle flows are unchanged.

### 6.2 Orders Table — New Columns

```sql
ALTER TABLE orders
  ADD COLUMN card_transaction_id TEXT,
  ADD COLUMN card_auth_code      TEXT;
```

Both nullable. Only populated for approved card transactions.

The auth code is displayed on the receipt (bottom of receipt preview, below payment method line).

### 6.3 terminal_transactions Table

```sql
CREATE TABLE terminal_transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       BIGINT      NOT NULL,
  order_id         UUID        REFERENCES orders(id) ON DELETE SET NULL,
  amount           NUMERIC     NOT NULL,
  currency         TEXT        NOT NULL DEFAULT 'USD',
  provider         TEXT        NOT NULL,
  reader_id        TEXT,
  charge_id        TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  auth_code        TEXT,
  error_message    TEXT,
  duration_ms      INT
);
```

Every terminal attempt (approved, declined, cancelled, error) is written here. `order_id` is linked after order creation succeeds.

---

## 7. Frontend Terminal Flow

### 7.1 Checkout Dialog State Machine

```
idle
 └─[Charge Card clicked]→ charging (POST /api/terminal/charge)
     └─[202 received]→ waiting (polling every 2s)
         ├─[approved]→ creating-order → receipt-open
         ├─[declined]→ declined (show reason, offer retry)
         ├─[cancelled]→ idle
         └─[error]→ error (show message, offer retry)
```

### 7.2 Terminal Waiting UI

Replaces payment buttons while in `waiting` state:

```
⏳  Waiting for card...
    Reader: Front Register (Stripe Terminal)
    
    Amount: $7.00
    
    [Cancel]
```

Spinner animates. Reader label comes from the configured reader name.  
90-second timeout auto-cancels and returns to `idle` with a timeout message.

### 7.3 Result States

**Approved:**
```
✅  Card Approved
    Auth: 123456
```
Receipt dialog opens automatically after 1 second.

**Declined:**
```
❌  Card Declined
    Insufficient funds
    
    [Try Again]  [Switch Payment Method]
```

**Try Again** initiates a new `POST /api/terminal/charge`.  
**Switch Payment Method** cancels the charge and returns to `idle`.

### 7.4 Polling Resilience

If the frontend loses network mid-poll:
- Retries `GET /api/terminal/status` up to 3 times with 3-second backoff
- If all retries fail, shows "Connection lost — checking status…"
- Backend checks processor status before marking failed to prevent double-charge risk

---

## 8. Admin Settings — Provider Configuration

### 8.1 UI Behaviour

Settings page Card section shows:

1. **Provider dropdown** — Stripe Terminal, Square, Clover, Verifone, Dejavoo, Generic/Manual
2. **Dynamic credential fields** — change based on selected provider (see below)
3. **[Save]** button
4. **[Test Connection]** button — calls `POST /api/terminal/test`, shows inline result
5. **[Discover Readers]** button — calls `GET /api/terminal/readers`, populates reader dropdown

### 8.2 Per-Provider Fields

**Stripe Terminal**
- Secret Key (masked after save)
- Terminal Location ID
- Reader ID (dropdown populated by Discover Readers)

**Square**
- Access Token (masked after save)
- Location ID
- Device ID (dropdown populated by Discover Devices)

**Clover**
- API Token (masked after save)
- Merchant ID
- Device ID

**Verifone**
- API Key (masked after save)
- Terminal IP / ID
- Merchant ID

**Dejavoo**
- API Key (masked after save)
- Terminal ID
- Merchant ID

**Generic / Manual**
- No fields. Auto-approves after 2-second delay. For development and testing only.

### 8.3 Credential Storage

- Credentials stored encrypted in the DB settings record
- Never returned in plaintext to the frontend after save (field shows `••••••••` on reload)
- Env var override supported: `STRIPE_SECRET_KEY`, `SQUARE_ACCESS_TOKEN`, `CLOVER_API_TOKEN`, `VERIFONE_API_KEY`, `DEJAVOO_API_KEY` — env vars win over DB values if both are set
- Backend reads credentials server-side only when routing charges

---

## 9. Error Handling Reference

| Situation | Cashier sees | Actions |
|-----------|-------------|---------|
| Card declined | "Card declined — [reason]" | Try Again / Switch Method |
| Customer timeout (90s) | "No response from terminal — charge cancelled" | Try Again / Switch Method |
| Terminal offline | "Terminal not reachable — check connection" | Retry / Switch Method |
| Invalid credentials | "Terminal credentials invalid — contact admin" | Switch Method only |
| Network loss mid-poll | "Connection lost — checking status…" (auto-retries 3×) | Auto-resolves or Switch Method |
| Terminal busy | "Terminal is processing another transaction" | Wait / Switch Method |
| Unknown error | "Terminal error — [code]" | Retry / Switch Method |

All errors are logged to `terminal_transactions` with `status = 'error'` and the raw error message.

---

## 10. Files Changed / Created

### New Files
```
src/core/ports/TerminalPort.ts
src/adapters/terminal/StripeTerminalAdapter.ts
src/adapters/terminal/SquareTerminalAdapter.ts
src/adapters/terminal/CloverTerminalAdapter.ts
src/adapters/terminal/VerifoneTerminalAdapter.ts
src/adapters/terminal/DejavooTerminalAdapter.ts
src/adapters/terminal/ManualTerminalAdapter.ts
backend/src/api/routes/terminal.ts
```

### Modified Files
```
src/lib/di.ts                          register TerminalPort in DI container
src/lib/api-types.ts                   add cardTransactionId, cardAuthCode to Order/CreateOrderRequest
backend/src/server.ts                  register /api/terminal routes
backend/src/services/database.ts       add terminal_transactions table, orders columns migration
src/pages/POS.tsx                      terminal state machine in checkout dialog
src/pages/Settings.tsx                 provider dropdown + dynamic credential fields
src/components/ReceiptDialog.tsx       display auth code when present
```

---

## 11. Dependencies to Add

```
backend:
  @stripe/stripe-js          (Stripe Terminal server SDK)
  square                     (Square Node.js SDK)

frontend:
  @stripe/terminal-js        (Stripe Terminal browser SDK — only needed if using reader discovery in browser)
```

Clover, Verifone, and Dejavoo use REST APIs directly with `fetch`/`axios` — no additional SDK packages required.
