import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * `returnType: 'exchange'` used to be accepted and then priced as a plain
 * return: a full refund, with nothing charged for the replacement, so the
 * customer left with a new item and their money back.
 *
 * Nothing anywhere carries replacement items, so there is no exchange to
 * price — only a refund wearing the wrong label.
 */
const getUserByEmail = vi.fn();
const getOrderById = vi.fn();
const createReturn = vi.fn();
const getReturnsByOrder = vi.fn();
const createAuditLog = vi.fn();
const getRegisterById = vi.fn();
const getRegisters = vi.fn();
const getOpenShiftForRegister = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getOrderById,
      createReturn,
      getReturnsByOrder,
      createAuditLog,
      getRegisterById,
      getRegisters,
      getOpenShiftForRegister,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { DEFAULT_ORG_ID } = await import('../../middleware/auth');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function body(returnType: string) {
  return {
    originalOrderId: 'ord-1',
    returnType,
    items: [
      {
        // Required by `repriceReturn`, so a refund is bounded by what was sold.
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue({
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Admin', systemRole: 'admin', permissions: {} }],
  });
  getOrderById.mockResolvedValue({
    id: 'ord-1',
    total: 10,
    subtotal: 10,
    taxTotal: 0,
    items: [{ id: 'oi1', productId: 'p1', nameSnapshot: 'Tea', quantity: 1, unitPrice: 10, lineTotal: 10 }],
  });
  createReturn.mockResolvedValue({ id: 'ret-1' });
  getReturnsByOrder.mockResolvedValue([]);
  createAuditLog.mockResolvedValue({});
  getOpenShiftForRegister.mockResolvedValue(null);
  getRegisters.mockResolvedValue([
    {
      id: 'reg-1',
      orgId: DEFAULT_ORG_ID,
      displayCode: 'MAIN-01',
      registerNumber: 1,
      hasCashDrawer: true,
      acceptsCash: true,
      canRefund: true,
      status: 'active',
    },
  ]);
  getRegisterById.mockResolvedValue({
    id: 'reg-1',
    orgId: DEFAULT_ORG_ID,
    displayCode: 'MAIN-01',
    registerNumber: 1,
    hasCashDrawer: true,
    acceptsCash: true,
    canRefund: true,
    status: 'active',
  });
});

describe('POST /api/returns', () => {
  it('refuses an exchange, and says what to do instead', async () => {
    const response = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${token()}`)
      .send(body('exchange'));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not supported yet/);
  });

  it('refuses it before anything is written', async () => {
    // The refusal is at validation, so no refund is recorded and no stock moves.
    await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${token()}`)
      .send(body('exchange'));

    expect(createReturn).not.toHaveBeenCalled();
  });

  it('still accepts an ordinary return', async () => {
    const response = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${token()}`)
      .send(body('return'));

    expect(response.status).toBe(201);
  });

  it('still accepts a void', async () => {
    // A void is a full cancellation, which a full return already models
    // correctly — it is only the exchange that had nothing behind it.
    const response = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${token()}`)
      .send(body('void'));

    expect(response.status).toBe(201);
  });
});
