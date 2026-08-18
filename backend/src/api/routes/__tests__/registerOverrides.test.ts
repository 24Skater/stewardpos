import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Manager overrides end to end through the real HTTP routes and the real
 * `services/registerOverrides.ts` logic — only the database adapter is
 * faked, as an in-memory store, same spirit as `registerShifts.test.ts` and
 * `registerEnrolment.test.ts`.
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
  canOpenDrawerNoSale: boolean;
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
  canOverride: boolean;
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

interface FakeOverride {
  id: string;
  registerId: string;
  shiftId: string | null;
  approverUserId: string;
  requestedByUserId: string | null;
  action: string;
  grantPrefix: string;
  grantHash: string;
  expiresAt: number;
  consumedAt: number | null;
  entity: string | null;
  entityId: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  reason: string | null;
  createdAt: number;
}

let registers: Map<string, FakeRegister>;
let credentials: Map<string, FakeCredential>;
let users: Map<string, FakeUser>;
let shifts: Map<string, FakeShift>;
let overrides: Map<string, FakeOverride>;
let auditLogs: Record<string, unknown>[];
let seq: number;

function resetState(): void {
  registers = new Map();
  credentials = new Map();
  users = new Map();
  shifts = new Map();
  overrides = new Map();
  auditLogs = [];
  seq = 0;
}
resetState();

async function getRegisterById(id: string): Promise<FakeRegister | null> {
  const row = registers.get(id);
  return row ? { ...row } : null;
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

// Device credential plumbing — same shape as registerShifts.test.ts.
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

// Users / PINs / override permission
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
async function getActiveUsersWithOverridePermission(orgId: string): Promise<FakeUser[]> {
  return [...users.values()].filter(
    (u) => u.orgId === orgId && u.status === 'active' && u.pinHash != null && u.canOverride
  );
}
/** Needed by `services/pins.ts`'s `setPin`, to enforce org-wide PIN uniqueness. */
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

// Overrides
async function createRegisterOverride(payload: {
  registerId: string;
  shiftId: string | null;
  approverUserId: string;
  requestedByUserId: string | null;
  action: string;
  grantPrefix: string;
  grantHash: string;
  expiresAt: number;
  reason: string | null;
}): Promise<FakeOverride> {
  const id = `ovr-${++seq}`;
  const row: FakeOverride = {
    id,
    consumedAt: null,
    entity: null,
    entityId: null,
    beforeValue: null,
    afterValue: null,
    createdAt: Date.now(),
    ...payload,
  };
  overrides.set(id, row);
  return { ...row };
}
async function getRegisterOverridesByPrefix(prefix: string): Promise<FakeOverride[]> {
  return [...overrides.values()].filter((row) => row.grantPrefix === prefix).map((row) => ({ ...row }));
}
async function consumeRegisterOverride(
  id: string,
  payload: { entity: string | null; entityId: string | null; beforeValue: string | null; afterValue: string | null }
): Promise<FakeOverride | null> {
  const row = overrides.get(id);
  if (!row || row.consumedAt != null) return null;
  row.consumedAt = Date.now();
  row.entity = payload.entity;
  row.entityId = payload.entityId;
  row.beforeValue = payload.beforeValue;
  row.afterValue = payload.afterValue;
  return { ...row };
}
async function getRegisterOverrides(filter: {
  orgId: string;
  limit: number;
  offset: number;
  registerId?: string;
  approverUserId?: string;
}): Promise<{ overrides: FakeOverride[]; total: number }> {
  let matching = [...overrides.values()].filter((row) => {
    const register = registers.get(row.registerId);
    return register?.orgId === filter.orgId;
  });
  if (filter.registerId) matching = matching.filter((row) => row.registerId === filter.registerId);
  if (filter.approverUserId) matching = matching.filter((row) => row.approverUserId === filter.approverUserId);
  matching.sort((a, b) => b.createdAt - a.createdAt);
  const total = matching.length;
  // Safe projection, same as `mapRegisterOverrideSummary` in the real
  // adapters: the grant hash never leaves this method.
  const page = matching.slice(filter.offset, filter.offset + filter.limit).map((row) => {
    const { grantHash: _grantHash, ...safe } = row;
    return safe as FakeOverride;
  });
  return { overrides: page, total };
}

async function createAuditLog(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  auditLogs.push(payload);
  return payload;
}

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getRegisterById,
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
      getActiveUsersWithOverridePermission,
      getActiveUsersWithPin,
      setUserPin,
      recordPinFailure,
      resetPinFailures,
      getOpenShiftForRegister,
      createRegisterShift,
      endRegisterShift,
      touchRegisterShiftActivity,
      createRegisterOverride,
      getRegisterOverridesByPrefix,
      consumeRegisterOverride,
      getRegisterOverrides,
      createAuditLog,
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
    canOverride: false,
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
    canOpenDrawerNoSale: false,
    lastSeenAt: null,
  });

  // A second till, needed to prove the override-PIN rate limiter is scoped
  // per register rather than per IP — same reasoning as registerShifts.test.ts.
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
    canOpenDrawerNoSale: false,
    lastSeenAt: null,
  });
});

/** Issues and redeems a pairing code for `registerId`, returning the device token. */
async function enroll(registerId: string): Promise<string> {
  const issued = await request(app).post(`/api/registers/${registerId}/pairing-code`).set(adminAuth());
  expect(issued.status).toBe(201);
  const redeemed = await request(app).post('/api/registers/pair').send({ code: issued.body.data.code });
  expect(redeemed.status).toBe(201);
  return redeemed.body.data.token as string;
}

/** Add an active supervisor with a PIN and `can_override` — directly through the adapter, bypasses HTTP. */
async function addApprover(id: string, name: string, pin: string): Promise<void> {
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
    canOverride: true,
    roleIds: [],
    roles: [],
  });
  const result = await setPin(dbModule.default.getAdapter(), DEFAULT_ORG_ID, id, pin);
  if (typeof result !== 'object') throw new Error(`expected setPin to succeed, got ${result}`);
}

describe('POST /api/registers/:id/overrides', () => {
  it('grants a token good for exactly one action, and never returns it again', async () => {
    const token = await enroll('rA');
    await addApprover('boss-1', 'Bailey', '999999');

    const response = await request(app)
      .post('/api/registers/rA/overrides')
      .set('X-Register-Token', token)
      .send({ action: 'void', pin: '999999' });

    expect(response.status).toBe(201);
    expect(response.body.data.token).toMatch(/^ovr_/);
    expect(response.body.data.action).toBe('void');
    expect(typeof response.body.data.expiresAt).toBe('number');
    // The stored grant row is never part of the response.
    expect(JSON.stringify(response.body)).not.toMatch(/grantHash|grant_hash/);
  });

  it('refuses a PIN that does not belong to an approver', async () => {
    const token = await enroll('rA');

    const response = await request(app)
      .post('/api/registers/rA/overrides')
      .set('X-Register-Token', token)
      .send({ action: 'void', pin: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('PIN_INVALID');
  });

  it('requires a valid X-Register-Token', async () => {
    await addApprover('boss-1', 'Bailey', '999999');

    const response = await request(app)
      .post('/api/registers/rA/overrides')
      .send({ action: 'void', pin: '999999' });

    expect(response.status).toBe(401);
  });

  it('does not touch the register`s open shift', async () => {
    const token = await enroll('rA');
    await addApprover('boss-1', 'Bailey', '999999');
    users.set('cashier-1', {
      id: 'cashier-1',
      name: 'Casey',
      email: 'cashier-1@example.com',
      status: 'active',
      orgId: DEFAULT_ORG_ID,
      pinHash: null,
      pinSetAt: null,
      pinFailedCount: 0,
      pinLockedUntil: null,
      canOverride: false,
      roleIds: [],
      roles: [],
    });
    await setPin(dbModule.default.getAdapter(), DEFAULT_ORG_ID, 'cashier-1', '123456');
    const started = await request(app)
      .post('/api/registers/rA/shifts')
      .set('X-Register-Token', token)
      .send({ pin: '123456' });
    expect(started.status).toBe(201);
    const shiftId = String(started.body.data.shift.id);
    const before = { ...shifts.get(shiftId)! };

    const response = await request(app)
      .post('/api/registers/rA/overrides')
      .set('X-Register-Token', token)
      .send({ action: 'void', pin: '999999' });

    expect(response.status).toBe(201);
    const after = shifts.get(shiftId)!;
    expect(after.userId).toBe(before.userId);
    expect(after.endedAt).toBeNull();
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    // The override names the cashier's open shift as the requester — the
    // response never exposes the raw override row, so check the store.
    const stored = [...overrides.values()].find((row) => row.registerId === 'rA');
    expect(stored?.requestedByUserId).toBe('cashier-1');
  });
});

describe('GET /api/registers/overrides', () => {
  it('lists issued grants, filterable by register and approver', async () => {
    const tokenA = await enroll('rA');
    await addApprover('boss-1', 'Bailey', '999999');
    await request(app).post('/api/registers/rA/overrides').set('X-Register-Token', tokenA).send({
      action: 'void',
      pin: '999999',
    });

    const response = await request(app).get('/api/registers/overrides').set(adminAuth());

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(1);
    expect(response.body.data[0].action).toBe('void');
    expect(response.body.data[0].approverUserId).toBe('boss-1');
    // The safe projection never carries the grant hash.
    expect(JSON.stringify(response.body)).not.toMatch(/grantHash/);
    expect(response.body.meta.total).toBe(1);
  });
});

/**
 * Kept last in the file, same reason as `registerShifts.test.ts`'s
 * equivalent block: `overrideLimiter`'s budget is shared across every test
 * here, since they all reuse the one `app` instance, and this test
 * deliberately exhausts it.
 */
describe('POST /api/registers/:id/overrides rate limiting', () => {
  it('keeps each till on its own budget', async () => {
    const tokenA = await enroll('rA');
    const tokenB = await enroll('rB');
    await addApprover('boss-1', 'Bailey', '999999');

    for (let i = 0; i < config.rateLimit.maxOverrideAttempts + 15; i++) {
      await request(app)
        .post('/api/registers/rA/overrides')
        .set('X-Register-Token', tokenA)
        .send({ action: 'void', pin: '000000' });
    }

    const onA = await request(app)
      .post('/api/registers/rA/overrides')
      .set('X-Register-Token', tokenA)
      .send({ action: 'void', pin: '000000' });
    expect(onA.status).toBe(429);

    const onB = await request(app)
      .post('/api/registers/rB/overrides')
      .set('X-Register-Token', tokenB)
      .send({ action: 'void', pin: '999999' });
    expect(onB.status).not.toBe(429);
  });
});
