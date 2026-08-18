import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Register enrolment: pairing, redeeming, heartbeating, and revoking a
 * device credential, end to end through the real HTTP routes and the real
 * `services/registerEnrolment.ts` logic — only the database adapter is
 * faked, as an in-memory store rather than independent `vi.fn()` stubs,
 * because these flows genuinely need state to carry across requests (issue
 * a code, then redeem it; redeem it, then revoke it; revoke it, then prove
 * the old token is dead).
 */

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG_ID = '11111111-1111-1111-1111-111111111111';

interface FakeRegister {
  id: string;
  orgId: string;
  displayCode: string;
  status: string;
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

let registers: Map<string, FakeRegister>;
let credentials: Map<string, FakeCredential>;
let drawerSessions: Map<string, Record<string, unknown>>;
let credentialSeq: number;

function resetState(): void {
  registers = new Map();
  credentials = new Map();
  drawerSessions = new Map();
  credentialSeq = 0;
}
resetState();

const getUserByEmail = vi.fn();
const createAuditLog = vi.fn();
const createOrder = vi.fn();
const getExpectedDrawerCash = vi.fn();
const closeDrawerSession = vi.fn();
const getRegisters = vi.fn();

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

async function touchRegisterLastSeen(id: string): Promise<FakeRegister | null> {
  const row = registers.get(id);
  if (!row) return null;
  row.lastSeenAt = Date.now();
  return { ...row };
}

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
  return [...credentials.values()]
    .filter((row) => row.registerId === registerId && row.revokedAt == null)
    .map((row) => ({ ...row }));
}

async function createPairingCredential(payload: {
  registerId: string;
  pairingCodePrefix: string;
  pairingCodeHash: string;
  pairingExpiresAt: number;
  createdBy: string | null;
}): Promise<FakeCredential> {
  const id = `cred-${++credentialSeq}`;
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
  return [...credentials.values()].filter((row) => row.pairingCodePrefix === prefix).map((row) => ({ ...row }));
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
  return [...credentials.values()].filter((row) => row.tokenPrefix === prefix).map((row) => ({ ...row }));
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

async function getOpenDrawerSession(registerId: string): Promise<Record<string, unknown> | null> {
  const row = drawerSessions.get(registerId);
  return row ? { ...row } : null;
}

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      createAuditLog,
      createOrder,
      getExpectedDrawerCash,
      closeDrawerSession,
      getRegisters,
      getRegisterById,
      setRegisterStatus,
      touchRegisterLastSeen,
      getLiveUnredeemedPairingCredential,
      getLiveEnrolledCredential,
      getLiveRegisterCredentials,
      createPairingCredential,
      getPairingCredentialsByPrefix,
      redeemPairingCredential,
      getRegisterCredentialsByTokenPrefix,
      touchRegisterCredentialLastUsed,
      revokeRegisterCredentialById,
      getOpenDrawerSession,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function jwtFor(email: string): string {
  return jwt.sign({ id: `u-${email}`, email, roleIds: ['r1'] }, config.jwt.secret, { expiresIn: '1h' });
}

const REGISTERS_FULL_PERMS = { registers: { read: true, write: true, delete: true } };
const ORDERS_WRITE_PERMS = { orders: { read: true, write: true } };

const ADMIN_A_EMAIL = 'admin-a@example.com';
const CASHIER_A_EMAIL = 'cashier-a@example.com';
const CASHIER_B_EMAIL = 'cashier-b@example.com';

function actor(email: string, orgId: string, permissions: Record<string, unknown>) {
  return {
    id: `u-${email}`,
    email,
    orgId,
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Actor', systemRole: 'standard', permissions }],
  };
}

const USERS: Record<string, unknown> = {
  [ADMIN_A_EMAIL]: actor(ADMIN_A_EMAIL, DEFAULT_ORG_ID, REGISTERS_FULL_PERMS),
  [CASHIER_A_EMAIL]: actor(CASHIER_A_EMAIL, DEFAULT_ORG_ID, ORDERS_WRITE_PERMS),
  [CASHIER_B_EMAIL]: actor(CASHIER_B_EMAIL, OTHER_ORG_ID, ORDERS_WRITE_PERMS),
};

const adminAuth = () => ({ Authorization: `Bearer ${jwtFor(ADMIN_A_EMAIL)}` });
const cashierAAuth = () => ({ Authorization: `Bearer ${jwtFor(CASHIER_A_EMAIL)}` });
const cashierBAuth = () => ({ Authorization: `Bearer ${jwtFor(CASHIER_B_EMAIL)}` });

/** A minimal, validly-shaped checkout body — pricing is never reached in these tests. */
const ORDER_BODY = { items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'card' };

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  getUserByEmail.mockImplementation(async (email: string) => USERS[email] ?? null);
  createAuditLog.mockResolvedValue({});
  getExpectedDrawerCash.mockResolvedValue(42.5);
  closeDrawerSession.mockImplementation(async (sessionId, counted, expected, userId, notes) => ({
    id: sessionId,
    status: 'closed',
    countedCash: counted,
    expectedCash: expected,
    variance: counted - expected,
    closedBy: userId,
    notes,
  }));
  getRegisters.mockResolvedValue([]);

  registers.set('rA', {
    id: 'rA',
    orgId: DEFAULT_ORG_ID,
    displayCode: 'MAIN-01',
    status: 'pending',
    lastSeenAt: null,
  });
});

/** Issues a pairing code for `registerId` as the org A admin. */
async function issueCode(registerId: string): Promise<string> {
  const response = await request(app)
    .post(`/api/registers/${registerId}/pairing-code`)
    .set(adminAuth());
  expect(response.status).toBe(201);
  return response.body.data.code as string;
}

/** Redeems a code and returns the minted token. */
async function redeem(code: string): Promise<string> {
  const response = await request(app).post('/api/registers/pair').send({ code });
  expect(response.status).toBe(201);
  return response.body.data.token as string;
}

/** Issues and redeems in one step, returning the device token. */
async function enroll(registerId: string): Promise<string> {
  return redeem(await issueCode(registerId));
}

describe('issue -> redeem', () => {
  it('activates the register and mints a usable token', async () => {
    expect((await getRegisterById('rA'))!.status).toBe('pending');

    const token = await enroll('rA');

    expect(token).toMatch(/^srt_/);
    expect((await getRegisterById('rA'))!.status).toBe('active');
  });
});

describe('generating a pairing code for a register that is currently trading', () => {
  it(
    'is non-destructive: the register stays active and its existing token keeps ' +
      'authenticating until a new code is actually redeemed, at which point the ' +
      'hand-over happens atomically',
    async () => {
      const oldToken = await enroll('rA');
      expect((await getRegisterById('rA'))!.status).toBe('active');

      // A manager generates a fresh code to re-pair broken hardware. This
      // must not take the currently-trading lane offline, and must not
      // touch the old device's credential at all.
      const newCode = await issueCode('rA');

      expect((await getRegisterById('rA'))!.status).toBe('active');
      const stillWorksBeforeRedeem = await request(app)
        .post('/api/registers/rA/heartbeat')
        .set('X-Register-Token', oldToken);
      expect(stillWorksBeforeRedeem.status).toBe(200);

      // Only actually redeeming the new code performs the hand-over.
      const newToken = await redeem(newCode);

      expect((await getRegisterById('rA'))!.status).toBe('active');
      const oldNowRevoked = await request(app)
        .post('/api/registers/rA/heartbeat')
        .set('X-Register-Token', oldToken);
      expect(oldNowRevoked.status).toBe(401);
      const newWorks = await request(app)
        .post('/api/registers/rA/heartbeat')
        .set('X-Register-Token', newToken);
      expect(newWorks.status).toBe(200);
    }
  );

  it('never generates it and never redeems it: the register is left completely alone', async () => {
    const token = await enroll('rA');
    expect((await getRegisterById('rA'))!.status).toBe('active');

    // Issue a code, then simply never redeem it — the operator was only
    // looking, or misplaced it.
    await issueCode('rA');

    expect((await getRegisterById('rA'))!.status).toBe('active');
    const heartbeat = await request(app).post('/api/registers/rA/heartbeat').set('X-Register-Token', token);
    expect(heartbeat.status).toBe(200);
  });
});

describe('POST /api/registers/pair with a bad code', () => {
  it('reports a failure status and issues no token', async () => {
    const response = await request(app).post('/api/registers/pair').send({ code: 'ZZZZ9999' });

    expect(response.status).not.toBe(201);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.data).toBeUndefined();
    expect([...credentials.values()].some((c) => c.tokenHash != null)).toBe(false);
  });
});

describe('POST /api/registers/:id/revoke', () => {
  it('409s when the register has an open drawer session', async () => {
    await enroll('rA');
    drawerSessions.set('rA', { id: 'ds-1', registerId: 'rA', status: 'open', openedAt: Date.now() });

    const response = await request(app).post('/api/registers/rA/revoke').set(adminAuth()).send({});

    expect(response.status).toBe(409);
    expect(closeDrawerSession).not.toHaveBeenCalled();
  });

  it('force-revoke closes the drawer at its expected cash and flags the note', async () => {
    await enroll('rA');
    drawerSessions.set('rA', { id: 'ds-1', registerId: 'rA', status: 'open', openedAt: Date.now() });

    const response = await request(app)
      .post('/api/registers/rA/revoke')
      .set(adminAuth())
      .send({ force: true, reason: 'lost device' });

    expect(response.status).toBe(200);
    expect(closeDrawerSession).toHaveBeenCalledWith(
      'ds-1',
      42.5, // counted === expected: nobody is present to count the drawer
      42.5,
      expect.anything(),
      expect.stringContaining('revoked_with_open_drawer')
    );
    expect((await getRegisterById('rA'))!.status).toBe('pending');
  });

  it('returns the register to pending with no open drawer to worry about', async () => {
    await enroll('rA');

    const response = await request(app).post('/api/registers/rA/revoke').set(adminAuth()).send({});

    expect(response.status).toBe(200);
    expect(response.body.data.register.status).toBe('pending');
  });
});

describe('using a token after its credential is revoked', () => {
  it('401s on the very next request', async () => {
    const token = await enroll('rA');
    await request(app).post('/api/registers/rA/revoke').set(adminAuth()).send({});

    const response = await request(app)
      .post('/api/registers/rA/heartbeat')
      .set('X-Register-Token', token);

    expect(response.status).toBe(401);
  });

  it('marks the 401 with a machine-readable code, not just prose', async () => {
    // The terminal has to tell this 401 ("your device credential is dead, go
    // and re-pair") apart from an ordinary expired-session 401 ("sign in
    // again"), because the recoveries differ. It branches on this code. If the
    // code stops being sent, a revoked till silently retries forever instead
    // of showing the pairing screen - the exact failure enrolment prevents -
    // so the contract is asserted here rather than left to the wording.
    const token = await enroll('rA');
    await request(app).post('/api/registers/rA/revoke').set(adminAuth()).send({});

    const response = await request(app)
      .post('/api/registers/rA/heartbeat')
      .set('X-Register-Token', token);

    expect(response.body.code).toBe('REGISTER_TOKEN_INVALID');
  });

  it('does not mark an ordinary session 401 with that code', async () => {
    // Same status, different meaning: no device token involved, so the client
    // must send the user to sign in rather than wiping a healthy terminal's
    // credential and dumping it on the pairing screen.
    const response = await request(app).get('/api/registers');

    expect(response.status).toBe(401);
    expect(response.body.code).not.toBe('REGISTER_TOKEN_INVALID');
  });

  it('refuses checkout and writes no order', async () => {
    const token = await enroll('rA');
    await request(app).post('/api/registers/rA/revoke').set(adminAuth()).send({});

    const response = await request(app)
      .post('/api/orders')
      .set(cashierAAuth())
      .set('X-Register-Token', token)
      .send(ORDER_BODY);

    expect(response.status).toBe(401);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('POST /api/registers/:id/heartbeat', () => {
  it('updates last_seen_at', async () => {
    const token = await enroll('rA');
    expect((await getRegisterById('rA'))!.lastSeenAt).toBeNull();

    const before = Date.now();
    const response = await request(app).post('/api/registers/rA/heartbeat').set('X-Register-Token', token);
    const after = Date.now();

    expect(response.status).toBe(200);
    expect(response.body.data.lastSeenAt).toBeGreaterThanOrEqual(before);
    expect(response.body.data.lastSeenAt).toBeLessThanOrEqual(after);
    expect(response.body.data.liveness).toBe('online');
  });

  it("403s a token used against a register that isn't its own", async () => {
    registers.set('rSibling', {
      id: 'rSibling',
      orgId: DEFAULT_ORG_ID,
      displayCode: 'MAIN-02',
      status: 'pending',
      lastSeenAt: null,
    });
    const token = await enroll('rA');

    const response = await request(app)
      .post('/api/registers/rSibling/heartbeat')
      .set('X-Register-Token', token);

    expect(response.status).toBe(403);
  });
});

describe('cross-org protection', () => {
  it("a device token from org A cannot act on org B's register/session", async () => {
    // rA belongs to DEFAULT_ORG_ID. Redeeming its pairing code produces a
    // token that authenticates as an org-A register.
    const token = await enroll('rA');

    // Checking out as an org-B cashier, but presenting org A's device token,
    // must be refused — a session cannot borrow another org's till just by
    // naming a valid token that happens to belong elsewhere.
    const response = await request(app)
      .post('/api/orders')
      .set(cashierBAuth())
      .set('X-Register-Token', token)
      .send(ORDER_BODY);

    expect(response.status).toBe(401);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('POST /api/registers/pair rate limiting', () => {
  it('eventually blocks repeated attempts from one address', async () => {
    // `pairLimiter` (app.ts) shares its budget across every test in this
    // file, since they all reuse the one `app` instance — the file already
    // spends a handful of legitimate `/pair` calls above. Looping well past
    // `maxPairAttempts` makes the outcome independent of exactly how much
    // budget those earlier calls left behind.
    let blocked = 0;
    for (let i = 0; i < config.rateLimit.maxPairAttempts + 15; i++) {
      const response = await request(app).post('/api/registers/pair').send({ code: 'ZZZZ9999' });
      if (response.status === 429) blocked++;
    }

    expect(blocked).toBeGreaterThan(0);
  });
});
