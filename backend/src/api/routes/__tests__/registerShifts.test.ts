import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Register shifts end to end through the real HTTP routes and the real
 * `services/pins.ts` / `services/registerShifts.ts` logic — only the
 * database adapter is faked, as an in-memory store (issue a device token,
 * then sign a cashier on, then check out a sale, then prove attribution),
 * same spirit as `registerEnrolment.test.ts`.
 */

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

interface FakeRegister {
  id: string;
  orgId: string;
  displayCode: string;
  status: string;
  requireSignIn: boolean;
  idleLockSeconds: number;
  hasCashDrawer: boolean;
  acceptsCash: boolean;
  canRefund: boolean;
  lastSeenAt: number | null;
}

interface FakeCredential {
  id: string;
  registerId: string;
  pairingCodePrefix: string;
  pairingCodeHash: string;
  pairingExpiresAt: number;
  tokenPrefix: string | null;
  tokenHash: string | null;
  enrolledAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  revokedBy: string | null;
  revokeReason: string | null;
  createdBy: string | null;
  createdAt: number;
}

interface FakeUser {
  id: string;
  name: string;
  email: string;
  status: string;
  orgId: string;
  pinHash: string | null;
  pinSetAt: number | null;
  pinFailedCount: number;
  pinLockedUntil: number | null;
  roleIds: string[];
  roles: unknown[];
}

interface FakeShift {
  id: string;
  registerId: string;
  userId: string;
  startedAt: number;
  lastActivityAt: number;
  endedAt: number | null;
  endReason: string | null;
  createdAt: number;
}

let registers: Map<string, FakeRegister>;
let credentials: Map<string, FakeCredential>;
let users: Map<string, FakeUser>;
let shifts: Map<string, FakeShift>;
let auditLogs: Record<string, unknown>[];
let orders: Record<string, unknown>[];
let seq: number;

function resetState(): void {
  registers = new Map();
  credentials = new Map();
  users = new Map();
  shifts = new Map();
  auditLogs = [];
  orders = [];
  seq = 0;
}
resetState();

async function getRegisterById(id: string): Promise<FakeRegister | null> {
  const row = registers.get(id);
  return row ? { ...row } : null;
}

async function getRegisters(filter: { orgId: string; status?: string }): Promise<FakeRegister[]> {
  return [...registers.values()].filter(
    (r) => r.orgId === filter.orgId && (!filter.status || r.status === filter.status)
  );
}

async function setRegisterStatus(id: string, status: string): Promise<FakeRegister | null> {
  const row = registers.get(id);
  if (!row) return null;
  row.status = status;
  return { ...row };
}

async function getOrgPolicy(): Promise<{ maxRegisters: number | null; pinLength: number } | null> {
  return { maxRegisters: null, pinLength: 6 };
}

// Device credential plumbing — same shape as registerEnrolment.test.ts.
async function getLiveUnredeemedPairingCredential(registerId: string): Promise<FakeCredential | null> {
  for (const row of credentials.values()) {
    if (row.registerId === registerId && row.revokedAt == null && row.tokenHash == null) return { ...row };
  }
  return null;
}
async function getLiveEnrolledCredential(registerId: string): Promise<FakeCredential | null> {
  for (const row of credentials.values()) {
    if (row.registerId === registerId && row.revokedAt == null && row.tokenHash != null) return { ...row };
  }
  return null;
}
async function getLiveRegisterCredentials(registerId: string): Promise<FakeCredential[]> {
  return [...credentials.values()].filter((row) => row.registerId === registerId && row.revokedAt == null);
}
async function createPairingCredential(payload: {
  registerId: string;
  pairingCodePrefix: string;
  pairingCodeHash: string;
  pairingExpiresAt: number;
  createdBy: string | null;
}): Promise<FakeCredential> {
  const id = `cred-${++seq}`;
  const row: FakeCredential = {
    id,
    registerId: payload.registerId,
    pairingCodePrefix: payload.pairingCodePrefix,
    pairingCodeHash: payload.pairingCodeHash,
    pairingExpiresAt: payload.pairingExpiresAt,
    tokenPrefix: null,
    tokenHash: null,
    enrolledAt: null,
    lastUsedAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    createdBy: payload.createdBy,
    createdAt: Date.now(),
  };
  credentials.set(id, row);
  return { ...row };
}
async function getPairingCredentialsByPrefix(prefix: string): Promise<FakeCredential[]> {
  return [...credentials.values()].filter((row) => row.pairingCodePrefix === prefix);
}
async function redeemPairingCredential(
  id: string,
  payload: { tokenPrefix: string; tokenHash: string; enrolledAt: number }
): Promise<FakeCredential | null> {
  const row = credentials.get(id);
  if (!row || row.enrolledAt != null || row.revokedAt != null) return null;
  row.tokenPrefix = payload.tokenPrefix;
  row.tokenHash = payload.tokenHash;
  row.enrolledAt = payload.enrolledAt;
  return { ...row };
}
async function getRegisterCredentialsByTokenPrefix(prefix: string): Promise<FakeCredential[]> {
  return [...credentials.values()].filter((row) => row.tokenPrefix === prefix);
}
async function touchRegisterCredentialLastUsed(id: string): Promise<void> {
  const row = credentials.get(id);
  if (row) row.lastUsedAt = Date.now();
}
async function revokeRegisterCredentialById(
  id: string,
  payload: { revokedBy: string | null; reason: string | null }
): Promise<FakeCredential | null> {
  const row = credentials.get(id);
  if (!row || row.revokedAt != null) return null;
  row.revokedAt = Date.now();
  row.revokedBy = payload.revokedBy;
  row.revokeReason = payload.reason;
  return { ...row };
}

// Users / PINs
async function getUserByEmail(email: string): Promise<FakeUser | null> {
  for (const row of users.values()) {
    if (row.email === email) return { ...row };
  }
  return null;
}
async function getUserById(id: string): Promise<FakeUser | null> {
  const row = users.get(id);
  return row ? { ...row } : null;
}
async function getActiveUsersWithPin(orgId: string): Promise<FakeUser[]> {
  return [...users.values()].filter((u) => u.orgId === orgId && u.status === 'active' && u.pinHash != null);
}
async function setUserPin(
  userId: string,
  payload: { pinHash: string; pinSetAt: number }
): Promise<Record<string, unknown> | null> {
  const row = users.get(userId);
  if (!row) return null;
  row.pinHash = payload.pinHash;
  row.pinSetAt = payload.pinSetAt;
  row.pinFailedCount = 0;
  row.pinLockedUntil = null;
  return { id: row.id, name: row.name, status: row.status };
}
async function recordPinFailure(
  userId: string,
  payload: { failedCount: number; lockedUntil: number | null }
): Promise<void> {
  const row = users.get(userId);
  if (!row) return;
  row.pinFailedCount = payload.failedCount;
  row.pinLockedUntil = payload.lockedUntil;
}
async function resetPinFailures(userId: string): Promise<void> {
  const row = users.get(userId);
  if (!row) return;
  row.pinFailedCount = 0;
  row.pinLockedUntil = null;
}

// Shifts
async function getOpenShiftForRegister(registerId: string): Promise<FakeShift | null> {
  for (const row of shifts.values()) {
    if (row.registerId === registerId && row.endedAt == null) return { ...row };
  }
  return null;
}
async function createRegisterShift(payload: { registerId: string; userId: string }): Promise<FakeShift> {
  const id = `shift-${++seq}`;
  const now = Date.now();
  const row: FakeShift = {
    id,
    registerId: payload.registerId,
    userId: payload.userId,
    startedAt: now,
    lastActivityAt: now,
    endedAt: null,
    endReason: null,
    createdAt: now,
  };
  shifts.set(id, row);
  return { ...row };
}
async function endRegisterShift(shiftId: string, reason: string): Promise<FakeShift | null> {
  const row = shifts.get(shiftId);
  if (!row || row.endedAt != null) return null;
  row.endedAt = Date.now();
  row.endReason = reason;
  return { ...row };
}
async function touchRegisterShiftActivity(shiftId: string): Promise<FakeShift | null> {
  const row = shifts.get(shiftId);
  if (!row || row.endedAt != null) return null;
  row.lastActivityAt = Date.now();
  return { ...row };
}

/**
 * The shift log's read side. Faked at the same level as the rest of this
 * file: the SQL itself is covered against a real Postgres in
 * `pinsAndShifts.integration.test.ts` and against real SQLite in
 * `sqliteQueries.test.ts`. What the route test is for is the parts those
 * cannot see — that `/shifts` is matched before `/:id`, that the query string
 * is parsed and validated, and that the response carries usable pagination.
 */
async function getRegisterShifts(filter: {
  orgId: string;
  limit: number;
  offset: number;
  registerId?: string;
  userId?: string;
  openOnly?: boolean;
  from?: number;
  to?: number;
}): Promise<{ shifts: Record<string, unknown>[]; total: number }> {
  let rows = [...shifts.values()];
  if (filter.registerId) rows = rows.filter((row) => row.registerId === filter.registerId);
  if (filter.userId) rows = rows.filter((row) => row.userId === filter.userId);
  if (filter.openOnly) rows = rows.filter((row) => row.endedAt == null);
  if (filter.from !== undefined) rows = rows.filter((row) => row.startedAt >= filter.from!);
  if (filter.to !== undefined) rows = rows.filter((row) => row.startedAt <= filter.to!);

  rows.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));

  return {
    shifts: rows
      .slice(filter.offset, filter.offset + filter.limit)
      .map((row) => ({ ...row, cashierName: users.get(row.userId)?.name ?? null })),
    total: rows.length,
  };
}

async function createAuditLog(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  auditLogs.push(payload);
  return payload;
}

// Orders / returns, for attribution tests.
const getProductById = vi.fn();
const getSettings = vi.fn();
const getOpenDrawerSession = vi.fn();
const getOrderById = vi.fn();
const getReturnsByOrder = vi.fn();
async function createOrder(order: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = { id: `o-${++seq}`, createdAt: Date.now(), ...order };
  orders.push(row);
  return row;
}
const createReturn = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getRegisterById,
      getRegisters,
      setRegisterStatus,
      getOrgPolicy,
      getLiveUnredeemedPairingCredential,
      getLiveEnrolledCredential,
      getLiveRegisterCredentials,
      createPairingCredential,
      getPairingCredentialsByPrefix,
      redeemPairingCredential,
      getRegisterCredentialsByTokenPrefix,
      touchRegisterCredentialLastUsed,
      revokeRegisterCredentialById,
      getUserByEmail,
      getUserById,
      getActiveUsersWithPin,
      setUserPin,
      recordPinFailure,
      resetPinFailures,
      getOpenShiftForRegister,
      createRegisterShift,
      endRegisterShift,
      touchRegisterShiftActivity,
      getRegisterShifts,
      createAuditLog,
      getProductById,
      getSettings,
      getOpenDrawerSession,
      createOrder,
      getOrderById,
      getReturnsByOrder,
      createReturn,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');
const { setPin } = await import('../../../services/pins');
const dbModule = await import('../../../services/database');

function adminToken(): string {
  return jwt.sign({ id: 'admin-1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function adminAuth() {
  return { Authorization: `Bearer ${adminToken()}` };
}

const TEA = { id: 'p-tea', name: 'Tea', basePrice: 5, variants: [{ id: 'v1', stock: 100, enabled: true }] };
const CART = { items: [{ productId: 'p-tea', variantId: 'v1', quantity: 1 }] };

beforeEach(() => {
  vi.clearAllMocks();
  resetState();

  users.set('admin-1', {
    id: 'admin-1',
    name: 'Admin',
    email: 'admin@example.com',
    status: 'active',
    orgId: DEFAULT_ORG_ID,
    pinHash: null,
    pinSetAt: null,
    pinFailedCount: 0,
    pinLockedUntil: null,
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });

  registers.set('rA', {
    id: 'rA',
    orgId: DEFAULT_ORG_ID,
    displayCode: 'MAIN-01',
    status: 'pending',
    requireSignIn: false,
    idleLockSeconds: 300,
    hasCashDrawer: true,
    acceptsCash: true,
    canRefund: true,
    lastSeenAt: null,
  });

  // A second till in the same shop. Needed to prove the PIN rate limiter is
  // scoped per register rather than per IP - both of these are reached from
  // the same supertest client, i.e. the same address.
  registers.set('rB', {
    id: 'rB',
    orgId: DEFAULT_ORG_ID,
    displayCode: 'MAIN-02',
    status: 'pending',
    requireSignIn: false,
    idleLockSeconds: 300,
    hasCashDrawer: true,
    acceptsCash: true,
    canRefund: true,
    lastSeenAt: null,
  });

  getProductById.mockResolvedValue(TEA);
  getSettings.mockResolvedValue({ taxRateDefault: 0 });
  getOpenDrawerSession.mockResolvedValue(null);
  getOrderById.mockResolvedValue({
    id: 'ord-1',
    total: 10,
    subtotal: 10,
    taxTotal: 0,
    items: [{ id: 'oi1', productId: 'p1', nameSnapshot: 'Tea', quantity: 1, unitPrice: 10, lineTotal: 10 }],
  });
  getReturnsByOrder.mockResolvedValue([]);
  createReturn.mockImplementation(async (payload: Record<string, unknown>) => ({ id: 'ret-1', ...payload }));
});

/** Add an active cashier with a PIN already set, directly through the adapter — bypasses HTTP. */
async function addCashier(id: string, name: string, pin: string): Promise<void> {
  users.set(id, {
    id,
    name,
    email: `${id}@example.com`,
    status: 'active',
    orgId: DEFAULT_ORG_ID,
    pinHash: null,
    pinSetAt: null,
    pinFailedCount: 0,
    pinLockedUntil: null,
    roleIds: [],
    roles: [],
  });
  const result = await setPin(dbModule.default.getAdapter(), DEFAULT_ORG_ID, id, pin);
  if (typeof result !== 'object') throw new Error(`expected setPin to succeed, got ${result}`);
}

/** Issues and redeems a pairing code for `registerId`, returning the device token. */
async function enroll(registerId: string): Promise<string> {
  const issued = await request(app).post(`/api/registers/${registerId}/pairing-code`).set(adminAuth());
  expect(issued.status).toBe(201);
  const redeemed = await request(app).post('/api/registers/pair').send({ code: issued.body.data.code });
  expect(redeemed.status).toBe(201);
  return redeemed.body.data.token as string;
}

describe('POST /api/registers/:id/shifts', () => {
  it('signs a cashier on and returns the shift and their name, never a token', async () => {
    const token = await enroll('rA');
    await addCashier('u1', 'Casey', '123456');

    const response = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '123456' });

    expect(response.status).toBe(201);
    expect(response.body.data.cashier).toEqual({ id: 'u1', name: 'Casey' });
    expect(response.body.data.shift.registerId).toBe('rA');
    expect(response.body.data.shift.userId).toBe('u1');
    // The response body must contain nothing token-shaped: a PIN sign-in is
    // deliberately not a session.
    expect(JSON.stringify(response.body)).not.toMatch(/token/i);
  });

  it('refuses a PIN that matches nobody', async () => {
    const token = await enroll('rA');
    await addCashier('u1', 'Casey', '123456');

    const response = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('PIN_INVALID');
  });

  it('cannot be started on a register that is not active', async () => {
    // 'rA' starts 'pending' by default in this file — never activated.
    const token = await enroll('rA');
    // enroll() activates the register as a side effect of redeeming the
    // pairing code, so deactivate it again to exercise this path.
    await setRegisterStatus('rA', 'disabled');
    await addCashier('u1', 'Casey', '123456');

    const response = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '123456' });

    expect(response.status).toBe(422);
  });

  it('starting a second shift supersedes the first', async () => {
    const token = await enroll('rA');
    await addCashier('u1', 'Casey', '111111');
    await addCashier('u2', 'Riley', '222222');

    const first = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '111111' });
    expect(first.status).toBe(201);
    const firstShiftId = first.body.data.shift.id;

    const second = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '222222' });
    expect(second.status).toBe(201);

    const firstShiftAfter = shifts.get(String(firstShiftId))!;
    expect(firstShiftAfter.endedAt).not.toBeNull();
    expect(firstShiftAfter.endReason).toBe('superseded');

    const current = await request(app).get('/api/registers/rA/shifts/current').set('X-Register-Token', token);
    expect(current.body.data.cashier.id).toBe('u2');
  });

  it('requires a valid X-Register-Token', async () => {
    await addCashier('u1', 'Casey', '123456');

    const response = await request(app).post('/api/registers/rA/shifts').send({ pin: '123456' });

    expect(response.status).toBe(401);
  });
});

describe('POST /api/registers/:id/shifts/end', () => {
  it('signs the current cashier out', async () => {
    const token = await enroll('rA');
    await addCashier('u1', 'Casey', '123456');
    await request(app).post('/api/registers/rA/shifts').set('X-Register-Token', token).send({ pin: '123456' });

    const response = await request(app).post('/api/registers/rA/shifts/end').set('X-Register-Token', token);

    expect(response.status).toBe(200);
    expect(response.body.data.shift.endReason).toBe('signed_out');

    const current = await request(app).get('/api/registers/rA/shifts/current').set('X-Register-Token', token);
    expect(current.body.data).toBeNull();
  });

  it('404s when nothing is open', async () => {
    const token = await enroll('rA');

    const response = await request(app).post('/api/registers/rA/shifts/end').set('X-Register-Token', token);

    expect(response.status).toBe(404);
  });
});

describe('GET /api/registers/:id/shifts/current', () => {
  it('reports null when no one is signed in', async () => {
    const token = await enroll('rA');

    const response = await request(app).get('/api/registers/rA/shifts/current').set('X-Register-Token', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it('reports the signed-in cashier', async () => {
    const token = await enroll('rA');
    await addCashier('u1', 'Casey', '123456');
    await request(app).post('/api/registers/rA/shifts').set('X-Register-Token', token).send({ pin: '123456' });

    const response = await request(app).get('/api/registers/rA/shifts/current').set('X-Register-Token', token);

    expect(response.body.data.cashier).toEqual({ id: 'u1', name: 'Casey' });
  });
});

describe('checkout attribution', () => {
  it('attributes an order to the signed-in cashier, not the authenticated session user', async () => {
    const token = await enroll('rA');
    await addCashier('cashier-1', 'Casey the Cashier', '123456');
    await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '123456' });

    // The admin's own session is what authenticates this HTTP request — a
    // manager glancing at the till, not the person actually ringing the
    // sale. Attribution must follow the open shift, not this session.
    const response = await request(app)
      .post('/api/orders')
      .set(adminAuth())
      .set('X-Register-Id', 'rA')
      .send({ ...CART, paymentMethod: 'Cash' });

    expect(response.status).toBe(201);
    expect(response.body.data.cashierUserId).toBe('cashier-1');
    expect(response.body.data.cashierUserId).not.toBe('admin-1');
  });

  it('falls back to the session user when no shift is open and sign-in is not required', async () => {
    await enroll('rA'); // activates the register; no shift is ever started

    const response = await request(app)
      .post('/api/orders')
      .set(adminAuth())
      .set('X-Register-Id', 'rA')
      .send({ ...CART, paymentMethod: 'Cash' });

    expect(response.status).toBe(201);
    expect(response.body.data.cashierUserId).toBe('admin-1');
  });

  it('refuses checkout with SHIFT_REQUIRED on a register that requires sign-in and has no open shift', async () => {
    await enroll('rA');
    registers.get('rA')!.requireSignIn = true;

    const response = await request(app)
      .post('/api/orders')
      .set(adminAuth())
      .set('X-Register-Id', 'rA')
      .send({ ...CART, paymentMethod: 'Cash' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SHIFT_REQUIRED');
    expect(orders).toHaveLength(0);
  });

  it('lets checkout through on a require-sign-in register once a shift is open', async () => {
    const token = await enroll('rA');
    registers.get('rA')!.requireSignIn = true;
    await addCashier('cashier-1', 'Casey', '123456');
    await request(app).post('/api/registers/rA/shifts').set('X-Register-Token', token).send({ pin: '123456' });

    const response = await request(app)
      .post('/api/orders')
      .set(adminAuth())
      .set('X-Register-Id', 'rA')
      .send({ ...CART, paymentMethod: 'Cash' });

    expect(response.status).toBe(201);
    expect(response.body.data.cashierUserId).toBe('cashier-1');
  });

  it('bumps the shift\'s activity clock on a completed sale', async () => {
    const token = await enroll('rA');
    await addCashier('cashier-1', 'Casey', '123456');
    const started = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '123456' });
    const shiftId = String(started.body.data.shift.id);
    shifts.get(shiftId)!.lastActivityAt = Date.now() - 10_000;

    await request(app)
      .post('/api/orders')
      .set(adminAuth())
      .set('X-Register-Id', 'rA')
      .send({ ...CART, paymentMethod: 'Cash' });

    expect(shifts.get(shiftId)!.lastActivityAt).toBeGreaterThan(Date.now() - 1000);
  });

  it('refuses a return with SHIFT_REQUIRED the same way checkout does', async () => {
    await enroll('rA');
    registers.get('rA')!.requireSignIn = true;

    const response = await request(app)
      .post('/api/returns')
      .set(adminAuth())
      .set('X-Register-Id', 'rA')
      .send({
        originalOrderId: 'ord-1',
        returnType: 'return',
        items: [
          {
            originalOrderItemId: 'oi1',
            productId: 'p1',
            nameSnapshot: 'Tea',
            originalQuantity: 1,
            returnQuantity: 1,
            unitPrice: 10,
            lineTotal: 10,
          },
        ],
        subtotal: 10,
        total: 10,
        refundMethod: 'cash',
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SHIFT_REQUIRED');
    expect(createReturn).not.toHaveBeenCalled();
  });
});

/**
 * Kept last in the file, same reason as `registerEnrolment.test.ts`'s
 * equivalent block: `shiftLimiter`'s budget is shared across every test here,
 * since they all reuse the one `app` instance, and this test deliberately
 * exhausts it.
 */
describe('POST /api/registers/:id/shifts rate limiting', () => {
  it('keeps each till on its own budget, so one cannot exhaust another', async () => {
    // The limiter is keyed on the register, not the caller's IP, and this is
    // the assertion that pins that down. Three tills in a shop share one NAT
    // address, so IP keying would let a busy lane - or someone guessing PINs at
    // it - lock out a quiet lane that has done nothing wrong. Both registers
    // here come from the same supertest client, i.e. the same address, so this
    // only passes while the key is the register.
    const tokenA = await enroll('rA');
    const tokenB = await enroll('rB');
    await addCashier('u1', 'Casey', '123456');

    for (let i = 0; i < config.rateLimit.maxShiftAttempts + 15; i++) {
      await request(app)
        .post('/api/registers/rA/shifts')
        .set('X-Register-Token', tokenA)
        .send({ pin: '000000' });
    }

    const onA = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', tokenA)
      .send({ pin: '000000' });
    expect(onA.status).toBe(429);

    // The other till is untouched, and a *correct* PIN there still signs on.
    const onB = await request(app)
      .post('/api/registers/rB/shifts')
      .set('X-Register-Token', tokenB)
      .send({ pin: '123456' });
    expect(onB.status).not.toBe(429);
  });

  it('eventually blocks repeated PIN attempts from one address', async () => {
    const token = await enroll('rA');
    await addCashier('u1', 'Casey', '123456');

    let blocked = 0;
    for (let i = 0; i < config.rateLimit.maxShiftAttempts + 15; i++) {
      const response = await request(app)
        .post('/api/registers/rA/shifts')
        .set('X-Register-Token', token)
        .send({ pin: '000000' });
      if (response.status === 429) blocked++;
    }

    expect(blocked).toBeGreaterThan(0);
  });
});

/**
 * The shift log. Nothing in the app could ask "who was on this till on
 * Tuesday" before this route existed — every other shift endpoint answers
 * only "who is on it right now", which is all a till needs and none of what a
 * manager needs.
 *
 * Shifts are seeded straight into the fake store rather than rung up through
 * `POST /:id/shifts`. That route is behind a PIN rate limiter which the
 * throttling suite above deliberately exhausts, so driving it from here made
 * these tests pass alone and fail in the file — and it is the GET under test
 * either way.
 */
describe('GET /api/registers/shifts', () => {
  function seedCashier(id: string, name: string): void {
    users.set(id, {
      id,
      name,
      email: `${id}@example.com`,
      status: 'active',
      orgId: DEFAULT_ORG_ID,
      pinHash: null,
      pinSetAt: null,
      pinFailedCount: 0,
      pinLockedUntil: null,
      roleIds: [],
      roles: [],
    });
  }

  function seedShift(
    registerId: string,
    userId: string,
    startedAt: number,
    endReason: string | null = null
  ): FakeShift {
    const id = `seeded-shift-${++seq}`;
    const row: FakeShift = {
      id,
      registerId,
      userId,
      startedAt,
      lastActivityAt: startedAt,
      endedAt: endReason ? startedAt + 60_000 : null,
      endReason,
      createdAt: startedAt,
    };
    shifts.set(id, row);
    return row;
  }

  const TUESDAY = Date.parse('2026-08-18T09:00:00.000Z');

  it('lists shifts newest first, with the cashier named rather than a bare id', async () => {
    seedCashier('u1', 'Casey');
    seedShift('rA', 'u1', TUESDAY, 'signed_out');
    seedShift('rA', 'u1', TUESDAY + 3_600_000);

    const response = await request(app).get('/api/registers/shifts').set(adminAuth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].endedAt).toBeNull();
    expect(response.body.data[1].endReason).toBe('signed_out');
    expect(response.body.data[0].cashierName).toBe('Casey');
    expect(response.body.meta).toMatchObject({ total: 2, limit: 50, offset: 0, hasMore: false });
  });

  it('is matched ahead of GET /:id, not read as a register named "shifts"', async () => {
    // `/shifts` and `/:id` are both single-segment routes on this router, so
    // this holds only while `/shifts` is registered first. A register-shaped
    // body here means someone moved it below and Express looked one up by
    // that name.
    const response = await request(app).get('/api/registers/shifts').set(adminAuth());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('filters to whoever is on the floor right now', async () => {
    seedCashier('u1', 'Casey');
    seedCashier('u2', 'Rae');
    seedShift('rA', 'u1', TUESDAY, 'signed_out');
    seedShift('rB', 'u2', TUESDAY + 1000);

    const response = await request(app).get('/api/registers/shifts?openOnly=true').set(adminAuth());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].cashierName).toBe('Rae');
  });

  it('filters by register and by cashier', async () => {
    seedCashier('u1', 'Casey');
    seedCashier('u2', 'Rae');
    seedShift('rA', 'u1', TUESDAY, 'signed_out');
    seedShift('rB', 'u2', TUESDAY + 1000, 'signed_out');

    const byRegister = await request(app).get('/api/registers/shifts?registerId=rB').set(adminAuth());
    expect(byRegister.body.data).toHaveLength(1);
    expect(byRegister.body.data[0].registerId).toBe('rB');

    const byCashier = await request(app).get('/api/registers/shifts?userId=u1').set(adminAuth());
    expect(byCashier.body.data).toHaveLength(1);
    expect(byCashier.body.data[0].userId).toBe('u1');
  });

  it('filters by the day a shift started, which is the question the log is for', async () => {
    seedCashier('u1', 'Casey');
    seedShift('rA', 'u1', TUESDAY, 'signed_out');
    seedShift('rA', 'u1', TUESDAY + 7 * 24 * 3_600_000, 'signed_out');

    const response = await request(app)
      .get(`/api/registers/shifts?from=${TUESDAY - 3_600_000}&to=${TUESDAY + 3_600_000}`)
      .set(adminAuth());

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(1);
  });

  it('pages, reporting a total counted before the limit', async () => {
    seedCashier('u1', 'Casey');
    seedShift('rA', 'u1', TUESDAY, 'signed_out');
    seedShift('rA', 'u1', TUESDAY + 1000, 'signed_out');

    const response = await request(app).get('/api/registers/shifts?limit=1').set(adminAuth());

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toMatchObject({ total: 2, hasMore: true, page: 1 });
  });

  it('refuses a range that ends before it starts, rather than returning nothing', async () => {
    const response = await request(app)
      .get('/api/registers/shifts?from=2000&to=1000')
      .set(adminAuth());

    expect(response.status).toBe(400);
  });

  it('refuses a limit beyond the cap instead of holding an unbounded result set', async () => {
    const response = await request(app).get('/api/registers/shifts?limit=5000').set(adminAuth());

    expect(response.status).toBe(400);
  });

  it('needs a session: a device token is not a back-office credential', async () => {
    const response = await request(app).get('/api/registers/shifts').set('X-Register-Token', 'not-a-session');

    expect(response.status).toBe(401);
  });
});
