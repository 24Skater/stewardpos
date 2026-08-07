import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getReturnById = vi.fn();
const restockReturnItems = vi.fn();
const createRefundTransaction = vi.fn();
const updateReturnRefundStatus = vi.fn();
const createStoreCredit = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getReturnById,
      restockReturnItems,
      createRefundTransaction,
      updateReturnRefundStatus,
      createStoreCredit,
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

function aReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ret-1',
    originalOrderId: 'o1',
    status: 'approved',
    refundStatus: 'pending',
    total: 12.5,
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'staff@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getReturnById.mockResolvedValue(aReturn());
  restockReturnItems.mockResolvedValue([]);
  createRefundTransaction.mockResolvedValue({ id: 'rt-1' });
  updateReturnRefundStatus.mockResolvedValue({});
  createStoreCredit.mockResolvedValue({});
  createAuditLog.mockResolvedValue({});
});

describe('POST /api/returns/:id/restock', () => {
  it('refuses a return that has not been approved', async () => {
    // Restocking puts goods back on the shelf as sellable. On a pending return
    // that is whoever filed it deciding inventory unilaterally, for an item that
    // may never have come back.
    getReturnById.mockResolvedValue(aReturn({ status: 'pending' }));

    const response = await request(app)
      .post('/api/returns/ret-1/restock')
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(response.status).toBe(400);
    expect(restockReturnItems).not.toHaveBeenCalled();
  });

  it('refuses a rejected return', async () => {
    getReturnById.mockResolvedValue(aReturn({ status: 'rejected' }));

    const response = await request(app)
      .post('/api/returns/ret-1/restock')
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(response.status).toBe(400);
    expect(restockReturnItems).not.toHaveBeenCalled();
  });

  it('allows an approved return', async () => {
    const response = await request(app)
      .post('/api/returns/ret-1/restock')
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(response.status).toBe(200);
    expect(restockReturnItems).toHaveBeenCalledWith('ret-1', undefined);
  });
});

describe('POST /api/returns/:id/process-refund', () => {
  it('refuses an amount above the return total', async () => {
    const response = await request(app)
      .post('/api/returns/ret-1/process-refund')
      .set('Authorization', `Bearer ${token()}`)
      .send({ refundMethod: 'cash', amount: 99999 });

    expect(response.status).toBe(400);
    expect(createRefundTransaction).not.toHaveBeenCalled();
  });

  it('allows a partial refund below the total', async () => {
    const response = await request(app)
      .post('/api/returns/ret-1/process-refund')
      .set('Authorization', `Bearer ${token()}`)
      .send({ refundMethod: 'cash', amount: 5 });

    expect(response.status).toBe(200);
    expect(createRefundTransaction.mock.calls[0][0].amount).toBe(5);
  });

  it('defaults to the return total when no amount is given', async () => {
    await request(app)
      .post('/api/returns/ret-1/process-refund')
      .set('Authorization', `Bearer ${token()}`)
      .send({ refundMethod: 'cash' });

    expect(createRefundTransaction.mock.calls[0][0].amount).toBe(12.5);
  });

  it('will not mint a store credit larger than the return', async () => {
    const response = await request(app)
      .post('/api/returns/ret-1/process-refund')
      .set('Authorization', `Bearer ${token()}`)
      .send({ refundMethod: 'store_credit', amount: 99999 });

    expect(response.status).toBe(400);
    expect(createStoreCredit).not.toHaveBeenCalled();
  });

  it('refuses to refund twice', async () => {
    getReturnById.mockResolvedValue(aReturn({ refundStatus: 'processed' }));

    const response = await request(app)
      .post('/api/returns/ret-1/process-refund')
      .set('Authorization', `Bearer ${token()}`)
      .send({ refundMethod: 'cash' });

    expect(response.status).toBe(400);
  });
});
