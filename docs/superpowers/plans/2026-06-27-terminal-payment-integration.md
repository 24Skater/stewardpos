# Terminal Payment Integration — Implementation Plan

> ## ⏸ Partly delivered — the live path is not wired
>
> The adapters, the factory and the port exist; `ManualTerminalAdapter` is the
> one in use and card payments are simulated. `P3-T5` — the live Stripe Terminal
> charge path — was deliberately not written blind, and needs real credentials
> and a reader to verify. Unlike the two register plans, the unticked boxes here
> are accurate.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semi-integrated card terminal support (Stripe, Square, Clover, Verifone, Dejavoo) so the POS can send a charge to a physical reader and receive an approved/declined result before creating an order.

**Architecture:** A `TerminalPort` interface lives in `backend/src/terminal/` with one adapter per provider. A `TerminalAdapterFactory` selects the active adapter from admin settings at request time. Three new backend routes (`/api/terminal/charge`, `/api/terminal/status/:id`, `/api/terminal/cancel/:id`) drive a polling state machine in the frontend checkout dialog.

**Tech Stack:** Node.js/Express backend, React/TypeScript frontend, PostgreSQL + SQLite migrations, `stripe` and `squareup` npm packages, native `fetch` for Clover/Verifone/Dejavoo REST APIs.

---

## File Map

### New Files
```
backend/src/terminal/TerminalPort.ts
backend/src/terminal/ManualTerminalAdapter.ts
backend/src/terminal/StripeTerminalAdapter.ts
backend/src/terminal/SquareTerminalAdapter.ts
backend/src/terminal/CloverTerminalAdapter.ts
backend/src/terminal/VerifoneTerminalAdapter.ts
backend/src/terminal/DejavooTerminalAdapter.ts
backend/src/terminal/TerminalAdapterFactory.ts
backend/src/terminal/__tests__/ManualTerminalAdapter.test.ts
backend/src/terminal/__tests__/TerminalAdapterFactory.test.ts
backend/src/api/routes/terminal.ts
backend/src/api/routes/__tests__/terminal.test.ts
backend/migrations/postgres/007_terminal_payments.sql
backend/migrations/sqlite/007_terminal_payments.sql
```

### Modified Files
```
backend/src/adapters/db/PostgresAdapter.ts   — add terminal_transaction methods
backend/src/adapters/db/SQLiteAdapter.ts     — add terminal_transaction methods
backend/src/api/routes/orders.ts             — accept cardTransactionId/cardAuthCode
backend/src/server.ts                        — register /api/terminal routes
src/lib/api-types.ts                         — add cardTransactionId/cardAuthCode to Order types
src/pages/POS.tsx                            — terminal state machine in checkout dialog
src/pages/admin/AdminSettings.tsx            — terminal credential fields per provider
src/components/ReceiptDialog.tsx             — display auth code when present
```

---

## Task 1: TerminalPort Interface

**Files:**
- Create: `backend/src/terminal/TerminalPort.ts`

- [ ] **Step 1: Create the port file**

```typescript
// backend/src/terminal/TerminalPort.ts

export type ChargeStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'error';

export interface ChargeMeta {
  orderId?: string;
  readerId?: string;
  description?: string;
}

export interface ChargeResult {
  chargeId: string;
  status: ChargeStatus;
  authCode?: string;
  errorMessage?: string;
}

export interface TerminalReader {
  id: string;
  label: string;
  status: string;
}

export interface TerminalPort {
  createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult>;
  getChargeStatus(chargeId: string): Promise<ChargeResult>;
  cancelCharge(chargeId: string): Promise<void>;
  listReaders(): Promise<TerminalReader[]>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/terminal/TerminalPort.ts
git commit -m "feat: add TerminalPort interface"
```

---

## Task 2: ManualTerminalAdapter

**Files:**
- Create: `backend/src/terminal/ManualTerminalAdapter.ts`
- Create: `backend/src/terminal/__tests__/ManualTerminalAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/terminal/__tests__/ManualTerminalAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManualTerminalAdapter } from '../ManualTerminalAdapter';

describe('ManualTerminalAdapter', () => {
  let adapter: ManualTerminalAdapter;

  beforeEach(() => {
    adapter = new ManualTerminalAdapter();
    vi.useFakeTimers();
  });

  it('createCharge returns pending status immediately', async () => {
    const promise = adapter.createCharge(700, 'USD', { description: 'test' });
    vi.runAllTimers();
    const result = await promise;
    expect(result.status).toBe('pending');
    expect(result.chargeId).toBeTruthy();
  });

  it('getChargeStatus returns approved after pending', async () => {
    const createPromise = adapter.createCharge(700, 'USD', {});
    vi.runAllTimers();
    const { chargeId } = await createPromise;

    const statusPromise = adapter.getChargeStatus(chargeId);
    vi.runAllTimers();
    const result = await statusPromise;

    expect(result.status).toBe('approved');
    expect(result.authCode).toBe('MANUAL');
  });

  it('cancelCharge sets status to cancelled', async () => {
    const createPromise = adapter.createCharge(700, 'USD', {});
    vi.runAllTimers();
    const { chargeId } = await createPromise;

    await adapter.cancelCharge(chargeId);

    const statusPromise = adapter.getChargeStatus(chargeId);
    vi.runAllTimers();
    const result = await statusPromise;
    expect(result.status).toBe('cancelled');
  });

  it('listReaders returns a mock reader', async () => {
    const readers = await adapter.listReaders();
    expect(readers).toHaveLength(1);
    expect(readers[0].id).toBe('manual-reader-1');
  });

  it('testConnection always succeeds', async () => {
    const result = await adapter.testConnection();
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/terminal/__tests__/ManualTerminalAdapter.test.ts
```
Expected: `Cannot find module '../ManualTerminalAdapter'`

- [ ] **Step 3: Implement ManualTerminalAdapter**

```typescript
// backend/src/terminal/ManualTerminalAdapter.ts
import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader } from './TerminalPort';

type StoredStatus = 'pending' | 'approved' | 'cancelled';

export class ManualTerminalAdapter implements TerminalPort {
  private charges = new Map<string, StoredStatus>();

  async createCharge(_amount: number, _currency: string, _meta: ChargeMeta): Promise<ChargeResult> {
    await delay(100);
    const chargeId = `manual_${randomUUID()}`;
    this.charges.set(chargeId, 'pending');
    return { chargeId, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    await delay(100);
    const stored = this.charges.get(chargeId);
    if (!stored) return { chargeId, status: 'error', errorMessage: 'Charge not found' };

    const status = stored === 'pending' ? 'approved' : stored;
    if (stored === 'pending') this.charges.set(chargeId, 'approved');

    return {
      chargeId,
      status,
      authCode: status === 'approved' ? 'MANUAL' : undefined,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    this.charges.set(chargeId, 'cancelled');
  }

  async listReaders(): Promise<TerminalReader[]> {
    return [{ id: 'manual-reader-1', label: 'Manual / Dev Terminal', status: 'online' }];
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Manual terminal — always connected (dev mode)' };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run src/terminal/__tests__/ManualTerminalAdapter.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/terminal/ManualTerminalAdapter.ts backend/src/terminal/__tests__/ManualTerminalAdapter.test.ts
git commit -m "feat: add ManualTerminalAdapter with tests"
```

---

## Task 3: Database Migrations

**Files:**
- Create: `backend/migrations/postgres/007_terminal_payments.sql`
- Create: `backend/migrations/sqlite/007_terminal_payments.sql`

- [ ] **Step 1: Create Postgres migration**

```sql
-- backend/migrations/postgres/007_terminal_payments.sql
-- Migration: 007_terminal_payments

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS card_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS card_auth_code TEXT;

CREATE TABLE IF NOT EXISTS terminal_transactions (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       BIGINT      NOT NULL,
  order_id         UUID        REFERENCES orders(id) ON DELETE SET NULL,
  amount           NUMERIC     NOT NULL,
  currency         TEXT        NOT NULL DEFAULT 'USD',
  provider         TEXT        NOT NULL DEFAULT 'manual',
  reader_id        TEXT,
  charge_id        TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  auth_code        TEXT,
  error_message    TEXT,
  duration_ms      INT
);

CREATE INDEX IF NOT EXISTS idx_terminal_transactions_charge_id
  ON terminal_transactions(charge_id);

CREATE INDEX IF NOT EXISTS idx_terminal_transactions_order_id
  ON terminal_transactions(order_id);

INSERT INTO schema_migrations (version, applied_at)
VALUES (7, CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: Create SQLite migration**

```sql
-- backend/migrations/sqlite/007_terminal_payments.sql
-- Migration: 007_terminal_payments

ALTER TABLE orders ADD COLUMN card_transaction_id TEXT;
ALTER TABLE orders ADD COLUMN card_auth_code TEXT;

CREATE TABLE IF NOT EXISTS terminal_transactions (
  id               TEXT        PRIMARY KEY,
  created_at       INTEGER     NOT NULL,
  order_id         TEXT        REFERENCES orders(id) ON DELETE SET NULL,
  amount           REAL        NOT NULL,
  currency         TEXT        NOT NULL DEFAULT 'USD',
  provider         TEXT        NOT NULL DEFAULT 'manual',
  reader_id        TEXT,
  charge_id        TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  auth_code        TEXT,
  error_message    TEXT,
  duration_ms      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_terminal_transactions_charge_id
  ON terminal_transactions(charge_id);

INSERT INTO schema_migrations (version, applied_at)
  VALUES (7, datetime('now'));
```

- [ ] **Step 3: Run migrations**

```bash
cd backend && npm run migrate
```
Expected: `Migration 007_terminal_payments applied successfully`

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/postgres/007_terminal_payments.sql backend/migrations/sqlite/007_terminal_payments.sql
git commit -m "feat: add terminal_transactions table and card auth columns to orders"
```

---

## Task 4: DB Adapter — Terminal Transaction Methods

**Files:**
- Modify: `backend/src/adapters/db/PostgresAdapter.ts`
- Modify: `backend/src/adapters/db/SQLiteAdapter.ts`

- [ ] **Step 1: Add interface types at the top of PostgresAdapter.ts**

Open `backend/src/adapters/db/PostgresAdapter.ts`. Add these types and two methods at the end of the class (before the closing `}`):

```typescript
// Add this interface near the top of the file, after the PostgresConfig interface:
export interface TerminalTransactionCreate {
  amount: number;
  currency: string;
  provider: string;
  chargeId: string;
  status: string;
  readerId?: string;
  startedAt: number;
}

export interface TerminalTransactionUpdate {
  status?: string;
  authCode?: string;
  errorMessage?: string;
  orderId?: string;
  durationMs?: number;
}
```

- [ ] **Step 2: Add createTerminalTransaction to PostgresAdapter**

Add this method inside the `PostgresAdapter` class:

```typescript
async createTerminalTransaction(data: TerminalTransactionCreate): Promise<{ id: string }> {
  try {
    const result = await this.pool.query(
      `INSERT INTO terminal_transactions
         (created_at, amount, currency, provider, charge_id, status, reader_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        data.startedAt,
        data.amount,
        data.currency,
        data.provider,
        data.chargeId,
        data.status,
        data.readerId ?? null,
      ]
    );
    return { id: result.rows[0].id };
  } catch (error) {
    logger.error('createTerminalTransaction error:', error);
    throw new DatabaseError('Failed to create terminal transaction');
  }
}
```

- [ ] **Step 3: Add updateTerminalTransactionByChargeId to PostgresAdapter**

Add this method inside the `PostgresAdapter` class:

```typescript
async updateTerminalTransactionByChargeId(
  chargeId: string,
  updates: TerminalTransactionUpdate
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }
  if (updates.authCode !== undefined) { fields.push(`auth_code = $${idx++}`); values.push(updates.authCode); }
  if (updates.errorMessage !== undefined) { fields.push(`error_message = $${idx++}`); values.push(updates.errorMessage); }
  if (updates.orderId !== undefined) { fields.push(`order_id = $${idx++}`); values.push(updates.orderId); }
  if (updates.durationMs !== undefined) { fields.push(`duration_ms = $${idx++}`); values.push(updates.durationMs); }

  if (fields.length === 0) return;

  values.push(chargeId);
  await this.pool.query(
    `UPDATE terminal_transactions SET ${fields.join(', ')} WHERE charge_id = $${idx}`,
    values
  );
}
```

- [ ] **Step 4: Add same methods to SQLiteAdapter.ts**

Open `backend/src/adapters/db/SQLiteAdapter.ts` and add (using the same interface types — import or re-declare them):

```typescript
// Import the types from PostgresAdapter or re-declare inline:
// TerminalTransactionCreate and TerminalTransactionUpdate — same shapes as above.

async createTerminalTransaction(data: TerminalTransactionCreate): Promise<{ id: string }> {
  const id = randomUUID();
  this.db
    .prepare(
      `INSERT INTO terminal_transactions
         (id, created_at, amount, currency, provider, charge_id, status, reader_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.startedAt,
      data.amount,
      data.currency,
      data.provider,
      data.chargeId,
      data.status,
      data.readerId ?? null
    );
  return { id };
}

async updateTerminalTransactionByChargeId(
  chargeId: string,
  updates: TerminalTransactionUpdate
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.authCode !== undefined) { fields.push('auth_code = ?'); values.push(updates.authCode); }
  if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage); }
  if (updates.orderId !== undefined) { fields.push('order_id = ?'); values.push(updates.orderId); }
  if (updates.durationMs !== undefined) { fields.push('duration_ms = ?'); values.push(updates.durationMs); }

  if (fields.length === 0) return;

  values.push(chargeId);
  this.db.prepare(`UPDATE terminal_transactions SET ${fields.join(', ')} WHERE charge_id = ?`).run(...values);
}
```

Note: add `import { randomUUID } from 'crypto';` at the top of SQLiteAdapter.ts if not already present.

- [ ] **Step 5: Build to verify no type errors**

```bash
cd backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/db/PostgresAdapter.ts backend/src/adapters/db/SQLiteAdapter.ts
git commit -m "feat: add terminal transaction DB methods to adapters"
```

---

## Task 5: TerminalAdapterFactory

**Files:**
- Create: `backend/src/terminal/TerminalAdapterFactory.ts`
- Create: `backend/src/terminal/__tests__/TerminalAdapterFactory.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// backend/src/terminal/__tests__/TerminalAdapterFactory.test.ts
import { describe, it, expect } from 'vitest';
import { createTerminalAdapter } from '../TerminalAdapterFactory';
import { ManualTerminalAdapter } from '../ManualTerminalAdapter';

describe('createTerminalAdapter', () => {
  it('returns ManualTerminalAdapter for generic provider', () => {
    const adapter = createTerminalAdapter({ provider: 'generic' });
    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });

  it('returns ManualTerminalAdapter when provider is empty', () => {
    const adapter = createTerminalAdapter({ provider: '' });
    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });

  it('returns ManualTerminalAdapter for unknown provider', () => {
    const adapter = createTerminalAdapter({ provider: 'unknown_brand' });
    expect(adapter).toBeInstanceOf(ManualTerminalAdapter);
  });

  it('returns StripeTerminalAdapter for stripe provider', async () => {
    const { StripeTerminalAdapter } = await import('../StripeTerminalAdapter');
    const adapter = createTerminalAdapter({
      provider: 'stripe',
      stripeSecretKey: 'sk_test_dummy',
      stripeReaderId: 'tmr_dummy',
      stripeTerminalLocationId: 'tml_dummy',
    });
    expect(adapter).toBeInstanceOf(StripeTerminalAdapter);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/terminal/__tests__/TerminalAdapterFactory.test.ts
```
Expected: `Cannot find module '../TerminalAdapterFactory'`

- [ ] **Step 3: Implement TerminalAdapterFactory**

```typescript
// backend/src/terminal/TerminalAdapterFactory.ts
import type { TerminalPort } from './TerminalPort';
import { ManualTerminalAdapter } from './ManualTerminalAdapter';

export interface TerminalConfig {
  provider: string;
  // Stripe
  stripeSecretKey?: string;
  stripeTerminalLocationId?: string;
  stripeReaderId?: string;
  // Square
  squareAccessToken?: string;
  squareLocationId?: string;
  squareDeviceId?: string;
  // Clover
  cloverApiToken?: string;
  cloverMerchantId?: string;
  cloverDeviceId?: string;
  // Verifone
  verifoneApiKey?: string;
  verifoneTerminalId?: string;
  verifoneMerchantId?: string;
  // Dejavoo
  dejavooApiKey?: string;
  dejavooTerminalId?: string;
  dejavooMerchantId?: string;
}

export function createTerminalAdapter(config: TerminalConfig): TerminalPort {
  switch (config.provider) {
    case 'stripe': {
      const { StripeTerminalAdapter } = require('./StripeTerminalAdapter');
      return new StripeTerminalAdapter({
        secretKey: process.env.STRIPE_SECRET_KEY || config.stripeSecretKey || '',
        locationId: config.stripeTerminalLocationId || '',
        readerId: config.stripeReaderId || '',
      });
    }
    case 'square': {
      const { SquareTerminalAdapter } = require('./SquareTerminalAdapter');
      return new SquareTerminalAdapter({
        accessToken: process.env.SQUARE_ACCESS_TOKEN || config.squareAccessToken || '',
        locationId: config.squareLocationId || '',
        deviceId: config.squareDeviceId || '',
      });
    }
    case 'clover': {
      const { CloverTerminalAdapter } = require('./CloverTerminalAdapter');
      return new CloverTerminalAdapter({
        apiToken: process.env.CLOVER_API_TOKEN || config.cloverApiToken || '',
        merchantId: config.cloverMerchantId || '',
        deviceId: config.cloverDeviceId || '',
      });
    }
    case 'verifone': {
      const { VerifoneTerminalAdapter } = require('./VerifoneTerminalAdapter');
      return new VerifoneTerminalAdapter({
        apiKey: process.env.VERIFONE_API_KEY || config.verifoneApiKey || '',
        merchantId: config.verifoneMerchantId || '',
        terminalId: config.verifoneTerminalId || '',
      });
    }
    case 'dejavoo': {
      const { DejavooTerminalAdapter } = require('./DejavooTerminalAdapter');
      return new DejavooTerminalAdapter({
        apiKey: process.env.DEJAVOO_API_KEY || config.dejavooApiKey || '',
        merchantId: config.dejavooMerchantId || '',
        terminalId: config.dejavooTerminalId || '',
      });
    }
    default:
      return new ManualTerminalAdapter();
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npx vitest run src/terminal/__tests__/TerminalAdapterFactory.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/terminal/TerminalAdapterFactory.ts backend/src/terminal/__tests__/TerminalAdapterFactory.test.ts
git commit -m "feat: add TerminalAdapterFactory"
```

---

## Task 6: Backend Terminal Routes

**Files:**
- Create: `backend/src/api/routes/terminal.ts`
- Create: `backend/src/api/routes/__tests__/terminal.test.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Write failing route test**

```typescript
// backend/src/api/routes/__tests__/terminal.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import terminalRoutes from '../terminal';

// Mock auth middleware
vi.mock('../../middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
}));

// Mock database
vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getSettings: async () => ({
        config: { paymentMethods: { card: { provider: 'generic' } }, terminalCredentials: {} },
      }),
      createTerminalTransaction: async () => ({ id: 'txn-1' }),
      updateTerminalTransactionByChargeId: async () => {},
    }),
  },
}));

const app = express();
app.use(express.json());
app.use('/api/terminal', terminalRoutes);

describe('POST /api/terminal/charge', () => {
  it('returns 202 with chargeId and pending status', async () => {
    const res = await request(app)
      .post('/api/terminal/charge')
      .send({ amount: 700, currency: 'USD', description: 'Test charge' });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.chargeId).toBeTruthy();
  });

  it('returns 400 when amount is missing', async () => {
    const res = await request(app)
      .post('/api/terminal/charge')
      .send({ currency: 'USD' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/terminal/status/:chargeId', () => {
  it('returns status for a known charge', async () => {
    const chargeRes = await request(app)
      .post('/api/terminal/charge')
      .send({ amount: 500, currency: 'USD' });

    const chargeId = chargeRes.body.data.chargeId;

    const res = await request(app).get(`/api/terminal/status/${chargeId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(['pending', 'approved']).toContain(res.body.data.status);
  });
});

describe('POST /api/terminal/cancel/:chargeId', () => {
  it('cancels a pending charge', async () => {
    const chargeRes = await request(app)
      .post('/api/terminal/charge')
      .send({ amount: 500, currency: 'USD' });

    const chargeId = chargeRes.body.data.chargeId;
    const res = await request(app).post(`/api/terminal/cancel/${chargeId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/terminal/test', () => {
  it('returns success for manual adapter', async () => {
    const res = await request(app).post('/api/terminal/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npx vitest run src/api/routes/__tests__/terminal.test.ts
```
Expected: `Cannot find module '../terminal'`

- [ ] **Step 3: Create the terminal routes file**

```typescript
// backend/src/api/routes/terminal.ts
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ValidationError } from '../../utils/errors';
import db from '../../services/database';
import { createTerminalAdapter, TerminalConfig } from '../../terminal/TerminalAdapterFactory';
import logger from '../../utils/logger';

const router = Router();
router.use(authenticate);

const chargeSchema = z.object({
  amount: z.number().int().min(1),
  currency: z.string().default('USD'),
  readerId: z.string().optional(),
  description: z.string().optional(),
});

async function getAdapter(dbAdapter: ReturnType<typeof db.getAdapter>) {
  const settings = await dbAdapter.getSettings();
  const config = (settings?.config as Record<string, any>) || {};
  const cardProvider = config.paymentMethods?.card?.provider || 'generic';
  const creds = (config.terminalCredentials || {}) as Partial<TerminalConfig>;

  return createTerminalAdapter({ provider: cardProvider, ...creds });
}

router.post('/charge', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.message);

    const { amount, currency, readerId, description } = parsed.data;
    const dbAdapter = db.getAdapter();
    const terminal = await getAdapter(dbAdapter);

    const startedAt = Date.now();
    const result = await terminal.createCharge(amount, currency, { readerId, description });

    await dbAdapter.createTerminalTransaction({
      amount,
      currency,
      provider: terminal.constructor.name,
      chargeId: result.chargeId,
      status: result.status,
      readerId,
      startedAt,
    });

    logger.info(`Terminal charge initiated: ${result.chargeId}`);
    res.status(202).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.get('/status/:chargeId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chargeId } = req.params;
    const dbAdapter = db.getAdapter();
    const terminal = await getAdapter(dbAdapter);

    const result = await terminal.getChargeStatus(chargeId);

    await dbAdapter.updateTerminalTransactionByChargeId(chargeId, {
      status: result.status,
      authCode: result.authCode,
      errorMessage: result.errorMessage,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.post('/cancel/:chargeId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { chargeId } = req.params;
    const dbAdapter = db.getAdapter();
    const terminal = await getAdapter(dbAdapter);

    await terminal.cancelCharge(chargeId);
    await dbAdapter.updateTerminalTransactionByChargeId(chargeId, { status: 'cancelled' });

    logger.info(`Terminal charge cancelled: ${chargeId}`);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/readers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dbAdapter = db.getAdapter();
    const terminal = await getAdapter(dbAdapter);
    const readers = await terminal.listReaders();
    res.json({ success: true, data: readers });
  } catch (error) {
    next(error);
  }
});

router.post('/test', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dbAdapter = db.getAdapter();
    const terminal = await getAdapter(dbAdapter);
    const result = await terminal.testConnection();
    res.json({ success: result.success, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 4: Register routes in server.ts**

Open `backend/src/server.ts`. After the existing import block (around line 25), add:

```typescript
import terminalRoutes from './api/routes/terminal';
```

In the routes registration section (after `app.use('/api/receipts', receiptsRoutes);`), add:

```typescript
app.use('/api/terminal', terminalRoutes);
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd backend && npx vitest run src/api/routes/__tests__/terminal.test.ts
```
Expected: all tests pass.

- [ ] **Step 6: Build check**

```bash
cd backend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/routes/terminal.ts backend/src/api/routes/__tests__/terminal.test.ts backend/src/server.ts
git commit -m "feat: add terminal API routes (charge, status, cancel, readers, test)"
```

---

## Task 7: StripeTerminalAdapter

**Files:**
- Create: `backend/src/terminal/StripeTerminalAdapter.ts`

- [ ] **Step 1: Install Stripe SDK**

```bash
cd backend && npm install stripe
```

- [ ] **Step 2: Implement StripeTerminalAdapter**

```typescript
// backend/src/terminal/StripeTerminalAdapter.ts
import Stripe from 'stripe';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader } from './TerminalPort';

interface StripeConfig {
  secretKey: string;
  locationId: string;
  readerId: string;
}

export class StripeTerminalAdapter implements TerminalPort {
  private stripe: Stripe;
  private readerId: string;

  constructor(config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, { apiVersion: '2025-01-27.acacia' });
    this.readerId = config.readerId;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount,
      currency: currency.toLowerCase(),
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: { description: meta.description || '' },
    });

    await this.stripe.terminal.readers.presentPaymentMethod(
      meta.readerId || this.readerId,
      { payment_intent: paymentIntent.id }
    );

    return { chargeId: paymentIntent.id, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const pi = await this.stripe.paymentIntents.retrieve(chargeId, {
      expand: ['latest_charge'],
    });

    const stripeToCharge: Record<string, ChargeResult['status']> = {
      requires_payment_method: 'pending',
      requires_confirmation: 'pending',
      requires_action: 'pending',
      processing: 'pending',
      succeeded: 'approved',
      canceled: 'cancelled',
      requires_capture: 'pending',
    };

    const status = stripeToCharge[pi.status] ?? 'error';
    const charge = pi.latest_charge as Stripe.Charge | null;
    const authCode =
      charge?.payment_method_details?.card_present?.receipt?.authorization_code ?? undefined;

    return {
      chargeId,
      status,
      authCode,
      errorMessage: pi.last_payment_error?.message,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(chargeId);
  }

  async listReaders(): Promise<TerminalReader[]> {
    const readers = await this.stripe.terminal.readers.list({ limit: 100 });
    return readers.data.map((r) => ({
      id: r.id,
      label: r.label || r.id,
      status: r.status,
    }));
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.stripe.terminal.readers.list({ limit: 1 });
      return { success: true, message: 'Connected to Stripe Terminal' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
```

- [ ] **Step 3: Build check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/terminal/StripeTerminalAdapter.ts
git commit -m "feat: add StripeTerminalAdapter"
```

---

## Task 8: SquareTerminalAdapter

**Files:**
- Create: `backend/src/terminal/SquareTerminalAdapter.ts`

- [ ] **Step 1: Install Square SDK**

```bash
cd backend && npm install squareup
```

- [ ] **Step 2: Implement SquareTerminalAdapter**

```typescript
// backend/src/terminal/SquareTerminalAdapter.ts
import { Client, Environment } from 'squareup';
import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader } from './TerminalPort';

interface SquareConfig {
  accessToken: string;
  locationId: string;
  deviceId: string;
  sandbox?: boolean;
}

export class SquareTerminalAdapter implements TerminalPort {
  private client: Client;
  private deviceId: string;

  constructor(config: SquareConfig) {
    this.client = new Client({
      bearerAuthCredentials: { accessToken: config.accessToken },
      environment: config.sandbox ? Environment.Sandbox : Environment.Production,
    });
    this.deviceId = config.deviceId;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const { result, errors } = await this.client.terminalApi.createTerminalCheckout({
      idempotencyKey: randomUUID(),
      checkout: {
        amountMoney: { amount: BigInt(amount), currency: currency as any },
        deviceOptions: { deviceId: meta.readerId || this.deviceId },
        note: meta.description,
      },
    });

    if (errors?.length || !result.checkout) {
      return { chargeId: '', status: 'error', errorMessage: errors?.[0]?.detail ?? 'Failed to create checkout' };
    }

    return { chargeId: result.checkout.id!, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const { result, errors } = await this.client.terminalApi.getTerminalCheckout(chargeId);

    if (errors?.length || !result.checkout) {
      return { chargeId, status: 'error', errorMessage: errors?.[0]?.detail ?? 'Checkout not found' };
    }

    const squareToCharge: Record<string, ChargeResult['status']> = {
      PENDING: 'pending',
      IN_PROGRESS: 'pending',
      COMPLETED: 'approved',
      CANCELED: 'cancelled',
      CANCEL_REQUESTED: 'cancelled',
    };

    return {
      chargeId,
      status: squareToCharge[result.checkout.status ?? ''] ?? 'error',
      authCode: result.checkout.paymentIds?.[0],
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.client.terminalApi.cancelTerminalCheckout(chargeId);
  }

  async listReaders(): Promise<TerminalReader[]> {
    const { result } = await this.client.devicesApi.listDeviceCodes();
    return (result.deviceCodes ?? []).map((d) => ({
      id: d.deviceId || d.id || '',
      label: d.name || d.id || '',
      status: d.status || 'unknown',
    }));
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.client.locationsApi.listLocations();
      return { success: true, message: 'Connected to Square' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
```

- [ ] **Step 3: Build check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/terminal/SquareTerminalAdapter.ts
git commit -m "feat: add SquareTerminalAdapter"
```

---

## Task 9: CloverTerminalAdapter

**Files:**
- Create: `backend/src/terminal/CloverTerminalAdapter.ts`

- [ ] **Step 1: Implement CloverTerminalAdapter** (uses Clover REST API, no extra SDK needed)

```typescript
// backend/src/terminal/CloverTerminalAdapter.ts
import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader } from './TerminalPort';

interface CloverConfig {
  apiToken: string;
  merchantId: string;
  deviceId: string;
}

export class CloverTerminalAdapter implements TerminalPort {
  private apiToken: string;
  private merchantId: string;
  private deviceId: string;
  private baseUrl = 'https://api.clover.com';

  constructor(config: CloverConfig) {
    this.apiToken = config.apiToken;
    this.merchantId = config.merchantId;
    this.deviceId = config.deviceId;
  }

  private async cloverFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Clover API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async createCharge(amount: number, _currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const data = await this.cloverFetch<{ id: string }>(
      `/v3/merchants/${this.merchantId}/remote_pay`,
      {
        method: 'POST',
        body: JSON.stringify({
          amount,
          externalId: meta.orderId || randomUUID(),
          type: 'SALE',
          deviceId: meta.readerId || this.deviceId,
        }),
      }
    );
    return { chargeId: data.id, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const data = await this.cloverFetch<{
      result: string;
      authCode?: string;
      message?: string;
    }>(`/v3/merchants/${this.merchantId}/remote_pay/${chargeId}`);

    const cloverToCharge: Record<string, ChargeResult['status']> = {
      PENDING: 'pending',
      APPROVED: 'approved',
      DECLINED: 'declined',
      VOIDED: 'cancelled',
    };

    return {
      chargeId,
      status: cloverToCharge[data.result] ?? 'error',
      authCode: data.authCode,
      errorMessage: data.message,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.cloverFetch(`/v3/merchants/${this.merchantId}/remote_pay/${chargeId}`, {
      method: 'DELETE',
    });
  }

  async listReaders(): Promise<TerminalReader[]> {
    const data = await this.cloverFetch<{ elements: Array<{ id: string; name?: string; online?: boolean }> }>(
      `/v3/merchants/${this.merchantId}/devices`
    );
    return (data.elements ?? []).map((d) => ({
      id: d.id,
      label: d.name || d.id,
      status: d.online ? 'online' : 'offline',
    }));
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.cloverFetch(`/v3/merchants/${this.merchantId}`);
      return { success: true, message: 'Connected to Clover' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
```

- [ ] **Step 2: Build check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/terminal/CloverTerminalAdapter.ts
git commit -m "feat: add CloverTerminalAdapter"
```

---

## Task 10: VerifoneTerminalAdapter

**Files:**
- Create: `backend/src/terminal/VerifoneTerminalAdapter.ts`

- [ ] **Step 1: Implement VerifoneTerminalAdapter**

```typescript
// backend/src/terminal/VerifoneTerminalAdapter.ts
import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader } from './TerminalPort';

interface VerifoneConfig {
  apiKey: string;
  merchantId: string;
  terminalId: string;
}

export class VerifoneTerminalAdapter implements TerminalPort {
  private apiKey: string;
  private merchantId: string;
  private terminalId: string;
  private baseUrl = 'https://api.verifone.com/v1';

  constructor(config: VerifoneConfig) {
    this.apiKey = config.apiKey;
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
  }

  private async verifoneFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Verifone API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const data = await this.verifoneFetch<{ transactionId: string }>(
      '/transactions',
      {
        method: 'POST',
        body: JSON.stringify({
          amount: (amount / 100).toFixed(2),
          currency,
          terminalId: meta.readerId || this.terminalId,
          merchantId: this.merchantId,
          referenceId: meta.orderId || randomUUID(),
          transactionType: 'sale',
        }),
      }
    );
    return { chargeId: data.transactionId, status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const data = await this.verifoneFetch<{
      status: string;
      authorizationCode?: string;
      responseMessage?: string;
    }>(`/transactions/${chargeId}`);

    const verifoneToCharge: Record<string, ChargeResult['status']> = {
      PENDING: 'pending',
      PROCESSING: 'pending',
      APPROVED: 'approved',
      DECLINED: 'declined',
      VOIDED: 'cancelled',
      CANCELLED: 'cancelled',
    };

    return {
      chargeId,
      status: verifoneToCharge[data.status] ?? 'error',
      authCode: data.authorizationCode,
      errorMessage: data.responseMessage,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.verifoneFetch(`/transactions/${chargeId}/void`, {
      method: 'POST',
      body: '{}',
    });
  }

  async listReaders(): Promise<TerminalReader[]> {
    const data = await this.verifoneFetch<{
      terminals: Array<{ terminalId: string; name?: string; status?: string }>;
    }>(`/terminals?merchantId=${this.merchantId}`);
    return (data.terminals ?? []).map((t) => ({
      id: t.terminalId,
      label: t.name || t.terminalId,
      status: t.status?.toLowerCase() || 'unknown',
    }));
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.verifoneFetch(`/merchants/${this.merchantId}`);
      return { success: true, message: 'Connected to Verifone' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
```

- [ ] **Step 2: Build check + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/terminal/VerifoneTerminalAdapter.ts
git commit -m "feat: add VerifoneTerminalAdapter"
```

---

## Task 11: DejavooTerminalAdapter

**Files:**
- Create: `backend/src/terminal/DejavooTerminalAdapter.ts`

- [ ] **Step 1: Implement DejavooTerminalAdapter**

```typescript
// backend/src/terminal/DejavooTerminalAdapter.ts
import { randomUUID } from 'crypto';
import type { TerminalPort, ChargeResult, ChargeMeta, TerminalReader } from './TerminalPort';

interface DejavooConfig {
  apiKey: string;
  merchantId: string;
  terminalId: string;
}

export class DejavooTerminalAdapter implements TerminalPort {
  private apiKey: string;
  private merchantId: string;
  private terminalId: string;
  private baseUrl = 'https://cloud.dejavoo.com/api/v1';

  constructor(config: DejavooConfig) {
    this.apiKey = config.apiKey;
    this.merchantId = config.merchantId;
    this.terminalId = config.terminalId;
  }

  private async dejavooFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Dejavoo API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult> {
    const data = await this.dejavooFetch<{ refNum?: string; id?: string }>(
      '/payment/sale',
      {
        method: 'POST',
        body: JSON.stringify({
          amount: (amount / 100).toFixed(2),
          currency,
          terminalId: meta.readerId || this.terminalId,
          merchantId: this.merchantId,
          invoiceNumber: (meta.orderId || randomUUID()).slice(0, 8),
        }),
      }
    );
    return { chargeId: data.refNum || data.id || '', status: 'pending' };
  }

  async getChargeStatus(chargeId: string): Promise<ChargeResult> {
    const data = await this.dejavooFetch<{
      result?: string;
      authCode?: string;
      message?: string;
    }>(`/payment/status/${chargeId}`);

    const dejavooToCharge: Record<string, ChargeResult['status']> = {
      PENDING: 'pending',
      APPROVED: 'approved',
      DECLINED: 'declined',
      CANCELLED: 'cancelled',
      VOIDED: 'cancelled',
    };

    return {
      chargeId,
      status: dejavooToCharge[(data.result ?? '').toUpperCase()] ?? 'error',
      authCode: data.authCode,
      errorMessage: data.message,
    };
  }

  async cancelCharge(chargeId: string): Promise<void> {
    await this.dejavooFetch(`/payment/void/${chargeId}`, { method: 'POST', body: '{}' });
  }

  async listReaders(): Promise<TerminalReader[]> {
    const data = await this.dejavooFetch<{
      terminals: Array<{ terminalId?: string; id?: string; name?: string; online?: boolean }>;
    }>(`/terminals?merchantId=${this.merchantId}`);
    return (data.terminals ?? []).map((t) => ({
      id: t.terminalId || t.id || '',
      label: t.name || t.terminalId || t.id || '',
      status: t.online ? 'online' : 'offline',
    }));
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.dejavooFetch(`/ping?merchantId=${this.merchantId}`);
      return { success: true, message: 'Connected to Dejavoo' };
    } catch (error: unknown) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
```

- [ ] **Step 2: Build check + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/terminal/DejavooTerminalAdapter.ts
git commit -m "feat: add DejavooTerminalAdapter"
```

---

## Task 12: API Types + Orders Route Update

**Files:**
- Modify: `src/lib/api-types.ts`
- Modify: `backend/src/api/routes/orders.ts`

- [ ] **Step 1: Add card fields to api-types.ts**

Open `src/lib/api-types.ts`. In the `Order` interface (around line 86), add two optional fields:

```typescript
export interface Order {
  id: string;
  createdAt: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
  items?: OrderItem[];
  cardTransactionId?: string;   // ← add this
  cardAuthCode?: string;         // ← add this
}
```

In the `CreateOrderRequest` interface (around line 114), add:

```typescript
export interface CreateOrderRequest {
  items: Array<{ ... }>;   // existing
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
  cardTransactionId?: string;   // ← add this
  cardAuthCode?: string;         // ← add this
}
```

- [ ] **Step 2: Update createOrderSchema in orders.ts**

Open `backend/src/api/routes/orders.ts`. In the `createOrderSchema` (around line 46), add two optional fields:

```typescript
const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  subtotal: z.number().min(0),
  discountTotal: z.number().min(0).default(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0),
  paymentMethod: z.string(),
  customerEmail: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().email().optional()
  ),
  customerPhone: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().optional()
  ),
  cardTransactionId: z.string().optional(),   // ← add this
  cardAuthCode: z.string().optional(),         // ← add this
});
```

- [ ] **Step 3: Pass card fields to createOrder and link terminal transaction**

In the `POST /` route handler in `orders.ts`, update the section after `const order = await adapter.createOrder(orderData);` to also link the terminal transaction:

```typescript
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orderData = createOrderSchema.parse(req.body);
    const adapter = db.getAdapter();
    const order = await adapter.createOrder(orderData);

    // Link terminal transaction to the new order if card payment
    if (orderData.cardTransactionId) {
      await adapter.updateTerminalTransactionByChargeId(orderData.cardTransactionId, {
        orderId: order.id,
        status: 'approved',
        authCode: orderData.cardAuthCode,
      });
    }

    logger.info(`Created order: ${order.id} - Total: $${order.total}`);
    // ... rest of existing handler unchanged
```

Note: The existing `adapter.createOrder(orderData)` call needs the adapter to store `card_transaction_id` and `card_auth_code`. Update the PostgresAdapter's `createOrder` INSERT to include those columns:

In `backend/src/adapters/db/PostgresAdapter.ts`, find the `createOrder` method and update the INSERT to add:

```sql
-- Add to the INSERT columns list:
card_transaction_id, card_auth_code

-- Add to the VALUES list:
$N, $N+1   -- using orderData.cardTransactionId ?? null, orderData.cardAuthCode ?? null
```

Do the same for SQLiteAdapter's `createOrder`.

- [ ] **Step 4: Build check**

```bash
cd backend && npx tsc --noEmit
npx tsc --noEmit  # frontend
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-types.ts backend/src/api/routes/orders.ts backend/src/adapters/db/PostgresAdapter.ts backend/src/adapters/db/SQLiteAdapter.ts
git commit -m "feat: add cardTransactionId and cardAuthCode to order creation flow"
```

---

## Task 13: Frontend — POS Terminal State Machine

**Files:**
- Modify: `src/pages/POS.tsx`

- [ ] **Step 1: Add terminal state types near the top of POS.tsx**

After the existing interface definitions (around line 55), add:

```typescript
type TerminalPhase =
  | 'idle'
  | 'charging'
  | 'waiting'
  | 'approved'
  | 'declined'
  | 'error'
  | 'cancelled';

interface TerminalState {
  phase: TerminalPhase;
  chargeId?: string;
  authCode?: string;
  errorMessage?: string;
}
```

- [ ] **Step 2: Add terminal state variables to the POS component**

Inside the `POS` function, after the existing `useState` declarations (around line 95), add:

```typescript
const [terminalState, setTerminalState] = useState<TerminalState>({ phase: 'idle' });
const terminalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
const terminalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add `useRef` to the existing import at line 1:
```typescript
import { useState, useEffect, useRef } from "react";
```
(It's already there from `barcodeRef` — confirm `useRef` is imported.)

- [ ] **Step 3: Add terminal helper functions inside POS component**

Add these three functions inside the `POS` function body, after `loadStoreName`:

```typescript
const stopTerminalPolling = () => {
  if (terminalPollRef.current) {
    clearInterval(terminalPollRef.current);
    terminalPollRef.current = null;
  }
  if (terminalTimeoutRef.current) {
    clearTimeout(terminalTimeoutRef.current);
    terminalTimeoutRef.current = null;
  }
};

const handleChargeCard = async () => {
  const amountCents = Math.round(total * 100);
  setTerminalState({ phase: 'charging' });

  try {
    const res = await apiClient.post<{ success: boolean; data: { chargeId: string; status: string } }>(
      '/api/terminal/charge',
      { amount: amountCents, currency: 'USD', description: 'POS Checkout' }
    );

    if (!res.success) throw new Error('Failed to initiate charge');

    const { chargeId } = res.data;
    setTerminalState({ phase: 'waiting', chargeId });

    // 90-second auto-cancel timeout
    terminalTimeoutRef.current = setTimeout(async () => {
      stopTerminalPolling();
      await apiClient.post(`/api/terminal/cancel/${chargeId}`, {});
      setTerminalState({ phase: 'error', errorMessage: 'No response from terminal — charge cancelled' });
    }, 90_000);

    // Poll every 2 seconds
    terminalPollRef.current = setInterval(async () => {
      try {
        const statusRes = await apiClient.get<{
          success: boolean;
          data: { status: string; authCode?: string; errorMessage?: string };
        }>(`/api/terminal/status/${chargeId}`);

        const { status, authCode, errorMessage } = statusRes.data;

        if (status === 'approved') {
          stopTerminalPolling();
          setTerminalState({ phase: 'approved', chargeId, authCode });
          await completeCardOrder(chargeId, authCode);
        } else if (status === 'declined') {
          stopTerminalPolling();
          setTerminalState({ phase: 'declined', errorMessage: errorMessage || 'Card declined' });
        } else if (status === 'cancelled') {
          stopTerminalPolling();
          setTerminalState({ phase: 'cancelled' });
        } else if (status === 'error') {
          stopTerminalPolling();
          setTerminalState({ phase: 'error', errorMessage: errorMessage || 'Terminal error' });
        }
        // 'pending' → keep polling
      } catch {
        // Network hiccup — keep polling, timeout will handle persistent failure
      }
    }, 2_000);
  } catch (error: any) {
    setTerminalState({ phase: 'error', errorMessage: error.message || 'Failed to reach terminal' });
  }
};

const handleCancelTerminal = async () => {
  const { chargeId } = terminalState;
  stopTerminalPolling();
  if (chargeId) {
    await apiClient.post(`/api/terminal/cancel/${chargeId}`, {}).catch(() => {});
  }
  setTerminalState({ phase: 'idle' });
};

const completeCardOrder = async (chargeId: string, authCode?: string) => {
  try {
    const orderRequest: CreateOrderRequest = {
      items: cart.map(item => ({
        productId: item.productId,
        variantId: item.variantId || undefined,
        nameSnapshot: item.nameSnapshot || '',
        size: item.size,
        color: item.color,
        quantity: item.quantity,
        unitPrice: item.price,
        lineDiscount: item.lineDiscount || 0,
        lineTotal: item.price * item.quantity - (item.lineDiscount || 0),
        notes: item.notes,
      })),
      subtotal,
      discountTotal,
      taxTotal,
      total,
      paymentMethod: selectedPaymentMethod,
      cardTransactionId: chargeId,
      cardAuthCode: authCode,
      ...(customerEmail && customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
    };

    const response = await apiClient.post<{ success: boolean; data: Order }>('/api/orders', orderRequest);

    if (response.success) {
      toast({ title: 'Sale completed!', description: `Order ${response.data.id} saved successfully` });
      setLastOrderId(response.data.id);
      setLastOrderTotal(total);
      setLastOrderSubtotal(subtotal);
      setLastOrderTax(taxTotal);
      setLastOrderDiscount(discountTotal);
      setLastOrderPaymentMethod(selectedPaymentMethod);
      setLastOrderItems([...cart]);
      setCart([]);
      setCustomerEmail('');
      setAppliedDiscounts([]);
      setTerminalState({ phase: 'idle' });
      setCheckoutOpen(false);
      setReceiptDialogOpen(true);
      await loadProducts();
    }
  } catch (error: any) {
    toast({ title: 'Order save failed', description: error.message, variant: 'destructive' });
  }
};
```

Add `Order` and `CreateOrderRequest` to the import from `@/lib/api-types` at the top:
```typescript
import type { Product, CreateOrderRequest, Order } from "@/lib/api-types";
```
(Already imported — confirm both are there.)

- [ ] **Step 4: Replace the Card payment button's onClick in the checkout dialog**

Find the section in POS.tsx where the checkout dialog has the payment method buttons and the "Complete Sale" / submit button. 

The current flow calls the order creation directly. Update it so when `selectedPaymentMethod === 'Card'`, it calls `handleChargeCard()` instead of `handleCheckout()`.

Find the checkout confirm/submit button (search for `handleCheckout` in the dialog) and update it:

```typescript
// Find the existing "Complete Sale" / checkout button in the dialog.
// Change its onClick to:
onClick={() => {
  if (selectedPaymentMethod === 'Card' && paymentMethods.card?.enabled) {
    handleChargeCard();
  } else {
    handleCheckout();
  }
}}
```

- [ ] **Step 5: Add terminal status UI inside the checkout dialog**

Find the checkout `<Dialog>` in POS.tsx. Inside `<DialogContent>`, add a terminal status panel that shows when `terminalState.phase !== 'idle'`. Add this block just before the `<DialogFooter>` in the checkout dialog:

```tsx
{/* Terminal Status Panel — shown when card payment is in progress */}
{terminalState.phase !== 'idle' && (
  <div className="border rounded-lg p-4 space-y-3">
    {terminalState.phase === 'charging' && (
      <div className="flex items-center gap-3">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
        <span className="text-sm">Connecting to terminal...</span>
      </div>
    )}

    {terminalState.phase === 'waiting' && (
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          <span className="font-medium">Waiting for card...</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Present card on the terminal · ${total.toFixed(2)}
        </p>
        <Button variant="outline" size="sm" onClick={handleCancelTerminal}>
          Cancel
        </Button>
      </div>
    )}

    {terminalState.phase === 'approved' && (
      <div className="flex items-center gap-2 text-green-600">
        <span className="text-lg">✓</span>
        <div>
          <p className="font-medium">Card Approved</p>
          {terminalState.authCode && (
            <p className="text-xs text-muted-foreground">Auth: {terminalState.authCode}</p>
          )}
        </div>
      </div>
    )}

    {terminalState.phase === 'declined' && (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-destructive">
          <span className="text-lg">✕</span>
          <p className="font-medium">Card Declined</p>
        </div>
        {terminalState.errorMessage && (
          <p className="text-sm text-muted-foreground">{terminalState.errorMessage}</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={handleChargeCard}>Try Again</Button>
          <Button variant="outline" size="sm" onClick={() => setTerminalState({ phase: 'idle' })}>
            Switch Method
          </Button>
        </div>
      </div>
    )}

    {(terminalState.phase === 'error' || terminalState.phase === 'cancelled') && (
      <div className="space-y-2">
        <p className="text-sm text-destructive">
          {terminalState.errorMessage || 'Terminal operation cancelled'}
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleChargeCard}>Retry</Button>
          <Button variant="outline" size="sm" onClick={() => setTerminalState({ phase: 'idle' })}>
            Switch Method
          </Button>
        </div>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 6: Clean up polling on unmount**

Add a `useEffect` cleanup near the other `useEffect` hooks in POS.tsx:

```typescript
useEffect(() => {
  return () => {
    stopTerminalPolling();
  };
}, []);
```

- [ ] **Step 7: Build check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/POS.tsx
git commit -m "feat: add terminal state machine and polling to POS checkout"
```

---

## Task 14: Admin Settings — Terminal Credential Fields

**Files:**
- Modify: `src/pages/admin/AdminSettings.tsx`

- [ ] **Step 1: Extend the Settings interface**

In `AdminSettings.tsx`, update the `Settings` interface to include `terminalCredentials`:

```typescript
interface TerminalCredentials {
  stripeSecretKey?: string;
  stripeTerminalLocationId?: string;
  stripeReaderId?: string;
  squareAccessToken?: string;
  squareLocationId?: string;
  squareDeviceId?: string;
  cloverApiToken?: string;
  cloverMerchantId?: string;
  cloverDeviceId?: string;
  verifoneApiKey?: string;
  verifoneTerminalId?: string;
  verifoneMerchantId?: string;
  dejavooApiKey?: string;
  dejavooTerminalId?: string;
  dejavooMerchantId?: string;
}

interface Settings {
  taxRateDefault: number;
  storeName: string;
  storeEmail: string;
  storePhone: string;
  timezone: string;
  config?: {
    authMethods?: { local?: boolean; google?: boolean; oidc?: boolean };
    demoMode?: boolean;
    paymentMethods?: PaymentMethodsConfig;
    terminalCredentials?: TerminalCredentials;   // ← add this
  };
}
```

- [ ] **Step 2: Add terminal credential state**

Inside the `AdminSettings` component, add:

```typescript
const [terminalCreds, setTerminalCreds] = useState<TerminalCredentials>({});
const [testingConnection, setTestingConnection] = useState(false);
const [discoveringReaders, setDiscoveringReaders] = useState(false);
const [readers, setReaders] = useState<Array<{ id: string; label: string; status: string }>>([]);
```

Update `loadSettings` to also populate terminalCreds:

```typescript
// Inside the loadSettings success block, after setting settings:
if (response.data.config?.terminalCredentials) {
  setTerminalCreds(response.data.config.terminalCredentials);
}
```

Update `handleSave` to include terminalCreds in the payload:

```typescript
const response = await apiClient.put<{ success: boolean; data: Settings }>(
  '/api/admin/settings',
  {
    ...settings,
    config: {
      ...settings.config,
      terminalCredentials: terminalCreds,
    },
  }
);
```

- [ ] **Step 3: Add test connection and discover readers handlers**

```typescript
const handleTestConnection = async () => {
  setTestingConnection(true);
  try {
    const res = await apiClient.post<{ success: boolean; data: { success: boolean; message: string } }>(
      '/api/terminal/test',
      {}
    );
    toast({
      title: res.data.success ? 'Connection successful' : 'Connection failed',
      description: res.data.message,
      variant: res.data.success ? 'default' : 'destructive',
    });
  } catch (error: any) {
    toast({ title: 'Connection test failed', description: error.message, variant: 'destructive' });
  } finally {
    setTestingConnection(false);
  }
};

const handleDiscoverReaders = async () => {
  setDiscoveringReaders(true);
  try {
    const res = await apiClient.get<{
      success: boolean;
      data: Array<{ id: string; label: string; status: string }>;
    }>('/api/terminal/readers');
    setReaders(res.data);
    toast({ title: `Found ${res.data.length} reader(s)` });
  } catch (error: any) {
    toast({ title: 'Reader discovery failed', description: error.message, variant: 'destructive' });
  } finally {
    setDiscoveringReaders(false);
  }
};
```

- [ ] **Step 4: Add terminal credential fields to the Payments tab**

In the Payments tab JSX (find `<TabsContent value="payments">`), locate where the Card provider `<Select>` is shown. Add a new credential section below the existing card provider selector:

```tsx
{/* Terminal Credentials — shown when card is enabled */}
{settings.config?.paymentMethods?.card?.enabled && (
  <div className="mt-4 space-y-4 border-t pt-4">
    <div className="flex items-center justify-between">
      <Label className="text-sm font-medium">Terminal Credentials</Label>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDiscoverReaders}
          disabled={discoveringReaders}
        >
          {discoveringReaders ? (
            <RefreshCw className="h-4 w-4 animate-spin mr-1" />
          ) : null}
          Discover Readers
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestConnection}
          disabled={testingConnection}
        >
          {testingConnection ? (
            <RefreshCw className="h-4 w-4 animate-spin mr-1" />
          ) : null}
          Test Connection
        </Button>
      </div>
    </div>

    {/* Stripe fields */}
    {settings.config?.paymentMethods?.card?.provider === 'stripe' && (
      <div className="space-y-3">
        <div>
          <Label>Secret Key</Label>
          <Input
            type="password"
            placeholder="sk_live_••••••••"
            value={terminalCreds.stripeSecretKey || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, stripeSecretKey: e.target.value })}
          />
        </div>
        <div>
          <Label>Terminal Location ID</Label>
          <Input
            placeholder="tml_xxxxxxxxxxxx"
            value={terminalCreds.stripeTerminalLocationId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, stripeTerminalLocationId: e.target.value })}
          />
        </div>
        <div>
          <Label>Reader ID</Label>
          <Input
            placeholder={readers.length ? 'Select from discovered readers' : 'tmr_xxxxxxxxxxxx'}
            value={terminalCreds.stripeReaderId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, stripeReaderId: e.target.value })}
          />
          {readers.length > 0 && (
            <Select
              value={terminalCreds.stripeReaderId || ''}
              onValueChange={(v) => setTerminalCreds({ ...terminalCreds, stripeReaderId: v })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Pick a discovered reader" />
              </SelectTrigger>
              <SelectContent>
                {readers.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label} ({r.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    )}

    {/* Square fields */}
    {settings.config?.paymentMethods?.card?.provider === 'square' && (
      <div className="space-y-3">
        <div>
          <Label>Access Token</Label>
          <Input
            type="password"
            placeholder="EAAAxxxxxxxx"
            value={terminalCreds.squareAccessToken || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, squareAccessToken: e.target.value })}
          />
        </div>
        <div>
          <Label>Location ID</Label>
          <Input
            placeholder="Lxxxxxxxxx"
            value={terminalCreds.squareLocationId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, squareLocationId: e.target.value })}
          />
        </div>
        <div>
          <Label>Device ID</Label>
          <Input
            placeholder={readers.length ? 'Select from discovered devices' : 'Dxxxxxxxxx'}
            value={terminalCreds.squareDeviceId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, squareDeviceId: e.target.value })}
          />
          {readers.length > 0 && (
            <Select
              value={terminalCreds.squareDeviceId || ''}
              onValueChange={(v) => setTerminalCreds({ ...terminalCreds, squareDeviceId: v })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Pick a discovered device" />
              </SelectTrigger>
              <SelectContent>
                {readers.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label} ({r.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    )}

    {/* Clover fields */}
    {settings.config?.paymentMethods?.card?.provider === 'clover' && (
      <div className="space-y-3">
        <div>
          <Label>API Token</Label>
          <Input
            type="password"
            placeholder="••••••••••••"
            value={terminalCreds.cloverApiToken || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, cloverApiToken: e.target.value })}
          />
        </div>
        <div>
          <Label>Merchant ID</Label>
          <Input
            placeholder="xxxxxxxxx"
            value={terminalCreds.cloverMerchantId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, cloverMerchantId: e.target.value })}
          />
        </div>
        <div>
          <Label>Device ID</Label>
          <Input
            placeholder="xxxxxxxxx"
            value={terminalCreds.cloverDeviceId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, cloverDeviceId: e.target.value })}
          />
        </div>
      </div>
    )}

    {/* Verifone fields */}
    {settings.config?.paymentMethods?.card?.provider === 'verifone' && (
      <div className="space-y-3">
        <div>
          <Label>API Key</Label>
          <Input
            type="password"
            placeholder="••••••••••••"
            value={terminalCreds.verifoneApiKey || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, verifoneApiKey: e.target.value })}
          />
        </div>
        <div>
          <Label>Merchant ID</Label>
          <Input
            placeholder="xxxxxxxxx"
            value={terminalCreds.verifoneMerchantId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, verifoneMerchantId: e.target.value })}
          />
        </div>
        <div>
          <Label>Terminal ID / IP</Label>
          <Input
            placeholder="192.168.1.x or terminal ID"
            value={terminalCreds.verifoneTerminalId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, verifoneTerminalId: e.target.value })}
          />
        </div>
      </div>
    )}

    {/* Dejavoo fields */}
    {settings.config?.paymentMethods?.card?.provider === 'dejavoo' && (
      <div className="space-y-3">
        <div>
          <Label>API Key</Label>
          <Input
            type="password"
            placeholder="••••••••••••"
            value={terminalCreds.dejavooApiKey || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, dejavooApiKey: e.target.value })}
          />
        </div>
        <div>
          <Label>Merchant ID</Label>
          <Input
            placeholder="xxxxxxxxx"
            value={terminalCreds.dejavooMerchantId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, dejavooMerchantId: e.target.value })}
          />
        </div>
        <div>
          <Label>Terminal ID</Label>
          <Input
            placeholder="xxxxxxxxx"
            value={terminalCreds.dejavooTerminalId || ''}
            onChange={(e) => setTerminalCreds({ ...terminalCreds, dejavooTerminalId: e.target.value })}
          />
        </div>
      </div>
    )}

    {/* Generic/Manual — no fields needed */}
    {(settings.config?.paymentMethods?.card?.provider === 'generic' ||
      !settings.config?.paymentMethods?.card?.provider) && (
      <p className="text-sm text-muted-foreground">
        Generic / Manual mode — auto-approves for testing. No credentials required.
      </p>
    )}
  </div>
)}
```

Add `RefreshCw` to the existing import from `lucide-react` if not already present.

- [ ] **Step 5: Build check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/AdminSettings.tsx
git commit -m "feat: add terminal credential fields to admin settings payments tab"
```

---

## Task 15: ReceiptDialog — Auth Code Display

**Files:**
- Modify: `src/components/ReceiptDialog.tsx`
- Modify: `src/pages/POS.tsx` (pass authCode prop)

- [ ] **Step 1: Add authCode prop to ReceiptDialogProps**

Open `src/components/ReceiptDialog.tsx`. In the `ReceiptDialogProps` interface (around line 36), add:

```typescript
interface ReceiptDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  total: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  paymentMethod?: string;
  items?: CartItem[];
  authCode?: string;   // ← add this
}
```

Update the destructured props:

```typescript
export default function ReceiptDialog({
  open,
  onClose,
  orderId,
  total,
  subtotal = 0,
  tax = 0,
  discount = 0,
  paymentMethod = 'cash',
  items = [],
  authCode,           // ← add this
}: ReceiptDialogProps) {
```

- [ ] **Step 2: Display auth code in the Transaction Info section**

Find the Transaction Info block (around line 298):

```tsx
{/* Transaction Info */}
<div className="text-center text-xs space-y-1">
  <p>{currentDate}</p>
  <p>Order #{orderId.slice(0, 8).toUpperCase()}</p>
  <p>Payment: {paymentMethod.toUpperCase()}</p>
  {authCode && <p>Auth: {authCode}</p>}   {/* ← add this line */}
</div>
```

- [ ] **Step 3: Pass authCode from POS.tsx**

In `POS.tsx`, find the `<ReceiptDialog>` usage (around line 797). Add:

```typescript
// Add state for last order auth code (near other lastOrder state vars):
const [lastOrderAuthCode, setLastOrderAuthCode] = useState<string | undefined>(undefined);
```

In `completeCardOrder`, after `setLastOrderPaymentMethod(selectedPaymentMethod);`:

```typescript
setLastOrderAuthCode(authCode);
```

In the existing non-card `handleCheckout` path, clear it:

```typescript
setLastOrderAuthCode(undefined);
```

In the `<ReceiptDialog>` JSX:

```tsx
<ReceiptDialog
  open={receiptDialogOpen}
  onClose={() => setReceiptDialogOpen(false)}
  orderId={lastOrderId}
  total={lastOrderTotal}
  subtotal={lastOrderSubtotal}
  tax={lastOrderTax}
  discount={lastOrderDiscount}
  paymentMethod={lastOrderPaymentMethod}
  authCode={lastOrderAuthCode}     {/* ← add this */}
  items={lastOrderItems.map(item => ({
    id: item.productId,
    name: item.nameSnapshot ?? '',
    price: item.price,
    quantity: item.quantity,
    size: item.size,
    color: item.color,
  }))}
/>
```

- [ ] **Step 4: Final build check**

```bash
npx tsc --noEmit
cd backend && npx tsc --noEmit
```
Expected: no errors in frontend or backend.

- [ ] **Step 5: Run all tests**

```bash
cd backend && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ReceiptDialog.tsx src/pages/POS.tsx
git commit -m "feat: display card auth code on receipt after terminal approval"
```

---

## Self-Review Checklist

- [x] **TerminalPort** defined in Task 1, used consistently in Tasks 2–11
- [x] `ChargeStatus`, `ChargeResult`, `ChargeMeta`, `TerminalReader` defined once and imported everywhere
- [x] `createTerminalAdapter` factory in Task 5 matches all 5 provider names used in AdminSettings (`stripe`, `square`, `clover`, `verifone`, `dejavoo`)
- [x] `TerminalTransactionCreate` and `TerminalTransactionUpdate` defined in Task 4, used in Task 6 routes
- [x] Order creation flow: `completeCardOrder` in Task 13 sends `cardTransactionId` + `cardAuthCode` → orders route in Task 12 stores them and links `terminal_transactions`
- [x] `stopTerminalPolling` cleanup on component unmount (Task 13 Step 6)
- [x] Auth code flows: terminal → `completeCardOrder` → `lastOrderAuthCode` state → ReceiptDialog prop (Task 15)
- [x] Migration is version 007, consistent with existing 001–006
- [x] Env var overrides in factory: `STRIPE_SECRET_KEY`, `SQUARE_ACCESS_TOKEN`, `CLOVER_API_TOKEN`, `VERIFONE_API_KEY`, `DEJAVOO_API_KEY`
