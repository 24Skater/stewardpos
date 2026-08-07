import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getOpenDrawerSession = vi.fn();
const openDrawerSession = vi.fn();
const closeDrawerSession = vi.fn();
const getExpectedDrawerCash = vi.fn();
const getDrawerSessions = vi.fn();
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
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
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
  openedBy: 'u1',
  openedAt: 1_700_000_000_000,
  closedAt: null,
  openingFloat: 100,
  expectedCash: null,
  countedCash: null,
  variance: null,
  status: 'open',
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true }, reports: { read: true } }));
  getOpenDrawerSession.mockResolvedValue({ ...OPEN_SESSION });
  getExpectedDrawerCash.mockResolvedValue(250.5);
  getDrawerSessions.mockResolvedValue([]);
  createAuditLog.mockResolvedValue({});
});

describe('GET /api/drawer/current', () => {
  it('reports the open session with what the till should hold', async () => {
    const response = await request(app)
      .get('/api/drawer/current')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.openingFloat).toBe(100);
    expect(response.body.data.expectedCash).toBe(250.5);
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
});

describe('POST /api/drawer/open', () => {
  it('opens with a float', async () => {
    openDrawerSession.mockResolvedValue({ ...OPEN_SESSION, openingFloat: 150 });

    const response = await request(app)
      .post('/api/drawer/open')
      .set('Authorization', `Bearer ${token()}`)
      .send({ openingFloat: 150 });

    expect(response.status).toBe(201);
    expect(openDrawerSession).toHaveBeenCalledWith(150, 'u1');
  });

  it('defaults the float to zero', async () => {
    openDrawerSession.mockResolvedValue({ ...OPEN_SESSION, openingFloat: 0 });

    await request(app).post('/api/drawer/open').set('Authorization', `Bearer ${token()}`).send({});

    expect(openDrawerSession).toHaveBeenCalledWith(0, 'u1');
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
    expect(closeDrawerSession).toHaveBeenCalledWith('ds-1', 248, 250.5, 'u1', undefined);
    expect(response.body.data.variance).toBe(-2.5);
  });

  it('404s when nothing is open', async () => {
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
