import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getOpenDrawerSession = vi.fn();
const openDrawerSession = vi.fn();
const closeDrawerSession = vi.fn();
const getExpectedDrawerCash = vi.fn();
const getDrawerSessions = vi.fn();
const getRegisterById = vi.fn();
const getRegisters = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getOpenDrawerSession,
      openDrawerSession,
      closeDrawerSession,
      getExpectedDrawerCash,
      getDrawerSessions,
      getRegisterById,
      getRegisters,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { DEFAULT_ORG_ID } = await import('../../middleware/auth');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'staff@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'staff@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Standard', systemRole: 'standard', permissions }],
  };
}

const OPEN_SESSION = {
  id: 'ds-1',
  registerId: 'reg-1',
  openedBy: 'u1',
  openedAt: 1_700_000_000_000,
  closedAt: null,
  openingFloat: 100,
  expectedCash: null,
  countedCash: null,
  variance: null,
  status: 'open',
};

/** The register a caller resolves to when no `X-Register-Id` is sent. */
const FALLBACK_REGISTER = {
  id: 'reg-1',
  orgId: DEFAULT_ORG_ID,
  displayCode: 'MAIN-01',
  registerNumber: 1,
  hasCashDrawer: true,
  status: 'active',
};

const OTHER_REGISTER = {
  id: 'reg-2',
  orgId: DEFAULT_ORG_ID,
  displayCode: 'MAIN-02',
  registerNumber: 2,
  hasCashDrawer: true,
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true }, reports: { read: true } }));
  getOpenDrawerSession.mockResolvedValue({ ...OPEN_SESSION });
  getExpectedDrawerCash.mockResolvedValue(250.5);
  getDrawerSessions.mockResolvedValue([]);
  createAuditLog.mockResolvedValue({});
  // No X-Register-Id sent in most tests, so resolution falls back to the
  // org's lowest-numbered active register.
  getRegisters.mockResolvedValue([FALLBACK_REGISTER]);
  getRegisterById.mockResolvedValue(FALLBACK_REGISTER);
});

describe('GET /api/drawer/current', () => {
  it('reports the open session with what the till should hold', async () => {
    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.openingFloat).toBe(100);
    expect(response.body.data.expectedCash).toBe(250.5);
    expect(getOpenDrawerSession).toHaveBeenCalledWith('reg-1');
  });

  it('answers null when no drawer is open, rather than erroring', async () => {
    // "No drawer open" is a normal state the register has to distinguish from a
    // failed request.
    getOpenDrawerSession.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it('uses the register named by X-Register-Id instead of the fallback', async () => {
    getRegisterById.mockResolvedValue(OTHER_REGISTER);

    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Register-Id', 'reg-2');

    expect(response.status).toBe(200);
    expect(getRegisterById).toHaveBeenCalledWith('reg-2');
    expect(getOpenDrawerSession).toHaveBeenCalledWith('reg-2');
    // The fallback lookup must not run when the header resolves cleanly.
    expect(getRegisters).not.toHaveBeenCalled();
  });

  it('falls back to the org\'s lowest-numbered active register when no header is sent', async () => {
    getRegisters.mockResolvedValue([OTHER_REGISTER, FALLBACK_REGISTER]);

    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    // reg-1 is register number 1, reg-2 is number 2 - the lower number wins
    // regardless of array order.
    expect(getOpenDrawerSession).toHaveBeenCalledWith('reg-1');
  });

  it('rejects an X-Register-Id belonging to another organization', async () => {
    getRegisterById.mockResolvedValue({ ...OTHER_REGISTER, orgId: 'some-other-org' });

    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Register-Id', 'reg-2');

    expect(response.status).toBe(400);
    // Must reject outright, not silently fall back to the org's own register.
    expect(getOpenDrawerSession).not.toHaveBeenCalled();
  });

  it('rejects an X-Register-Id that does not exist', async () => {
    getRegisterById.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Register-Id', 'no-such-register');

    expect(response.status).toBe(400);
    expect(getOpenDrawerSession).not.toHaveBeenCalled();
  });

  it('rejects an X-Register-Id that is not active', async () => {
    getRegisterById.mockResolvedValue({ ...FALLBACK_REGISTER, status: 'disabled' });

    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Register-Id', 'reg-1');

    expect(response.status).toBe(400);
    expect(getOpenDrawerSession).not.toHaveBeenCalled();
  });
});

describe('GET /api/drawer', () => {
  it('lists sessions unfiltered by default', async () => {
    const response = await request(app)
      .get('/api/drawer')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(getDrawerSessions).toHaveBeenCalledWith(50, undefined);
  });

  it('filters by registerId when given', async () => {
    const response = await request(app)
      .get('/api/drawer?registerId=reg-2')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(getDrawerSessions).toHaveBeenCalledWith(50, 'reg-2');
  });

  it('needs reports.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ reports: { read: false } }));

    const response = await request(app)
      .get('/api/drawer')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/drawer/open', () => {
  it('opens with a float on the resolved register', async () => {
    openDrawerSession.mockResolvedValue({ ...OPEN_SESSION, openingFloat: 150 });

    const response = await request(app)
      .post('/api/drawer/open')
      .set('Authorization', `Bearer ${token()}`)
      .send({ openingFloat: 150 });

    expect(response.status).toBe(201);
    expect(openDrawerSession).toHaveBeenCalledWith({
      registerId: 'reg-1',
      openingFloat: 150,
      userId: 'u1',
    });
  });

  it('defaults the float to zero', async () => {
    openDrawerSession.mockResolvedValue({ ...OPEN_SESSION, openingFloat: 0 });

    await request(app).post('/api/drawer/open').set('Authorization', `Bearer ${token()}`).send({});

    expect(openDrawerSession).toHaveBeenCalledWith({
      registerId: 'reg-1',
      openingFloat: 0,
      userId: 'u1',
    });
  });

  it('rejects a negative float', async () => {
    const response = await request(app)
      .post('/api/drawer/open')
      .set('Authorization', `Bearer ${token()}`)
      .send({ openingFloat: -10 });

    expect(response.status).toBe(400);
    expect(openDrawerSession).not.toHaveBeenCalled();
  });

  it('needs orders.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: false } }));

    const response = await request(app)
      .post('/api/drawer/open')
      .set('Authorization', `Bearer ${token()}`)
      .send({ openingFloat: 100 });

    expect(response.status).toBe(403);
  });

  it('refuses with 422 when the register has no cash drawer', async () => {
    // A web or drawer-less register must not be able to open a drawer session
    // at all - otherwise the variance report accumulates phantom sessions
    // with no physical till behind them.
    getRegisters.mockResolvedValue([{ ...FALLBACK_REGISTER, hasCashDrawer: false }]);
    getRegisterById.mockResolvedValue({ ...FALLBACK_REGISTER, hasCashDrawer: false });

    const response = await request(app)
      .post('/api/drawer/open')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Register-Id', 'reg-1')
      .send({ openingFloat: 100 });

    expect(response.status).toBe(422);
    expect(openDrawerSession).not.toHaveBeenCalled();
  });

  it('rejects an X-Register-Id belonging to another organization', async () => {
    getRegisterById.mockResolvedValue({ ...FALLBACK_REGISTER, orgId: 'some-other-org' });

    const response = await request(app)
      .post('/api/drawer/open')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Register-Id', 'reg-1')
      .send({ openingFloat: 100 });

    expect(response.status).toBe(400);
    expect(openDrawerSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/drawer/close', () => {
  it('computes the variance rather than accepting one', async () => {
    // The point of a reconciliation is that one side of it is not the counter's
    // own claim, so `expectedCash` is never read from the request.
    closeDrawerSession.mockResolvedValue({
      ...OPEN_SESSION,
      status: 'closed',
      countedCash: 248,
      expectedCash: 250.5,
      variance: -2.5,
    });

    const response = await request(app)
      .post('/api/drawer/close')
      .set('Authorization', `Bearer ${token()}`)
      .send({ countedCash: 248, expectedCash: 1_000_000 });

    expect(response.status).toBe(200);
    expect(getOpenDrawerSession).toHaveBeenCalledWith('reg-1');
    expect(closeDrawerSession).toHaveBeenCalledWith('ds-1', 248, 250.5, 'u1', undefined);
    expect(response.body.data.variance).toBe(-2.5);
  });

  it('404s when nothing is open on the resolved register', async () => {
    getOpenDrawerSession.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/drawer/close')
      .set('Authorization', `Bearer ${token()}`)
      .send({ countedCash: 100 });

    expect(response.status).toBe(404);
    expect(closeDrawerSession).not.toHaveBeenCalled();
  });

  it('reports losing the race to another close', async () => {
    closeDrawerSession.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/drawer/close')
      .set('Authorization', `Bearer ${token()}`)
      .send({ countedCash: 100 });

    expect(response.status).toBe(400);
  });

  it('requires a counted amount', async () => {
    const response = await request(app)
      .post('/api/drawer/close')
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(response.status).toBe(400);
    expect(closeDrawerSession).not.toHaveBeenCalled();
  });
});
