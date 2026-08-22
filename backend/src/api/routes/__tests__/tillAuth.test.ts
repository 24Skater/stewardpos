import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { mintSession } from '../../../services/tillSessions';

const getRegisterById = vi.fn();
const getActiveUsersWithPin = vi.fn();
const getUserById = vi.fn();
const getUserByEmail = vi.fn();
const getOpenShiftForRegister = vi.fn();
const endRegisterShift = vi.fn();
const createRegisterShift = vi.fn();
const resetPinFailures = vi.fn();
const recordPinFailure = vi.fn();
const createAuditLog = vi.fn();
const getRegisterShiftById = vi.fn();
const touchRegisterShiftActivity = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getRegisterById, getActiveUsersWithPin, getUserById, getUserByEmail,
      getOpenShiftForRegister, endRegisterShift, createRegisterShift,
      resetPinFailures, recordPinFailure, createAuditLog,
      getRegisterShiftById, touchRegisterShiftActivity,
    }),
  },
}));

/**
 * The device credential is stubbed at the verification boundary rather than by
 * forging a token: what is under test is the endpoint's behaviour once the
 * terminal is known, not the pairing crypto, which registerEnrolment owns and
 * tests itself.
 */
const verifyDeviceToken = vi.fn();
vi.mock('../../../services/registerEnrolment', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, verifyDeviceToken };
});

const { default: app } = await import('../../../app');

const ORG = '00000000-0000-0000-0000-000000000001';
const PIN = '4821';
const CASHIER = {
  id: 'u1', email: 'cashier@demo.local', name: 'Cashier', status: 'active', orgId: ORG,
  roleIds: ['r1'], roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard' }],
  pinHash: bcrypt.hashSync(PIN, 4), pinLockedUntil: null, pinFailedCount: 0,
};

function register(overrides: Record<string, unknown> = {}) {
  return { id: 'reg1', orgId: ORG, status: 'active', requireSignIn: true, idleLockSeconds: 300, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyDeviceToken.mockResolvedValue({ register: register(), credentialId: 'cred1' });
  getRegisterById.mockResolvedValue(register());
  getActiveUsersWithPin.mockResolvedValue([CASHIER]);
  getUserById.mockResolvedValue(CASHIER);
  getUserByEmail.mockResolvedValue(CASHIER);
  getOpenShiftForRegister.mockResolvedValue(null);
  createRegisterShift.mockResolvedValue({
    id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now(),
  });
});

const till = () => request(app).post('/api/auth/till').set('X-Register-Token', 'rt_device');

/** Decode a JWT payload without verifying — we only care which claims are present. */
function claimsOf(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64').toString());
}

describe('POST /api/auth/till on a sign-in register', () => {
  it('mints a session for the cashier whose PIN it is', async () => {
    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(201);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.user.id).toBe('u1');
    expect(response.body.data.shift.id).toBe('s1');
  });

  it('binds the token to the shift it just opened', async () => {
    const response = await till().send({ pin: PIN });

    const claims = claimsOf(response.body.data.token);
    expect(claims.shiftId).toBe('s1');
    expect(claims.registerId).toBe('reg1');
  });

  it('never marks a real till session as assumed', async () => {
    // `assumed` exists to stop an admin's pairing-bypass session being
    // refreshed indefinitely. A genuine PIN sign-on must not carry it.
    const response = await till().send({ pin: PIN });

    expect('assumed' in claimsOf(response.body.data.token)).toBe(false);
  });

  it('refuses a PIN that matches nobody', async () => {
    const response = await till().send({ pin: '0000' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('PIN_INVALID');
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('refuses a locked account distinctly, so the pad can stop asking', async () => {
    const locked = { ...CASHIER, pinLockedUntil: Date.now() + 60_000 };
    getActiveUsersWithPin.mockResolvedValue([locked]);
    getUserById.mockResolvedValue(locked);

    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('PIN_LOCKED');
  });

  it('requires a PIN', async () => {
    const response = await till().send({});

    expect(response.status).toBe(400);
  });

  it('never reveals whose PIN was wrong', async () => {
    const response = await till().send({ pin: '0000' });

    expect(JSON.stringify(response.body)).not.toContain('cashier@demo.local');
  });
});

describe('POST /api/auth/till on a register that does not require sign-in', () => {
  beforeEach(() => {
    verifyDeviceToken.mockResolvedValue({ register: register({ requireSignIn: false }), credentialId: 'cred1' });
    getRegisterById.mockResolvedValue(register({ requireSignIn: false }));
  });

  it('mints a session from the device token alone', async () => {
    const response = await till().send({});

    expect(response.status).toBe(201);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.shift).toBeNull();
    expect(response.body.data.user).toBeNull();
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('binds that session to the register, since it has no shift to bind to', async () => {
    const response = await till().send({});

    const claims = claimsOf(response.body.data.token);
    expect(claims.registerId).toBe('reg1');
    expect('shiftId' in claims).toBe(false);
  });

  it('refuses a PIN rather than ignoring it', async () => {
    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/till device binding', () => {
  it('is refused with no device token at all', async () => {
    const response = await request(app).post('/api/auth/till').send({ pin: PIN });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('REGISTER_TOKEN_INVALID');
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('is refused when the device token is revoked', async () => {
    verifyDeviceToken.mockResolvedValue('revoked');

    const response = await till().send({ pin: PIN });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('REGISTER_TOKEN_INVALID');
  });

  it('takes the register from the token, never from the body', async () => {
    // A client must not be able to open a session at a till it is not at.
    const response = await till().send({ pin: PIN, registerId: 'someone-elses-register' });

    // `.strict()` means an unexpected key is a 400, not a silent substitution.
    expect(response.status).toBe(400);
    expect(createRegisterShift).not.toHaveBeenCalled();
  });
});

const ADMIN = {
  id: 'admin1', email: 'admin@demo.local', name: 'Admin', status: 'active', orgId: ORG,
  roleIds: ['ra'],
  roles: [{ id: 'ra', name: 'Admin', permissions: { registers: { read: true, write: true } } }],
};

const NO_WRITE = {
  ...ADMIN,
  roles: [{ id: 'ra', name: 'Viewer', permissions: { registers: { read: true, write: false } } }],
};

function adminToken(who = ADMIN) {
  getUserByEmail.mockResolvedValue(who);
  return mintSession({ user: who }).token;
}

const assume = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/auth/till/assume').set('Authorization', `Bearer ${token}`).send(body);

describe('POST /api/auth/till/assume', () => {
  beforeEach(() => {
    getUserById.mockImplementation(async (id: string) => (id === 'u1' ? CASHIER : ADMIN));
    createRegisterShift.mockResolvedValue({
      id: 's9', registerId: 'reg1', userId: 'admin1', emulatedUserId: 'u1',
      endedAt: null, lastActivityAt: Date.now(),
    });
  });

  it('mints a till session with no device token at all', async () => {
    const response = await assume(adminToken(), { registerId: 'reg1' });

    expect(response.status).toBe(201);
    expect(response.body.data.token).toEqual(expect.any(String));
  });

  it('attributes the shift to the admin, not the emulated cashier', async () => {
    // The whole point: an admin covering a till must not be able to file sales
    // under a cashier's name.
    await assume(adminToken(), { registerId: 'reg1', emulateUserId: 'u1' });

    expect(createRegisterShift).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin1', emulatedUserId: 'u1' })
    );
  });

  it('caps the session at thirty minutes', async () => {
    const response = await assume(adminToken(), { registerId: 'reg1' });

    const claims = claimsOf(response.body.data.token) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(30 * 60);
  });

  it('marks the session assumed, so refresh cannot extend it', async () => {
    // A thirty-minute cap the client's refresh timer can reset is not a cap.
    const response = await assume(adminToken(), { registerId: 'reg1' });

    expect(claimsOf(response.body.data.token).assumed).toBe(true);
  });

  it('is audited', async () => {
    await assume(adminToken(), { registerId: 'reg1', emulateUserId: 'u1' });

    expect(createAuditLog).toHaveBeenCalled();
  });

  it('needs registers:write', async () => {
    const response = await assume(adminToken(NO_WRITE), { registerId: 'reg1' });

    expect(response.status).toBe(403);
    expect(createRegisterShift).not.toHaveBeenCalled();
  });

  it('is refused without any session at all', async () => {
    const response = await request(app).post('/api/auth/till/assume').send({ registerId: 'reg1' });

    expect(response.status).toBe(401);
  });

  it('404s for a register in another org', async () => {
    getRegisterById.mockResolvedValue(register({ orgId: 'another-org' }));

    const response = await assume(adminToken(), { registerId: 'reg1' });

    expect(response.status).toBe(404);
  });

  it('404s for an emulated user in another org', async () => {
    getUserById.mockImplementation(async (id: string) =>
      id === 'u1' ? { ...CASHIER, orgId: 'another-org' } : ADMIN
    );

    const response = await assume(adminToken(), { registerId: 'reg1', emulateUserId: 'u1' });

    expect(response.status).toBe(404);
  });

  it('refuses a register that is not active', async () => {
    getRegisterById.mockResolvedValue(register({ status: 'retired' }));

    const response = await assume(adminToken(), { registerId: 'reg1' });

    expect(response.status).toBe(422);
  });

  it('supersedes whoever was already on that till', async () => {
    // Two people cannot be on one till, exactly as a PIN sign-on supersedes.
    getOpenShiftForRegister.mockResolvedValue({
      id: 's1', registerId: 'reg1', userId: 'u1', endedAt: null, lastActivityAt: Date.now(),
    });

    await assume(adminToken(), { registerId: 'reg1' });

    expect(endRegisterShift).toHaveBeenCalledWith('s1', 'superseded');
  });

  it('cannot be used to assume from an already-assumed session', async () => {
    // Otherwise the thirty-minute cap is escapable by chaining.
    const assumedToken = mintSession({ user: ADMIN, registerId: 'reg1', assumed: true }).token;
    getUserByEmail.mockResolvedValue(ADMIN);

    const response = await assume(assumedToken, { registerId: 'reg1' });

    expect(response.status).toBe(403);
  });
});
