import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Card terminal routes.
 *
 * What is worth pinning down here is everything around the charge: that a
 * transaction is recorded whatever the outcome, and that starting, reading or
 * cancelling a charge is permission-gated.
 *
 * The amount is no longer an input — the caller sends a cart and the server
 * prices it — so the figure that reaches the processor is covered by
 * `chargeAmount.test.ts` instead.
 */
const getUserByEmail = vi.fn();
const createTerminalTransaction = vi.fn();
const getTerminalTransactionByChargeId = vi.fn();
const updateTerminalTransactionByChargeId = vi.fn();
const getSettings = vi.fn();
const getRegisters = vi.fn();
const getRegisterById = vi.fn();
const getProductById = vi.fn();
const getOpenShiftForRegister = vi.fn();
const createPaymentAttempt = vi.fn();
const getPaymentAttemptByChargeId = vi.fn();
const updatePaymentAttempt = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      createTerminalTransaction,
      getTerminalTransactionByChargeId,
      updateTerminalTransactionByChargeId,
      getSettings,
      getRegisters,
      getRegisterById,
      getProductById,
      getOpenShiftForRegister,
      createPaymentAttempt,
      getPaymentAttemptByChargeId,
      updatePaymentAttempt,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Till', systemRole: 'standard', permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

const UNBOUND_REGISTER = {
  id: 'reg-1',
  orgId: '00000000-0000-0000-0000-000000000001',
  displayCode: 'MAIN-01',
  registerNumber: 1,
  status: 'active',
  hasCashDrawer: true,
  acceptsCash: true,
  canRefund: true,
  requireSignIn: false,
  canOpenDrawerNoSale: false,
  terminalProvider: null,
  terminalDeviceId: null,
};

/** A $12.50 basket, which is what the server prices this cart at. */
const CART = { items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] };

const charge = (body: Record<string, unknown> = {}) =>
  request(app).post('/api/terminal/charge').set(auth()).send({ ...CART, ...body });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: true } }));
  getSettings.mockResolvedValue({ taxRateDefault: 0, config: {} });
  getProductById.mockResolvedValue({
    id: 'p1',
    name: 'Candle',
    basePrice: 12.5,
    variants: [{ id: 'v1', stock: 5, enabled: true }],
  });
  getOpenShiftForRegister.mockResolvedValue(null);
  createPaymentAttempt.mockImplementation(async (data) => ({ id: 'att-1', ...data }));
  getPaymentAttemptByChargeId.mockResolvedValue({ id: 'att-1', status: 'pending' });
  updatePaymentAttempt.mockResolvedValue({});
  createTerminalTransaction.mockResolvedValue({ id: 't1' });
  updateTerminalTransactionByChargeId.mockResolvedValue(undefined);
  getTerminalTransactionByChargeId.mockResolvedValue({
    chargeId: 'ch_1',
    status: 'approved',
    amount: 1250,
  });
  // The caller's till, resolved for every terminal call so its own reader can
  // be used. Unbound by default, which is what a single-register install looks
  // like.
  getRegisters.mockResolvedValue([UNBOUND_REGISTER]);
  getRegisterById.mockResolvedValue(UNBOUND_REGISTER);
});

describe('POST /api/terminal/charge', () => {
  it('starts a charge and reports it as accepted, not complete', async () => {
    // 202: the reader has been asked, the customer has not yet tapped. A 200
    // here would tell the register the sale was paid for.
    const response = await charge();

    expect(response.status).toBe(202);
    expect(response.body.data.chargeId).toBeTruthy();
  });

  it('records the transaction when the charge starts', async () => {
    await charge();

    expect(createTerminalTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1250, status: expect.any(String) })
    );
  });

  it('rejects a charge with nothing to sell', async () => {
    // The cart is the input now, so an empty one is the equivalent of the old
    // missing amount: there is nothing to price and nothing to charge.
    const response = await request(app).post('/api/terminal/charge').set(auth()).send({ items: [] });

    expect(response.status).toBe(400);
    expect(createTerminalTransaction).not.toHaveBeenCalled();
  });

  it('defaults the currency rather than requiring it', async () => {
    await charge();

    expect(createTerminalTransaction.mock.calls[0][0].currency).toBe('USD');
  });

  it('needs orders.write', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: false } }));

    expect((await charge()).status).toBe(403);
    expect(createTerminalTransaction).not.toHaveBeenCalled();
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).post('/api/terminal/charge').send(CART)).status).toBe(401);
  });
});

describe('GET /api/terminal/status/:chargeId', () => {
  it('reports where a charge got to', async () => {
    const response = await request(app).get('/api/terminal/status/ch_1').set(auth());

    expect(response.status).toBe(200);
  });

  it('needs orders.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: false, write: false } }));

    expect((await request(app).get('/api/terminal/status/ch_1').set(auth())).status).toBe(403);
  });
});

describe('POST /api/terminal/cancel/:chargeId', () => {
  it('needs orders.write, since cancelling changes a payment', async () => {
    getUserByEmail.mockResolvedValue(actor({ orders: { read: true, write: false } }));

    expect((await request(app).post('/api/terminal/cancel/ch_1').set(auth())).status).toBe(403);
  });
});
