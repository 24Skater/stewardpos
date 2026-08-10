import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getStoreCreditByCode = vi.fn();
const redeemStoreCredit = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({ getUserByEmail, getStoreCreditByCode, redeemStoreCredit, createAuditLog }),
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

const CREDIT = {
  id: 'sc-1',
  returnId: 'ret-1',
  code: 'SC-ABC123',
  originalAmount: 20,
  remainingAmount: 20,
  status: 'active',
  expiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true } }));
  getStoreCreditByCode.mockResolvedValue({ ...CREDIT });
  createAuditLog.mockResolvedValue({});
});

describe('GET /api/store-credits/:code', () => {
  it('reports the balance', async () => {
    const response = await request(app)
      .get('/api/store-credits/SC-ABC123')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.remainingAmount).toBe(20);
  });

  it('404s on an unknown code', async () => {
    getStoreCreditByCode.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/store-credits/NOPE')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(404);
  });

  it('needs a session', async () => {
    expect((await request(app).get('/api/store-credits/SC-ABC123')).status).toBe(401);
  });
});

describe('POST /api/store-credits/:code/redeem', () => {
  it('spends part of a credit', async () => {
    redeemStoreCredit.mockResolvedValue({ ...CREDIT, remainingAmount: 12 });

    const response = await request(app)
      .post('/api/store-credits/SC-ABC123/redeem')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 8, orderId: 'o1' });

    expect(response.status).toBe(200);
    expect(response.body.data.remainingAmount).toBe(12);
    expect(redeemStoreCredit).toHaveBeenCalledWith('SC-ABC123', 8, 'o1');
  });

  it('refuses more than the balance, and says what is left', async () => {
    // The adapter refuses in the UPDATE itself; the route reads back only to
    // explain which of the several reasons applied.
    redeemStoreCredit.mockResolvedValue(null);
    getStoreCreditByCode.mockResolvedValue({ ...CREDIT, remainingAmount: 3 });

    const response = await request(app)
      .post('/api/store-credits/SC-ABC123/redeem')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 50 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/\$3\.00 left/);
  });

  it('reports an already-spent credit as spent, not as short', async () => {
    redeemStoreCredit.mockResolvedValue(null);
    getStoreCreditByCode.mockResolvedValue({ ...CREDIT, status: 'used', remainingAmount: 0 });

    const response = await request(app)
      .post('/api/store-credits/SC-ABC123/redeem')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 1 });

    expect(response.body.error).toMatch(/already been used/);
  });

  it('reports an expired credit as expired', async () => {
    redeemStoreCredit.mockResolvedValue(null);
    getStoreCreditByCode.mockResolvedValue({ ...CREDIT, expiresAt: 1_000 });

    const response = await request(app)
      .post('/api/store-credits/SC-ABC123/redeem')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 1 });

    expect(response.body.error).toMatch(/expired/);
  });

  it('404s on an unknown code', async () => {
    redeemStoreCredit.mockResolvedValue(null);
    getStoreCreditByCode.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/store-credits/NOPE/redeem')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 1 });

    expect(response.status).toBe(404);
  });

  it('rejects a non-positive amount', async () => {
    const response = await request(app)
      .post('/api/store-credits/SC-ABC123/redeem')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 0 });

    expect(response.status).toBe(400);
    expect(redeemStoreCredit).not.toHaveBeenCalled();
  });

  it('needs orders.write, not merely a session', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: false } }));

    const response = await request(app)
      .post('/api/store-credits/SC-ABC123/redeem')
      .set('Authorization', `Bearer ${token()}`)
      .send({ amount: 1 });

    expect(response.status).toBe(403);
    expect(redeemStoreCredit).not.toHaveBeenCalled();
  });
});
