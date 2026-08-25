import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Who decides how much goes on the card.
 *
 * It used to be the browser: the register computed a total and posted it, and
 * the route checked only that it was a positive integer. Nothing tied that
 * figure to a cart the server had priced, so a modified client could pay $1 for
 * a $100 basket and still produce a well-formed order.
 *
 * The server now prices the cart itself and records what it is about to charge
 * before charging it.
 */

const getUserByEmail = vi.fn();
const getSettings = vi.fn();
const getProductById = vi.fn();
const getStoreCreditByCode = vi.fn();
const createPaymentAttempt = vi.fn();
const updatePaymentAttempt = vi.fn();
const createTerminalTransaction = vi.fn();
const getRegisters = vi.fn();
const getRegisterById = vi.fn();
const getOpenShiftForRegister = vi.fn();

const createCharge = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getSettings,
      getProductById,
      getStoreCreditByCode,
      createPaymentAttempt,
      updatePaymentAttempt,
      createTerminalTransaction,
      getRegisters,
      getRegisterById,
      getOpenShiftForRegister,
    }),
  },
}));

vi.mock('../../../terminal/TerminalAdapterFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../terminal/TerminalAdapterFactory')>();
  return { ...actual, createTerminalAdapter: () => ({ createCharge }) };
});

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

function token(): string {
  return jwt.sign({ id: 'u1', email: 'staff@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

const TILL = {
  id: 'reg-1',
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

/** A $30.00 basket: two units at $15.00, no tax. */
const CART = { items: [{ productId: 'p1', variantId: 'v1', quantity: 2 }] };

function charge(body: Record<string, unknown>) {
  return request(app)
    .post('/api/terminal/charge')
    .set('Authorization', `Bearer ${token()}`)
    .send(body);
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
  getSettings.mockResolvedValue({
    taxRateDefault: 0,
    config: { paymentMethods: { card: { provider: 'stripe' } }, terminalCredentials: {} },
  });
  getProductById.mockResolvedValue({
    id: 'p1',
    name: 'Hymnal',
    basePrice: 15,
    variants: [{ id: 'v1', stock: 10, enabled: true }],
  });
  createPaymentAttempt.mockImplementation(async (data) => ({
    id: 'att-1',
    status: 'pending',
    ...data,
  }));
  updatePaymentAttempt.mockResolvedValue({});
  createTerminalTransaction.mockResolvedValue({ id: 'tt-1' });
  // A single-register install with no reader bound and nobody signed in, which
  // is what the terminal routes resolve against by default.
  getRegisters.mockResolvedValue([TILL]);
  getRegisterById.mockResolvedValue(TILL);
  getOpenShiftForRegister.mockResolvedValue(null);
  createCharge.mockResolvedValue({ chargeId: 'pi_1', status: 'pending' });
});

describe('POST /api/terminal/charge', () => {
  it('prices the cart itself instead of believing the client', async () => {
    const response = await charge(CART);

    expect(response.status).toBe(202);
    expect(createCharge).toHaveBeenCalledWith(3000, 'USD', expect.anything());
  });

  it('ignores an amount the client tries to name', async () => {
    // The whole point: a caller supplying its own figure must not be able to
    // move the number that reaches the card.
    const response = await charge({ ...CART, amount: 1 });

    expect(response.status).toBe(202);
    expect(createCharge).toHaveBeenCalledWith(3000, 'USD', expect.anything());
  });

  it('refuses a charge with no cart at all', async () => {
    const response = await charge({});

    expect(response.status).toBe(400);
    expect(createCharge).not.toHaveBeenCalled();
  });

  it('records what it is about to charge before charging it', async () => {
    // Ordering is the point. A row written after approval would be missing in
    // exactly the case it exists for — the request dying mid-authorisation.
    await charge(CART);

    expect(createPaymentAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 3000, currency: 'USD', provider: 'stripe' })
    );
    expect(createPaymentAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      createCharge.mock.invocationCallOrder[0]
    );
  });

  it('sends the attempt id to the processor as metadata and as the idempotency key', async () => {
    await charge(CART);

    const meta = createCharge.mock.calls[0][2];
    expect(meta.idempotencyKey).toBe('att-1');
    expect(meta.metadata).toMatchObject({ attempt_id: 'att-1' });
  });

  it('returns the attempt id so the till can bind its order to it', async () => {
    const response = await charge(CART);

    expect(response.body.data.attemptId).toBe('att-1');
  });

  it('takes the store credit off the card, not off the sale', async () => {
    // The customer owes $30 and holds a $10 credit, so $20 goes on the card.
    // Charging the full total would take the credit's share twice.
    getStoreCreditByCode.mockResolvedValue({
      code: 'SC-1',
      remainingAmount: 10,
      status: 'active',
    });

    await charge({ ...CART, storeCreditCode: 'SC-1' });

    expect(createCharge).toHaveBeenCalledWith(2000, 'USD', expect.anything());
  });

  it('never lets a credit larger than the sale produce a negative charge', async () => {
    getStoreCreditByCode.mockResolvedValue({
      code: 'SC-BIG',
      remainingAmount: 500,
      status: 'active',
    });

    const response = await charge({ ...CART, storeCreditCode: 'SC-BIG' });

    expect(response.status).toBe(400);
    expect(createCharge).not.toHaveBeenCalled();
  });

  it('marks the attempt failed when the charge cannot be started', async () => {
    createCharge.mockRejectedValue(new Error('reader exploded'));

    await charge(CART);

    expect(updatePaymentAttempt).toHaveBeenCalledWith(
      'att-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('links the attempt to the charge once the processor accepts it', async () => {
    await charge(CART);

    expect(updatePaymentAttempt).toHaveBeenCalledWith(
      'att-1',
      expect.objectContaining({ chargeId: 'pi_1' })
    );
  });
});
