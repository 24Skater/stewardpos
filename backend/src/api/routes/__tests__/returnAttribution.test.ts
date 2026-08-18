import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * `POST /api/returns` attribution: which register and which cashier took the
 * return, and the register-capability gate on refunds (`can_refund`).
 *
 * `exchangeRefusal.test.ts` covers the `returnType` gate on this same route;
 * this covers the register side of it.
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

const REGISTER = {
  id: 'reg-1',
  orgId: DEFAULT_ORG_ID,
  displayCode: 'MAIN-01',
  registerNumber: 1,
  hasCashDrawer: true,
  acceptsCash: true,
  canRefund: true,
  status: 'active',
};

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function body() {
  return {
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
  };
}

/** What the route asked the adapter to store. */
const stored = () => createReturn.mock.calls[0][0];

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
  getRegisters.mockResolvedValue([REGISTER]);
  getRegisterById.mockResolvedValue(REGISTER);
});

describe('register attribution', () => {
  it('stamps registerId and cashierUserId on the return', async () => {
    await request(app).post('/api/returns').set('Authorization', `Bearer ${token()}`).send(body());

    expect(stored().registerId).toBe('reg-1');
    expect(stored().cashierUserId).toBe('u1');
  });

  it('leaves overrideByUserId null on an ordinary refund, which needs nobody', async () => {
    await request(app).post('/api/returns').set('Authorization', `Bearer ${token()}`).send(body());

    expect(stored().overrideByUserId).toBeNull();
  });

  it('rejects a refund at a register with can_refund false', async () => {
    getRegisters.mockResolvedValue([{ ...REGISTER, canRefund: false }]);
    getRegisterById.mockResolvedValue({ ...REGISTER, canRefund: false });

    const response = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${token()}`)
      .send(body());

    expect(response.status).toBe(422);
    expect(createReturn).not.toHaveBeenCalled();
  });

  it('uses the register named by X-Register-Id instead of the fallback', async () => {
    const other = { ...REGISTER, id: 'reg-2', displayCode: 'MAIN-02', registerNumber: 2 };
    getRegisterById.mockResolvedValue(other);

    await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Register-Id', 'reg-2')
      .send(body());

    expect(getRegisterById).toHaveBeenCalledWith('reg-2');
    expect(stored().registerId).toBe('reg-2');
  });
});
